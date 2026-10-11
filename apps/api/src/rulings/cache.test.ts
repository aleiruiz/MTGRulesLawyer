import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RulingGenerationResponse } from "@mtg-rules/contracts";
import {
  createVerifiedRulingCacheKey,
  readRulingCacheTtlMs,
  reuseVerifiedRuling,
} from "./cache.js";

const keyInput = {
  snapshotId: "snapshot-a",
  modelName: "gpt-6-luna",
  promptVersion: "verified-ruling-v1",
  reasoningEffort: "low",
  maxOutputTokens: 1_200,
  schemaFingerprint: "schema-v1",
  systemPrompt: "Use only the supplied evidence.",
  userPrompt: JSON.stringify({ question: "Does this resolve?", confirmedCards: ["card-a"] }),
};

void describe("verified ruling cache", () => {
  void it("reuses a recent answer without invoking the model again", async () => {
    const cached: RulingGenerationResponse = {
      outcome: "uncertain",
      summary: "The evidence is insufficient.",
      reasoningSteps: [],
      summaryCitationIds: [],
      assumptions: [],
      clarificationQuestions: [],
      citations: [],
      snapshot: { id: "snapshot-a", version: "rules-v1", activatedAt: null },
      sources: [],
      modelName: "gpt-6-luna",
      promptVersion: "verified-ruling-v1",
    };
    let modelCalls = 0;
    const store = new Map<string, typeof cached>();
    const operations = {
      get: (key: string) => Promise.resolve(store.get(key) ?? null),
      set: (key: string, _snapshotId: string, answer: typeof cached) => {
        store.set(key, answer);
        return Promise.resolve();
      },
    };
    const generate = () => {
      modelCalls += 1;
      return Promise.resolve(cached);
    };

    assert.deepEqual(
      await reuseVerifiedRuling("same-key", "snapshot-a", generate, operations),
      cached,
    );
    assert.deepEqual(
      await reuseVerifiedRuling("same-key", "snapshot-a", generate, operations),
      cached,
    );
    assert.equal(modelCalls, 1);
  });

  void it("keys results by snapshot, model, prompt version, and full evidence prompt", () => {
    const key = createVerifiedRulingCacheKey(keyInput);
    assert.equal(key.length, 64);
    assert.equal(createVerifiedRulingCacheKey(keyInput), key);
    assert.notEqual(createVerifiedRulingCacheKey({ ...keyInput, snapshotId: "snapshot-b" }), key);
    assert.notEqual(
      createVerifiedRulingCacheKey({ ...keyInput, userPrompt: keyInput.userPrompt + " " }),
      key,
    );
    assert.notEqual(createVerifiedRulingCacheKey({ ...keyInput, reasoningEffort: "high" }), key);
    assert.notEqual(createVerifiedRulingCacheKey({ ...keyInput, maxOutputTokens: 1_500 }), key);
    assert.notEqual(
      createVerifiedRulingCacheKey({ ...keyInput, schemaFingerprint: "schema-v2" }),
      key,
    );
  });

  void it("bounds cache retention to one day", () => {
    assert.equal(readRulingCacheTtlMs({}), 6 * 60 * 60 * 1_000);
    assert.equal(readRulingCacheTtlMs({ RULING_CACHE_TTL_MS: "3600000" }), 3_600_000);
    assert.throws(() => readRulingCacheTtlMs({ RULING_CACHE_TTL_MS: "86400001" }), /between/);
  });
});
