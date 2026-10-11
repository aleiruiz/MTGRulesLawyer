import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PrismaClient, type UsageKind } from "@prisma/client";
import { describe, it } from "node:test";
import {
  AiUsageLimitError,
  reserveAiUsage,
  runReservedAiCall,
  type AiUsageConfig,
  type AiUsageRequest,
} from "./usage.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";

function testConfig(overrides: Partial<AiUsageConfig> = {}): AiUsageConfig {
  return {
    hashKey: "r02-integration-test".repeat(3),
    anonymousInterpretationsPerDay: 20,
    anonymousRulingsPerDay: 20,
    accountInterpretationsPerDay: 20,
    accountRulingsPerDay: 20,
    ipBurstPerMinute: 20,
    globalDailyCostLimitMicros: 1_000_000n,
    reservedCostMicros: 10_000n,
    maxConcurrentCalls: 10,
    reservationTtlMs: 120_000,
    emergencyStop: false,
    ...overrides,
  };
}

function request(kind: UsageKind, clientIp: string, accountId?: string): AiUsageRequest {
  return { kind, identity: { clientIp, accountId } };
}

void describe("AI usage reservation integration", { skip: !enabled }, () => {
  void it("atomically limits parallel daily reservations for one anonymous IP", async () => {
    const client = new PrismaClient();
    const config = testConfig({ anonymousInterpretationsPerDay: 1 });
    const reservations: string[] = [];
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;

    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          reserveAiUsage(request("INTERPRETATION", ip), { client, config }),
        ),
      );
      const granted = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveAiUsage>>> =>
          outcome.status === "fulfilled",
      );
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      assert.equal(granted.length, 1);
      assert.equal(rejected.length, 11);
      for (const outcome of rejected) {
        assert.ok(outcome.status === "rejected");
        assert.ok(outcome.reason instanceof AiUsageLimitError);
        assert.equal(outcome.reason.statusCode, 429);
        assert.ok(outcome.reason.retryAfterSeconds > 0);
      }
      reservations.push(...granted.map((outcome) => outcome.value.id));
      const stored = await client.aiUsageReservation.findUniqueOrThrow({
        where: { id: granted[0]?.value.id },
        select: { ipHash: true, accountHash: true },
      });
      assert.notEqual(stored.ipHash, ip);
      assert.equal(stored.accountHash, null);
      await Promise.all(granted.map((outcome) => outcome.value.beginProviderCall()));
      await Promise.all(
        granted.map((outcome) =>
          outcome.value.complete(1_000n, { inputTokens: 20, outputTokens: 12 }),
        ),
      );
      const recorded = await client.aiUsageReservation.findUniqueOrThrow({
        where: { id: granted[0]?.value.id },
        select: { actualCostMicros: true, inputTokens: true, outputTokens: true },
      });
      assert.equal(recorded.actualCostMicros, 1_000n);
      assert.equal(recorded.inputTokens, 20);
      assert.equal(recorded.outputTokens, 12);
    } finally {
      await client.aiUsageReservation.deleteMany({ where: { id: { in: reservations } } });
      await client.$disconnect();
    }
  });

  void it("atomically limits parallel daily reservations for a signed-in account", async () => {
    const client = new PrismaClient();
    const config = testConfig({ accountRulingsPerDay: 1 });
    const reservations: string[] = [];
    const accountId = `r02-account-${Math.random().toString(36).slice(2)}`;

    try {
      const outcomes = await Promise.allSettled(
        Array.from({ length: 8 }, (_, index) =>
          reserveAiUsage(request("RULING", `192.0.2.${index + 20}`, accountId), {
            client,
            config,
          }),
        ),
      );
      const granted = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveAiUsage>>> =>
          outcome.status === "fulfilled",
      );
      assert.equal(granted.length, 1);
      reservations.push(...granted.map((outcome) => outcome.value.id));
      await Promise.all(granted.map((outcome) => outcome.value.releaseBeforeProviderCall()));
      const denied = outcomes.find((outcome) => outcome.status === "rejected");
      assert.ok(denied?.status === "rejected");
      assert.ok(denied.reason instanceof AiUsageLimitError);
      assert.equal(denied.reason.code, "AI_DAILY_LIMIT");
    } finally {
      await client.aiUsageReservation.deleteMany({ where: { id: { in: reservations } } });
      await client.$disconnect();
    }
  });

  void it("applies a short burst limit by hashed IP even across signed-in accounts", async () => {
    const client = new PrismaClient();
    const config = testConfig({ ipBurstPerMinute: 1 });
    const reservations: string[] = [];
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

    try {
      const first = await reserveAiUsage(request("RULING", ip, "account-a"), { client, config });
      reservations.push(first.id);
      await assert.rejects(
        reserveAiUsage(request("RULING", ip, "account-b"), { client, config }),
        (error: unknown) =>
          error instanceof AiUsageLimitError && error.code === "AI_IP_BURST_LIMIT",
      );
      await first.releaseBeforeProviderCall();
    } finally {
      await client.aiUsageReservation.deleteMany({ where: { id: { in: reservations } } });
      await client.$disconnect();
    }
  });

  void it("enforces global cost and concurrency caps before another call can reserve", async () => {
    const client = new PrismaClient();
    const config = testConfig({
      globalDailyCostLimitMicros: 10_000n,
      reservedCostMicros: 10_000n,
      maxConcurrentCalls: 1,
    });
    const reservations: string[] = [];

    try {
      const first = await reserveAiUsage(request("RULING", "192.0.2.10"), { client, config });
      reservations.push(first.id);
      await assert.rejects(
        reserveAiUsage(request("INTERPRETATION", "192.0.2.11"), { client, config }),
        (error: unknown) =>
          error instanceof AiUsageLimitError && error.code === "AI_CONCURRENCY_LIMIT",
      );
      await first.releaseBeforeProviderCall();

      const afterRelease = await reserveAiUsage(request("RULING", "192.0.2.12"), {
        client,
        config,
      });
      reservations.push(afterRelease.id);
      await afterRelease.beginProviderCall();
      await afterRelease.complete(8_000n);
      let providerCalls = 0;
      await assert.rejects(
        runReservedAiCall(
          request("INTERPRETATION", "192.0.2.13"),
          () => {
            providerCalls += 1;
            return Promise.resolve({ value: "must not run" });
          },
          { client, config },
        ),
        (error: unknown) =>
          error instanceof AiUsageLimitError && error.code === "AI_GLOBAL_COST_LIMIT",
      );
      assert.equal(providerCalls, 0);
    } finally {
      await client.aiUsageReservation.deleteMany({ where: { id: { in: reservations } } });
      await client.$disconnect();
    }
  });

  void it("releases an expired reservation without invoking the provider", async () => {
    const client = new PrismaClient();
    const config = testConfig({ reservationTtlMs: 15_000 });
    let reservationId: string | undefined;
    let providerCalls = 0;

    try {
      const reservation = await reserveAiUsage(
        request("RULING", `198.51.100.${Math.floor(Math.random() * 200) + 1}`),
        { client, config, now: new Date(Date.now() - 20_000) },
      );
      reservationId = reservation.id;
      await assert.rejects(
        reservation.beginProviderCall().then(() => {
          providerCalls += 1;
        }),
        /expired or is no longer available/,
      );
      const released = await client.aiUsageReservation.findUniqueOrThrow({
        where: { id: reservation.id },
        select: { status: true },
      });
      assert.equal(released.status, "RELEASED");
      assert.equal(providerCalls, 0);
    } finally {
      if (reservationId) {
        await client.aiUsageReservation.deleteMany({ where: { id: reservationId } });
      }
      await client.$disconnect();
    }
  });

  void it("allows reservations after the rolling daily quota window resets", async () => {
    const client = new PrismaClient();
    const config = testConfig({ anonymousRulingsPerDay: 1 });
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const now = new Date("2026-10-11T12:00:00.000Z");
    let reservationId: string | undefined;
    try {
      const previousWindow = await reserveAiUsage(request("RULING", ip), {
        client,
        config,
        now: new Date(now.getTime() - 24 * 60 * 60 * 1_000 - 1),
      });
      const reservation = await reserveAiUsage(request("RULING", ip), { client, config, now });
      reservationId = reservation.id;
      await reservation.releaseBeforeProviderCall();
      assert.ok(previousWindow.id);
      const remaining = await client.aiUsageReservation.count({
        where: { id: previousWindow.id },
      });
      assert.equal(remaining, 0);
    } finally {
      if (reservationId) {
        await client.aiUsageReservation.deleteMany({ where: { id: reservationId } });
      }
      await client.$disconnect();
    }
  });

  void it("releases a cancelled request before the provider starts", async () => {
    const client = new PrismaClient();
    const config = testConfig();
    const controller = new AbortController();
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    controller.abort(new Error("client cancelled"));
    let providerCalls = 0;
    const ipHash = createHmac("sha256", config.hashKey).update(`ip:${ip}`).digest("hex");
    try {
      await assert.rejects(
        runReservedAiCall(
          request("RULING", ip),
          () => {
            providerCalls += 1;
            return Promise.resolve({ value: "unreachable" });
          },
          { client, config, signal: controller.signal },
        ),
        /client cancelled/,
      );
      assert.equal(providerCalls, 0);
    } finally {
      await client.aiUsageReservation.deleteMany({
        where: { ipHash },
      });
      await client.$disconnect();
    }
  });
});
