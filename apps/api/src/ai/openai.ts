import OpenAI from "openai";
import { z } from "zod";

export const OPENAI_PROMPT_VERSION = "rules-assistant-v1";
export const OPENAI_DEFAULT_MODEL = "gpt-6-luna";

const modelSchema = z.string().trim().min(1).max(100);
const effortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);

export interface OpenAiConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort: z.infer<typeof effortSchema>;
}

export function readOpenAiConfig(env: NodeJS.ProcessEnv = process.env): OpenAiConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey || apiKey === "your-openai-api-key") {
    throw new Error("OPENAI_API_KEY must be configured before making a model request.");
  }

  const timeoutMs = Number(env.OPENAI_TIMEOUT_MS ?? 20_000);
  const maxOutputTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS ?? 1_200);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error("OPENAI_TIMEOUT_MS must be an integer between 1000 and 120000.");
  }
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 4_000) {
    throw new Error("OPENAI_MAX_OUTPUT_TOKENS must be an integer between 1 and 4000.");
  }

  return {
    apiKey,
    model: modelSchema.parse(env.OPENAI_MODEL ?? OPENAI_DEFAULT_MODEL),
    timeoutMs,
    maxOutputTokens,
    reasoningEffort: effortSchema.parse(env.OPENAI_REASONING_EFFORT ?? "low"),
  };
}

export interface GenerateStructuredOutputOptions<TSchema extends z.ZodType> {
  schema: TSchema;
  schemaName: string;
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
}

export interface OpenAiRequest {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  maxOutputTokens: number;
  reasoningEffort: OpenAiConfig["reasoningEffort"];
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface OpenAiResponse {
  outputText: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export type OpenAiTransport = (request: OpenAiRequest) => Promise<OpenAiResponse>;

export type OpenAiLogger = (metadata: Record<string, unknown>, message: string) => void;

export interface OpenAiAdapterOptions {
  transport?: OpenAiTransport;
  logger?: OpenAiLogger;
  logWriter?: (line: string) => void;
}

function createDefaultLogger(writeLine: (line: string) => void): OpenAiLogger {
  return (metadata, message) => {
    writeLine(`${JSON.stringify({ level: "info", ...metadata, msg: message })}\n`);
  };
}

function createSdkTransport(config: OpenAiConfig): OpenAiTransport {
  const client = new OpenAI({ apiKey: config.apiKey, timeout: config.timeoutMs, maxRetries: 0 });
  return async (request) => {
    const response = await client.responses.create({
      model: request.model,
      input: request.input,
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: request.reasoningEffort },
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          strict: true,
          schema: request.schema,
        },
      },
    });

    if (response.status === "incomplete") {
      throw new Error(
        `OpenAI response was incomplete (${response.incomplete_details?.reason ?? "unknown"}).`,
      );
    }
    return {
      outputText: response.output_text,
      requestId: response.id,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
    };
  };
}

export function createOpenAiAdapter(config: OpenAiConfig, options: OpenAiAdapterOptions = {}) {
  const transport = options.transport ?? createSdkTransport(config);
  const log =
    options.logger ??
    createDefaultLogger(options.logWriter ?? ((line) => process.stdout.write(line)));

  return {
    async generateStructuredOutput<TSchema extends z.ZodType>(
      request: GenerateStructuredOutputOptions<TSchema>,
    ): Promise<z.infer<TSchema>> {
      if (!request.systemPrompt.trim() || request.systemPrompt.length > 8_000) {
        throw new Error("System prompt must contain 1 to 8000 characters.");
      }
      if (!request.userPrompt.trim() || request.userPrompt.length > 12_000) {
        throw new Error("User prompt must contain 1 to 12000 characters.");
      }
      const startedAt = Date.now();
      const metadata = {
        model: config.model,
        promptVersion: request.promptVersion,
        schemaName: request.schemaName,
      };
      log({ ...metadata, event: "openai.request.started" }, "OpenAI request started");

      try {
        const result = await transport({
          model: config.model,
          input: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userPrompt },
          ],
          maxOutputTokens: config.maxOutputTokens,
          reasoningEffort: config.reasoningEffort,
          schemaName: request.schemaName,
          schema: z.toJSONSchema(request.schema),
        });
        const parsed: unknown = JSON.parse(result.outputText);
        const validated = request.schema.parse(parsed);
        log(
          {
            ...metadata,
            event: "openai.request.completed",
            requestId: result.requestId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            durationMs: Date.now() - startedAt,
          },
          "OpenAI request completed",
        );
        return validated;
      } catch (error) {
        log(
          { ...metadata, event: "openai.request.failed", durationMs: Date.now() - startedAt },
          "OpenAI request failed",
        );
        throw error;
      }
    },
  };
}
