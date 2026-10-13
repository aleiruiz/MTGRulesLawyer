import { createHmac } from "node:crypto";
import type { FastifyReply } from "fastify";
import { type Prisma, type PrismaClient, type UsageKind } from "@prisma/client";
import { prisma } from "../db/client.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const BURST_MS = 60 * 1_000;
const GLOBAL_RESERVATION_LOCK = 72_419_301;

export interface AiUsageConfig {
  hashKey: string;
  anonymousInterpretationsPerDay: number;
  anonymousRulingsPerDay: number;
  accountInterpretationsPerDay: number;
  accountRulingsPerDay: number;
  ipBurstPerMinute: number;
  globalDailyCostLimitMicros: bigint;
  reservedCostMicros: bigint;
  maxConcurrentCalls: number;
  reservationTtlMs: number;
  emergencyStop: boolean;
}

export interface AiUsageIdentity {
  /** Must be set only by verified server-side auth middleware. */
  accountId?: string;
  /** Use the API framework's trusted client IP value; never accept it from request input. */
  clientIp: string;
  /**
   * Set only for an account the database marks as admin. Skips the per-account daily and per-IP
   * burst limits; the global cost ceiling, concurrency cap and emergency stop still apply.
   */
  unlimited?: boolean;
}

export interface AiUsageRequest {
  identity: AiUsageIdentity;
  kind: UsageKind;
}

export function estimateAiTokenCostMicros(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  env: NodeJS.ProcessEnv = process.env,
): bigint | undefined {
  const inputRate = env.AI_INPUT_COST_PER_MILLION_MICROS;
  const outputRate = env.AI_OUTPUT_COST_PER_MILLION_MICROS;
  if (!inputRate || !outputRate || inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }
  const inputRateMicros = Number(inputRate);
  const outputRateMicros = Number(outputRate);
  if (
    !Number.isSafeInteger(inputRateMicros) ||
    inputRateMicros < 0 ||
    !Number.isSafeInteger(outputRateMicros) ||
    outputRateMicros < 0
  ) {
    throw new Error(
      "AI token cost rates must be non-negative integer micro-units per million tokens.",
    );
  }
  const numerator =
    BigInt(inputTokens) * BigInt(inputRateMicros) + BigInt(outputTokens) * BigInt(outputRateMicros);
  return (numerator + 999_999n) / 1_000_000n;
}

export class AiUsageLimitError extends Error {
  constructor(
    public readonly code:
      | "AI_EMERGENCY_STOP"
      | "AI_DAILY_LIMIT"
      | "AI_IP_BURST_LIMIT"
      | "AI_GLOBAL_COST_LIMIT"
      | "AI_CONCURRENCY_LIMIT",
    public readonly statusCode: 429 | 503,
    public readonly retryAfterSeconds: number,
  ) {
    super(code);
    this.name = "AiUsageLimitError";
  }
}

