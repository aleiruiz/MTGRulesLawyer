import OpenAI from "openai";
import { z } from "zod";

export const OPENAI_PROMPT_VERSION = "rules-assistant-v1";
export const OPENAI_DEFAULT_MODEL = "gpt-6-luna";
/**
 * A ruling prompt is bounded by its parts: searched, core and requested rules and card text
 * (about 58,000 characters with ten cards), a 4,000-character question, five prior turns
 * (about 6,000), the game state, up to 4,500 characters of verified notes, and every official
 * ruling of the confirmed cards, whole (the largest card has 32 rulings and about 8,500
 * characters; with ids and dates, ten such cards add about 105,000): about 179,000 in the
 * worst case before JSON escaping, which can add more for a question full of quotes or control
 * characters. Ruling generation checks this cap before reserving quota.
 */
export const MAX_USER_PROMPT_CHARACTERS = 200_000;

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

  const timeoutMs = Number(env.OPENAI_TIMEOUT_MS ?? 45_000);
  const maxOutputTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS ?? 2_500);
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
  /** Lets the model run OpenAI's web search tool at most this many times. Off when absent. */
  webSearchMaxCalls?: number;
}

export interface OpenAiRequest {
  model: string;
  input: Array<{ role: "system" | "user"; content: string }>;
  maxOutputTokens: number;
  reasoningEffort: OpenAiConfig["reasoningEffort"];
  schemaName: string;
  schema: Record<string, unknown>;
  webSearchMaxCalls?: number;
}

/** A web page the model read through web search. Untrusted: never evidence for a ruling. */
export interface WebSource {
  url: string;
  title?: string;
}

export interface OpenAiResponse {
  outputText: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  webSearchCalls?: number;
  webSources?: WebSource[];
}

export type OpenAiTransport = (
  request: OpenAiRequest,
  signal?: AbortSignal,
) => Promise<OpenAiResponse>;

export interface StructuredOutputResult<T> {
  value: T;
  inputTokens?: number;
  outputTokens?: number;
  webSearchCalls?: number;
  webSources?: WebSource[];
}

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
  return async (request, signal) => {
    const response = await client.responses.create(
      {
        model: request.model,
        input: request.input,
        max_output_tokens: request.maxOutputTokens,
        reasoning: { effort: request.reasoningEffort },
        ...(request.webSearchMaxCalls
          ? {
              tools: [{ type: "web_search" as const }],
              // Research only runs after an uncertain answer, so the search is not optional.
              tool_choice: "required" as const,
              max_tool_calls: request.webSearchMaxCalls,
              include: ["web_search_call.action.sources" as const],
            }
          : {}),
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      },
      { signal },
    );

    if (response.status === "incomplete") {
      throw new Error(
        `OpenAI response was incomplete (${response.incomplete_details?.reason ?? "unknown"}).`,
      );
    }
    const webSearchCalls = response.output.filter((item) => item.type === "web_search_call");
    const webSources = new Map<string, WebSource>();
    for (const call of webSearchCalls) {
      if (call.action.type !== "search") continue;
      for (const source of call.action.sources ?? [])
        webSources.set(source.url, { url: source.url });
    }
    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const content of item.content) {
        if (content.type !== "output_text") continue;
        for (const annotation of content.annotations) {
          if (annotation.type === "url_citation")
            webSources.set(annotation.url, { url: annotation.url, title: annotation.title });
        }
      }
    }
    return {
      outputText: response.output_text,
      requestId: response.id,
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      ...(request.webSearchMaxCalls
        ? { webSearchCalls: webSearchCalls.length, webSources: [...webSources.values()] }
        : {}),
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
      signal?: AbortSignal,
    ): Promise<z.infer<TSchema>> {
      return (await this.generateStructuredOutputWithUsage(request, signal)).value;
    },
    async generateStructuredOutputWithUsage<TSchema extends z.ZodType>(
      request: GenerateStructuredOutputOptions<TSchema>,
      signal?: AbortSignal,
    ): Promise<StructuredOutputResult<z.infer<TSchema>>> {
      if (!request.systemPrompt.trim() || request.systemPrompt.length > 8_000) {
        throw new Error("System prompt must contain 1 to 8000 characters.");
      }
      if (!request.userPrompt.trim() || request.userPrompt.length > MAX_USER_PROMPT_CHARACTERS) {
        throw new Error(`User prompt must contain 1 to ${MAX_USER_PROMPT_CHARACTERS} characters.`);
      }
      const startedAt = Date.now();
      const metadata = {
        model: config.model,
        promptVersion: request.promptVersion,
        schemaName: request.schemaName,
      };
      log({ ...metadata, event: "openai.request.started" }, "OpenAI request started");

      try {
        const result = await transport(
          {
            model: config.model,
            input: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
            maxOutputTokens: config.maxOutputTokens,
            reasoningEffort: config.reasoningEffort,
            schemaName: request.schemaName,
            schema: z.toJSONSchema(request.schema),
            ...(request.webSearchMaxCalls ? { webSearchMaxCalls: request.webSearchMaxCalls } : {}),
          },
          signal,
        );
        const parsed: unknown = JSON.parse(result.outputText);
        const validated = request.schema.parse(parsed);
        log(
          {
            ...metadata,
            event: "openai.request.completed",
            requestId: result.requestId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            ...(result.webSearchCalls === undefined
              ? {}
              : { webSearchCalls: result.webSearchCalls }),
            durationMs: Date.now() - startedAt,
          },
          "OpenAI request completed",
        );
        return {
          value: validated,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          ...(result.webSearchCalls === undefined
            ? {}
            : { webSearchCalls: result.webSearchCalls, webSources: result.webSources ?? [] }),
        };
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
