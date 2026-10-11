import "dotenv/config";
import { prisma } from "../apps/api/src/db/client.js";

try {
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await prisma.$queryRaw`
    SELECT
      "kind"::text AS kind,
      "status"::text AS status,
      COUNT(*)::bigint AS count,
      COALESCE(SUM("actualCostMicros"), 0)::bigint AS "actualCostMicros",
      COALESCE(SUM(
        CASE
          WHEN "status" = 'RELEASED'::"AiReservationStatus" THEN 0
          WHEN "actualCostMicros" IS NULL THEN "reservedCostMicros"
          ELSE 0
        END
      ), 0)::bigint AS "reservedCostMicros",
      COALESCE(SUM("inputTokens"), 0)::bigint AS "inputTokens",
      COALESCE(SUM("outputTokens"), 0)::bigint AS "outputTokens"
    FROM "AiUsageReservation"
    WHERE "createdAt" >= ${dayStart}
    GROUP BY "kind", "status"
  `;

  let actualCostMicros = 0n;
  let reservedCostMicros = 0n;
  let completed = 0;
  let releasedReservations = 0;
  const groups = rows.map((row) => {
    const actual = row.actualCostMicros;
    const reserved = row.reservedCostMicros;
    if (row.status === "COMPLETED") {
      actualCostMicros += actual;
      reservedCostMicros += reserved * BigInt(row._count._all - row._count.actualCostMicros);
      completed += Number(row.count);
    } else if (row.status !== "RELEASED") {
      reservedCostMicros += reserved;
    }
    if (row.status === "RELEASED") releasedReservations += Number(row.count);
    return {
      kind: row.kind,
      status: row.status,
      count: Number(row.count),
      actualCostMicros: actual.toString(),
      reservedCostMicros: reserved.toString(),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    };
  });

  const configuredLimit = process.env.AI_GLOBAL_DAILY_COST_LIMIT_MICROS ?? "5000000";
  const dailyLimit = BigInt(configuredLimit);
  const defaultAlertThreshold = (dailyLimit * 80n) / 100n;
  const thresholdOverride = process.env.AI_DAILY_COST_ALERT_MICROS?.trim();
  const alertThreshold = BigInt(thresholdOverride || defaultAlertThreshold.toString());
  const totalCostMicros = actualCostMicros + reservedCostMicros;
  const report = {
    event: "ai.usage.daily_report",
    windowStart: dayStart.toISOString(),
    generatedAt: now.toISOString(),
    actualCostMicros: actualCostMicros.toString(),
    reservedCostMicros: reservedCostMicros.toString(),
    totalCostMicros: totalCostMicros.toString(),
    alertThresholdMicros: alertThreshold.toString(),
    dailyLimitMicros: dailyLimit.toString(),
    completedReservations: completed,
    releasedReservations,
    groups,
    alert: totalCostMicros >= alertThreshold,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.alert) process.exitCode = 2;
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ event: "ai.usage.daily_report.failed", error: error instanceof Error ? error.message : "UnknownError" })}\n`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