function positiveInteger(value: string | undefined, name: string, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

export function readAiUsageConfig(env: NodeJS.ProcessEnv = process.env): AiUsageConfig {
  const hashKey = env.AI_RATE_LIMIT_HASH_KEY?.trim();
  if (!hashKey || hashKey === "replace-with-a-random-server-secret" || hashKey.length < 32) {
    throw new Error(
      "AI_RATE_LIMIT_HASH_KEY must be a server-side secret of at least 32 characters.",
    );
  }
  const globalDailyCostLimitMicros = positiveInteger(
    env.AI_GLOBAL_DAILY_COST_LIMIT_MICROS,
    "AI_GLOBAL_DAILY_COST_LIMIT_MICROS",
    5_000_000,
  );
  const reservedCostMicros = positiveInteger(
    env.AI_RESERVED_COST_MICROS,
    "AI_RESERVED_COST_MICROS",
    20_000,
  );
  if (reservedCostMicros > globalDailyCostLimitMicros) {
    throw new Error("AI_RESERVED_COST_MICROS must not exceed the global daily cost limit.");
  }

  const emergencyStop = env.AI_EMERGENCY_STOP ?? "false";
  if (emergencyStop !== "true" && emergencyStop !== "false") {
    throw new Error("AI_EMERGENCY_STOP must be true or false.");
  }

  const reservationTtlMs = positiveInteger(
    env.AI_RESERVATION_TTL_MS,
    "AI_RESERVATION_TTL_MS",
    180_000,
  );
  const providerTimeoutMs = Number(env.OPENAI_TIMEOUT_MS ?? 45_000);
  if (
    !Number.isSafeInteger(providerTimeoutMs) ||
    providerTimeoutMs < 1_000 ||
    providerTimeoutMs > 120_000
  ) {
    throw new Error("OPENAI_TIMEOUT_MS must be an integer between 1000 and 120000.");
  }
  if (
    reservationTtlMs < 15_000 ||
    reservationTtlMs > 600_000 ||
    reservationTtlMs <= providerTimeoutMs + 5_000
  ) {
    throw new Error(
      "AI_RESERVATION_TTL_MS must be between 15000 and 600000 and exceed OPENAI_TIMEOUT_MS by at least 5000.",
    );
  }

  return {
    hashKey,
    anonymousInterpretationsPerDay: positiveInteger(
      env.AI_ANON_INTERPRETATIONS_PER_DAY,
      "AI_ANON_INTERPRETATIONS_PER_DAY",
      10,
    ),
    anonymousRulingsPerDay: positiveInteger(
      env.AI_ANON_RULINGS_PER_DAY,
      "AI_ANON_RULINGS_PER_DAY",
      3,
    ),
    accountInterpretationsPerDay: positiveInteger(
      env.AI_ACCOUNT_INTERPRETATIONS_PER_DAY,
      "AI_ACCOUNT_INTERPRETATIONS_PER_DAY",
      30,
    ),
    accountRulingsPerDay: positiveInteger(
      env.AI_ACCOUNT_RULINGS_PER_DAY,
      "AI_ACCOUNT_RULINGS_PER_DAY",
      10,
    ),
    ipBurstPerMinute: positiveInteger(env.AI_IP_BURST_PER_MINUTE, "AI_IP_BURST_PER_MINUTE", 8),
    globalDailyCostLimitMicros: BigInt(globalDailyCostLimitMicros),
    reservedCostMicros: BigInt(reservedCostMicros),
    maxConcurrentCalls: positiveInteger(env.AI_MAX_CONCURRENT_CALLS, "AI_MAX_CONCURRENT_CALLS", 5),
    reservationTtlMs,
    emergencyStop: emergencyStop === "true",
  };
}

function hashPrincipal(key: string, namespace: "account" | "ip", value: string): string {
  return createHmac("sha256", key).update(`${namespace}:${value}`).digest("hex");
}

function retryAfterUntil(createdAt: Date, windowMs: number, now: Date): number {
  return Math.max(1, Math.ceil((createdAt.getTime() + windowMs - now.getTime()) / 1_000));
}

function limitsFor(config: AiUsageConfig, kind: UsageKind, signedIn: boolean): number {
  if (kind === "INTERPRETATION") {
    return signedIn ? config.accountInterpretationsPerDay : config.anonymousInterpretationsPerDay;
  }
  return signedIn ? config.accountRulingsPerDay : config.anonymousRulingsPerDay;
}

async function acquireGlobalReservationLock(tx: Prisma.TransactionClient): Promise<void> {
  const result = await tx.$queryRaw<Array<{ locked: boolean }>>`
    WITH reservation_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(${GLOBAL_RESERVATION_LOCK}) AS acquired
    )
    SELECT TRUE AS locked FROM reservation_lock
  `;
  if (result[0]?.locked !== true) {
    throw new Error("Unable to acquire the global AI reservation lock.");
  }
}

export interface AiReservation {
  id: string;
  beginProviderCall(): Promise<void>;
  complete(
    actualCostMicros?: bigint,
    tokenUsage?: { inputTokens?: number; outputTokens?: number },
  ): Promise<void>;
  releaseBeforeProviderCall(): Promise<void>;
}

export interface ReserveAiUsageOptions {
  client?: PrismaClient;
  config?: AiUsageConfig;
  now?: Date;
  signal?: AbortSignal;
}

export async function reserveAiUsage(
  request: AiUsageRequest,
  options: ReserveAiUsageOptions = {},
): Promise<AiReservation> {
  if (options.config?.emergencyStop || process.env.AI_EMERGENCY_STOP === "true") {
    throw new AiUsageLimitError("AI_EMERGENCY_STOP", 503, 60);
  }
  const config = options.config ?? readAiUsageConfig();
  const client = options.client ?? prisma;
  const now = options.now ?? new Date();
  const ip = request.identity.clientIp.trim();
  if (!ip || ip.length > 128) {
    throw new Error("A trusted client IP is required for AI usage reservation.");
  }
  const accountId = request.identity.accountId?.trim() || undefined;
  const ipHash = hashPrincipal(config.hashKey, "ip", ip);
  const accountHash = accountId ? hashPrincipal(config.hashKey, "account", accountId) : null;
  const dayStart = new Date(now.getTime() - DAY_MS);
  const burstStart = new Date(now.getTime() - BURST_MS);

  const reservation = await client.$transaction(async (tx) => {
    // Short database-only serialization makes count-and-insert limits atomic across API replicas.
    await acquireGlobalReservationLock(tx);
    await tx.aiUsageReservation.deleteMany({ where: { createdAt: { lt: dayStart } } });
    await tx.aiUsageReservation.updateMany({
      where: { status: "RESERVED", expiresAt: { lte: now } },
      data: { status: "RELEASED", completedAt: now },
    });

    const identityWhere = accountHash ? { accountHash } : { accountHash: null, ipHash };
    const dailyWhere = {
      ...identityWhere,
      kind: request.kind,
      status: { not: "RELEASED" as const },
      createdAt: { gte: dayStart },
    };
    const unlimited = request.identity.unlimited === true;
    const dailyCount = unlimited ? 0 : await tx.aiUsageReservation.count({ where: dailyWhere });
    const dailyLimit = limitsFor(config, request.kind, Boolean(accountHash));
    if (!unlimited && dailyCount >= dailyLimit) {
      const oldest = await tx.aiUsageReservation.findFirst({
        where: dailyWhere,
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      throw new AiUsageLimitError(
        "AI_DAILY_LIMIT",
        429,
        oldest ? retryAfterUntil(oldest.createdAt, DAY_MS, now) : DAY_MS / 1_000,
      );
    }

    const burstCount = unlimited
      ? 0
      : await tx.aiUsageReservation.count({
          where: {
            ipHash,
            status: { not: "RELEASED" },
            createdAt: { gte: burstStart },
          },
        });
    if (!unlimited && burstCount >= config.ipBurstPerMinute) {
      const oldest = await tx.aiUsageReservation.findFirst({
        where: {
          ipHash,
          status: { not: "RELEASED" },
          createdAt: { gte: burstStart },
        },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      throw new AiUsageLimitError(
        "AI_IP_BURST_LIMIT",
        429,
        oldest ? retryAfterUntil(oldest.createdAt, BURST_MS, now) : 60,
      );
    }

    const activeCount = await tx.aiUsageReservation.count({
      where: { status: { in: ["RESERVED", "IN_PROGRESS"] }, expiresAt: { gt: now } },
    });
    if (activeCount >= config.maxConcurrentCalls) {
      const nextAvailable = await tx.aiUsageReservation.findFirst({
        where: { status: { in: ["RESERVED", "IN_PROGRESS"] }, expiresAt: { gt: now } },
        orderBy: { expiresAt: "asc" },
        select: { expiresAt: true },
      });
      throw new AiUsageLimitError(
        "AI_CONCURRENCY_LIMIT",
        429,
        nextAvailable
          ? Math.max(1, Math.ceil((nextAvailable.expiresAt.getTime() - now.getTime()) / 1_000))
          : 5,
      );
    }

    const costRows = await tx.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(COALESCE("actualCostMicros", "reservedCostMicros")), 0)::bigint AS total
      FROM "AiUsageReservation"
      WHERE "status" <> 'RELEASED'::"AiReservationStatus"
        AND "createdAt" >= ${dayStart}
    `;
    const totalCost = costRows[0]?.total ?? 0n;
    if (totalCost + config.reservedCostMicros > config.globalDailyCostLimitMicros) {
      throw new AiUsageLimitError("AI_GLOBAL_COST_LIMIT", 503, 60);
    }

    return tx.aiUsageReservation.create({
      data: {
        accountHash,
        ipHash,
        kind: request.kind,
        reservedCostMicros: config.reservedCostMicros,
        createdAt: now,
        expiresAt: new Date(now.getTime() + config.reservationTtlMs),
      },
      select: { id: true },
    });
  });

  async function beginProviderCall() {
    const now = new Date();
    const started = await client.$transaction(async (tx) => {
      await acquireGlobalReservationLock(tx);
      const result = await tx.aiUsageReservation.updateMany({
        where: { id: reservation.id, status: "RESERVED", expiresAt: { gt: now } },
        data: { status: "IN_PROGRESS" },
      });
      if (result.count === 1) return true;
      await tx.aiUsageReservation.updateMany({
        where: { id: reservation.id, status: "RESERVED", expiresAt: { lte: now } },
        data: { status: "RELEASED", completedAt: now },
      });
      return false;
    });
    if (!started) {
      throw new Error(`AI reservation ${reservation.id} expired or is no longer available.`);
    }
  }

  async function transition(
    status: "COMPLETED" | "RELEASED",
    actualCostMicros?: bigint,
    tokenUsage?: { inputTokens?: number; outputTokens?: number },
  ) {
    if (actualCostMicros !== undefined && actualCostMicros < 0n) {
      throw new Error("actualCostMicros cannot be negative.");
    }
    const result = await client.$transaction(async (tx) => {
      await acquireGlobalReservationLock(tx);
      return tx.aiUsageReservation.updateMany({
        where: {
          id: reservation.id,
          status: status === "COMPLETED" ? "IN_PROGRESS" : "RESERVED",
        },
        data: {
          status,
          actualCostMicros,
          inputTokens: tokenUsage?.inputTokens,
          outputTokens: tokenUsage?.outputTokens,
          completedAt: new Date(),
        },
      });
    });
    if (result.count !== 1) {
      throw new Error(`AI reservation ${reservation.id} was already finalized.`);
    }
  }

  return {
    id: reservation.id,
    beginProviderCall,
    complete: (
      actualCostMicros?: bigint,
      tokenUsage?: { inputTokens?: number; outputTokens?: number },
    ) => transition("COMPLETED", actualCostMicros, tokenUsage),
    releaseBeforeProviderCall: () => transition("RELEASED"),
  };
}

export interface ReservedAiCallResult<T> {
  value: T;
  actualCostMicros?: bigint;
  inputTokens?: number;
  outputTokens?: number;
}

export async function runReservedAiCallWithMetrics<T>(
  request: AiUsageRequest,
  callProvider: (signal?: AbortSignal) => Promise<ReservedAiCallResult<T>>,
  options: ReserveAiUsageOptions = {},
): Promise<ReservedAiCallResult<T>> {
  const reservation = await reserveAiUsage(request, options);
  if (options.signal?.aborted) {
    await reservation.releaseBeforeProviderCall();
    throw options.signal.reason ?? new Error("AI request cancelled before provider call.");
  }
  try {
    await reservation.beginProviderCall();
  } catch (error) {
    await reservation.releaseBeforeProviderCall().catch(() => undefined);
    throw error;
  }
  try {
    const result = await callProvider(options.signal);
    await reservation.complete(result.actualCostMicros, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    return result;
  } catch (error) {
    // Once the provider call begins, errors still consume a request and the reserved cost.
    await reservation.complete().catch(() => undefined);
    throw error;
  }
}

export async function runReservedAiCall<T>(
  request: AiUsageRequest,
  callProvider: (signal?: AbortSignal) => Promise<ReservedAiCallResult<T>>,
  options: ReserveAiUsageOptions = {},
): Promise<T> {
  return (await runReservedAiCallWithMetrics(request, callProvider, options)).value;
}

export function sendAiUsageLimitError(reply: FastifyReply, error: AiUsageLimitError) {
  reply.header("Retry-After", String(error.retryAfterSeconds));
  return reply.code(error.statusCode).send({
    error: error.code,
    retryAfterSeconds: error.retryAfterSeconds,
  });
}
