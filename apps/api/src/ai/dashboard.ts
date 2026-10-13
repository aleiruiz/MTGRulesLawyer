import { Prisma, type PrismaClient } from "@prisma/client";
import {
  aiUsageDashboardResponseSchema,
  type AiUsageDashboardResponse,
} from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";
import { readOpenAiConfig } from "./openai.js";
import { readAiUsageConfig } from "./usage.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RULING_KINDS = ["RULING", "RULING_RETRY", "RULING_RESEARCH"] as const;

interface StatsRow {
  calls: bigint;
  outputLimit: bigint;
  timeout: bigint;
  cancelled: bigint;
  error: bigint;
  averageOutputTokens: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

// Calls that reached the provider (released reservations never did), with how long the
// successful ones took.
const statsColumns = Prisma.sql`
  count(*)::bigint AS calls,
  count(*) FILTER (WHERE "failure" = 'OUTPUT_LIMIT')::bigint AS "outputLimit",
  count(*) FILTER (WHERE "failure" = 'TIMEOUT')::bigint AS timeout,
  count(*) FILTER (WHERE "failure" = 'CANCELLED')::bigint AS cancelled,
  count(*) FILTER (WHERE "failure" = 'ERROR')::bigint AS error,
  avg("outputTokens")::float8 AS "averageOutputTokens",
  percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM "completedAt" - "createdAt") * 1000)
    FILTER (WHERE "failure" IS NULL AND "completedAt" IS NOT NULL)::float8 AS "medianMs",
  percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM "completedAt" - "createdAt") * 1000)
    FILTER (WHERE "failure" IS NULL AND "completedAt" IS NOT NULL)::float8 AS "p95Ms",
  (max(extract(epoch FROM "completedAt" - "createdAt") * 1000)
    FILTER (WHERE "failure" IS NULL AND "completedAt" IS NOT NULL))::float8 AS "maxMs"
`;

function toStats(row: StatsRow) {
  const round = (value: number | null) => (value === null ? null : Math.round(value));
  return {
    calls: Number(row.calls),
    failures: {
      OUTPUT_LIMIT: Number(row.outputLimit),
      TIMEOUT: Number(row.timeout),
      CANCELLED: Number(row.cancelled),
      ERROR: Number(row.error),
    },
    averageOutputTokens: round(row.averageOutputTokens),
    medianMs: round(row.medianMs),
    p95Ms: round(row.p95Ms),
    maxMs: round(row.maxMs),
  };
}

/** UTC midnight `days - 1` days before today, so the window includes today. */
export function windowStart(now: Date, days: number): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - (days - 1) * DAY_MS);
}

export async function getAiUsageDashboard(
  days: number,
  client: PrismaClient = prisma,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): Promise<AiUsageDashboardResponse> {
  const usage = readAiUsageConfig(env);
  const openAi = readOpenAiConfig({ ...env, OPENAI_API_KEY: env.OPENAI_API_KEY || "unset" });
  const since = windowStart(now, days);
  const todayStart = windowStart(now, 1);
  const dailyLimitMicros = Number(usage.globalDailyCostLimitMicros);
  // Same default as the daily monitoring report: 80% of the cap.
  const alertThreshold = env.AI_DAILY_COST_ALERT_MICROS
    ? Number(env.AI_DAILY_COST_ALERT_MICROS)
    : Math.floor((dailyLimitMicros * 80) / 100);

  const [daily, byKind, bySetting, outcomes] = await Promise.all([
    client.$queryRaw<
      Array<{
        date: string;
        calls: bigint;
        failures: bigint;
        inputTokens: bigint;
        outputTokens: bigint;
        countedCostMicros: bigint;
      }>
    >(Prisma.sql`
      SELECT to_char(date_trunc('day', "createdAt" AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
        count(*)::bigint AS calls,
        count(*) FILTER (WHERE "failure" IS NOT NULL)::bigint AS failures,
        COALESCE(sum("inputTokens"), 0)::bigint AS "inputTokens",
        COALESCE(sum("outputTokens"), 0)::bigint AS "outputTokens",
        COALESCE(sum(COALESCE("actualCostMicros", "reservedCostMicros")), 0)::bigint
          AS "countedCostMicros"
      FROM "AiUsageReservation"
      WHERE "status" <> 'RELEASED'::"AiReservationStatus" AND "createdAt" >= ${since}
      GROUP BY 1
      ORDER BY 1
    `),
    client.$queryRaw<Array<StatsRow & { kind: (typeof RULING_KINDS)[number] | "INTERPRETATION" }>>(
      Prisma.sql`
        SELECT "kind"::text AS kind, ${statsColumns}
        FROM "AiUsageReservation"
        WHERE "status" <> 'RELEASED'::"AiReservationStatus" AND "createdAt" >= ${since}
        GROUP BY "kind"
        ORDER BY "kind"
      `,
    ),
    client.$queryRaw<Array<StatsRow & { model: string | null; reasoningEffort: string | null }>>(
      Prisma.sql`
        SELECT "model", "reasoningEffort", ${statsColumns}
        FROM "AiUsageReservation"
        WHERE "status" <> 'RELEASED'::"AiReservationStatus" AND "createdAt" >= ${since}
          AND "kind"::text IN (${Prisma.join([...RULING_KINDS])})
        GROUP BY "model", "reasoningEffort"
        ORDER BY count(*) DESC
        LIMIT 20
      `,
    ),
    client.rulingVersion.groupBy({
      by: ["outcome"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const today = daily.find(({ date }) => date === todayStart.toISOString().slice(0, 10));
  const outcomeCount = (outcome: string) =>
    outcomes.find((row) => row.outcome === outcome)?._count._all ?? 0;

  return aiUsageDashboardResponseSchema.parse({
    generatedAt: now.toISOString(),
    days,
    settings: {
      model: openAi.model,
      reasoningEffort: openAi.reasoningEffort,
      maxOutputTokens: openAi.maxOutputTokens,
      timeoutMs: openAi.timeoutMs,
      costRatesConfigured: Boolean(
        env.AI_INPUT_COST_PER_MILLION_MICROS && env.AI_OUTPUT_COST_PER_MILLION_MICROS,
      ),
      reservedCostMicros: Number(usage.reservedCostMicros),
    },
    today: {
      countedCostMicros: Number(today?.countedCostMicros ?? 0n),
      dailyLimitMicros,
      alertThresholdMicros: alertThreshold,
      calls: Number(today?.calls ?? 0n),
    },
    daily: daily.map((row) => ({
      date: row.date,
      calls: Number(row.calls),
      failures: Number(row.failures),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      countedCostMicros: Number(row.countedCostMicros),
    })),
    byKind: byKind.map((row) => ({ kind: row.kind, ...toStats(row) })),
    rulingsBySetting: bySetting.map((row) => ({
      model: row.model,
      reasoningEffort: row.reasoningEffort,
      ...toStats(row),
    })),
    rulingOutcomes: {
      resolved: outcomeCount("RESOLVED"),
      conditional: outcomeCount("CONDITIONAL"),
      needs_information: outcomeCount("NEEDS_INFORMATION"),
      uncertain: outcomeCount("UNCERTAIN"),
    },
  });
}
