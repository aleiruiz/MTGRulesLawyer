import assert from "node:assert/strict";
import Fastify from "fastify";
import { describe, it } from "node:test";
import {
  AiUsageLimitError,
  classifyAiFailure,
  readAiUsageConfig,
  runReservedAiCall,
  sendAiUsageLimitError,
} from "./usage.js";

void describe("AI usage control configuration", () => {
  void it("uses conservative documented defaults with a server-side hash key", () => {
    const config = readAiUsageConfig({
      AI_RATE_LIMIT_HASH_KEY: "test-hash-key-with-32-characters",
    });
    assert.equal(config.anonymousInterpretationsPerDay, 10);
    assert.equal(config.anonymousRulingsPerDay, 3);
    assert.equal(config.accountInterpretationsPerDay, 30);
    assert.equal(config.accountRulingsPerDay, 10);
    assert.equal(config.ipBurstPerMinute, 8);
    assert.equal(config.globalDailyCostLimitMicros, 5_000_000n);
    assert.equal(config.reservedCostMicros, 20_000n);
    assert.equal(config.maxConcurrentCalls, 5);
  });

  void it("rejects placeholder hash keys and invalid emergency switch values", () => {
    assert.throws(() => readAiUsageConfig({}), /AI_RATE_LIMIT_HASH_KEY/);
    assert.throws(
      () => readAiUsageConfig({ AI_RATE_LIMIT_HASH_KEY: "too-short" }),
      /at least 32 characters/,
    );
    assert.throws(
      () =>
        readAiUsageConfig({
          AI_RATE_LIMIT_HASH_KEY: "test-hash-key-with-32-characters",
          AI_EMERGENCY_STOP: "enabled",
        }),
      /AI_EMERGENCY_STOP/,
    );
  });

  void it("keeps reservations alive longer than the configured provider timeout", () => {
    const hashKey = "test-hash-key-with-32-characters";
    assert.throws(
      () =>
        readAiUsageConfig({
          AI_RATE_LIMIT_HASH_KEY: hashKey,
          AI_RESERVATION_TTL_MS: "15000",
          OPENAI_TIMEOUT_MS: "120000",
        }),
      /exceed OPENAI_TIMEOUT_MS by at least 5000/,
    );
    assert.equal(
      readAiUsageConfig({
        AI_RATE_LIMIT_HASH_KEY: hashKey,
        AI_RESERVATION_TTL_MS: "125001",
        OPENAI_TIMEOUT_MS: "120000",
      }).reservationTtlMs,
      125_001,
    );
  });

  void it("prevents the provider callback from running when the emergency switch is set", async () => {
    let providerCalls = 0;
    await assert.rejects(
      runReservedAiCall(
        { kind: "RULING", identity: { clientIp: "192.0.2.1" } },
        () => {
          providerCalls += 1;
          return Promise.resolve({ value: "should not run" });
        },
        {
          config: {
            ...readAiUsageConfig({ AI_RATE_LIMIT_HASH_KEY: "test-hash-key-with-32-characters" }),
            emergencyStop: true,
          },
        },
      ),
      (error: unknown) =>
        error instanceof AiUsageLimitError &&
        error.code === "AI_EMERGENCY_STOP" &&
        error.statusCode === 503,
    );
    assert.equal(providerCalls, 0);
  });

  void it("sets Retry-After and returns retry metadata for quota errors", async () => {
    const app = Fastify();
    app.get("/limited", async (_request, reply) =>
      sendAiUsageLimitError(reply, new AiUsageLimitError("AI_DAILY_LIMIT", 429, 37)),
    );

    const response = await app.inject({ method: "GET", url: "/limited" });
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers["retry-after"], "37");
    assert.deepEqual(response.json(), { error: "AI_DAILY_LIMIT", retryAfterSeconds: 37 });
    await app.close();
  });
});

void describe("AI call failure classification", () => {
  void it("tells output limits, timeouts and cancellations apart", () => {
    assert.equal(
      classifyAiFailure(new Error("OpenAI response was incomplete (max_output_tokens).")),
      "OUTPUT_LIMIT",
    );
    const timeout = new Error("Request timed out.");
    timeout.name = "APIConnectionTimeoutError";
    assert.equal(classifyAiFailure(timeout), "TIMEOUT");
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(classifyAiFailure(new Error("anything"), aborted.signal), "CANCELLED");
    assert.equal(classifyAiFailure(new Error("Rate limit reached")), "ERROR");
  });
});
