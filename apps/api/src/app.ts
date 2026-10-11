import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import {
  cardLookupResponseSchema,
  healthResponseSchema,
  type CardLookupResponse,
  questionInterpretRequestSchema,
  questionInterpretResponseSchema,
  type QuestionInterpretResponse,
  type SourceStatusResponse,
} from "@mtg-rules/contracts";
import { AiUsageLimitError, sendAiUsageLimitError } from "./ai/usage.js";
import { lookupCardsByExactFaceName } from "./cards/lookup.js";
import { interpretQuestion } from "./questions/interpret.js";
import { getSourceStatus } from "./sources/status.js";

export interface BuildAppOptions {
  lookupCardsByExactFaceName?: (name: string) => Promise<CardLookupResponse>;
  interpretQuestion?: (question: string, clientIp: string) => Promise<QuestionInterpretResponse>;
  getSourceStatus?: () => Promise<SourceStatusResponse>;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const trustedProxies = (process.env.TRUSTED_PROXY_IPS ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const app = Fastify({
    logger: true,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });
  const lookupCards = options.lookupCardsByExactFaceName ?? lookupCardsByExactFaceName;
  const interpret = options.interpretQuestion ?? interpretQuestion;
  const readSourceStatus = options.getSourceStatus ?? getSourceStatus;

  void app.register(cors, { origin: true });
  app.get("/health", async (_request, reply) =>
    reply.send(healthResponseSchema.parse({ status: "ok", service: "mtg-rules-api" })),
  );
  app.get("/api/sources/status", async (_request, reply) => reply.send(await readSourceStatus()));
  app.get<{ Querystring: { name?: string | string[] } }>(
    "/api/cards/lookup",
    async (request, reply) => {
      const queryName = request.query.name;
      const name = typeof queryName === "string" ? queryName.trim() : "";
      if (!name || name.length > 200) {
        return reply.code(400).send({ error: "Provide a card face name up to 200 characters." });
      }
      return reply.send(cardLookupResponseSchema.parse(await lookupCards(name)));
    },
  );
  app.post("/api/questions/interpret", async (request, reply) => {
    const parsed = questionInterpretRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Provide a non-empty question up to 4000 characters." });
    }
    try {
      const result = await interpret(parsed.data.question, request.ip);
      return reply.send(questionInterpretResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof AiUsageLimitError) return sendAiUsageLimitError(reply, error);
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Question interpretation failed",
      );
      return reply.code(502).send({ error: "QUESTION_INTERPRETATION_UNAVAILABLE" });
    }
  });
  return app;
}
