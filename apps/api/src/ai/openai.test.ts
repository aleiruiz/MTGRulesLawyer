import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  createOpenAiAdapter,
  OPENAI_DEFAULT_MODEL,
  OPENAI_PROMPT_VERSION,
  readOpenAiConfig,
  type OpenAiRequest,
} from "./openai.js";

const resultSchema = z.object({ answer: z.string(), confidence: z.enum(["high", "low"]) });
const config = {
  apiKey: "test-key",
  model: OPENAI_DEFAULT_MODEL,
  timeoutMs: 5_000,
  maxOutputTokens: 300,
  reasoningEffort: "low" as const,
};

void describe("OpenAI structured output adapter", () => {
  void it("validates structured output and logs model and prompt versions", async () => {
    let sentRequest: OpenAiRequest | undefined;
    const logEvents: Array<Record<string, unknown>> = [];
    const adapter = createOpenAiAdapter(config, {
      transport: (request) => {
        sentRequest = request;
        return Promise.resolve({
          outputText: JSON.stringify({ answer: "It resolves.", confidence: "high" }),
          requestId: "req_test",
          inputTokens: 20,
          outputTokens: 12,
        });
      },
      logger: (event) => logEvents.push(event),
    });

    const answer = await adapter.generateStructuredOutput({
      schema: resultSchema,
      schemaName: "test_answer",
      systemPrompt: "Return a typed test answer.",
      userPrompt: "Does this resolve?",
      promptVersion: OPENAI_PROMPT_VERSION,
    });

    assert.deepEqual(answer, { answer: "It resolves.", confidence: "high" });
    assert.equal(sentRequest?.model, OPENAI_DEFAULT_MODEL);
    assert.equal(sentRequest?.maxOutputTokens, 300);
    assert.equal(sentRequest?.schemaName, "test_answer");
    assert.equal(logEvents[0]?.promptVersion, OPENAI_PROMPT_VERSION);
    assert.equal(logEvents[1]?.model, OPENAI_DEFAULT_MODEL);
    assert.equal(JSON.stringify(logEvents).includes("Does this resolve?"), false);
  });

  void it("rejects malformed provider output", async () => {
    const adapter = createOpenAiAdapter(config, {
      transport: () =>
        Promise.resolve({ outputText: JSON.stringify({ answer: 42, confidence: "high" }) }),
    });

    await assert.rejects(
      adapter.generateStructuredOutput({
        schema: resultSchema,
        schemaName: "test_answer",
        systemPrompt: "System prompt.",
        userPrompt: "User question.",
        promptVersion: OPENAI_PROMPT_VERSION,
      }),
      /expected string/i,
    );
  });

  void it("uses safe version logging by default without logging prompt text", async () => {
    const logLines: string[] = [];
    const adapter = createOpenAiAdapter(config, {
      logWriter: (line) => logLines.push(line),
      transport: () =>
        Promise.resolve({ outputText: JSON.stringify({ answer: "ok", confidence: "low" }) }),
    });

    await adapter.generateStructuredOutput({
      schema: resultSchema,
      schemaName: "test_answer",
      systemPrompt: "Private system prompt.",
      userPrompt: "Private user prompt.",
      promptVersion: OPENAI_PROMPT_VERSION,
    });

    const logs = logLines.join("");
    assert.match(logs, /gpt-6-luna/);
    assert.match(logs, /rules-assistant-v1/);
    assert.doesNotMatch(logs, /Private (system|user) prompt/);
    assert.doesNotMatch(logs, /test-key/);
  });

  void it("does not accept missing or placeholder credentials at call setup", () => {
    assert.throws(() => readOpenAiConfig({}), /OPENAI_API_KEY/);
    assert.throws(
      () => readOpenAiConfig({ OPENAI_API_KEY: "your-openai-api-key" }),
      /OPENAI_API_KEY/,
    );
  });

  void it("validates bounded timeout and output token configuration", () => {
    assert.throws(
      () => readOpenAiConfig({ OPENAI_API_KEY: "test-key", OPENAI_TIMEOUT_MS: "10" }),
      /OPENAI_TIMEOUT_MS/,
    );
    assert.throws(
      () => readOpenAiConfig({ OPENAI_API_KEY: "test-key", OPENAI_MAX_OUTPUT_TOKENS: "5000" }),
      /OPENAI_MAX_OUTPUT_TOKENS/,
    );
  });
});

void describe("OpenAI live smoke test", () => {
  void it(
    "returns validated typed output from the configured model",
    { skip: process.env.RUN_OPENAI_SMOKE_TEST !== "true" },
    async () => {
      const liveConfig = readOpenAiConfig();
      const adapter = createOpenAiAdapter(liveConfig);
      const response = await adapter.generateStructuredOutput({
        schema: z.object({ ok: z.boolean() }),
        schemaName: "smoke_test",
        systemPrompt: "Return only the requested JSON object.",
        userPrompt: "Return { ok: true }.",
        promptVersion: "openai-smoke-v1",
      });
      assert.deepEqual(response, { ok: true });
    },
  );
});
