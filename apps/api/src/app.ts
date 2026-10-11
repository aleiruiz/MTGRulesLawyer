import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import {
  cardLookupResponseSchema,
  confirmedQuestionEvidenceRequestSchema,
  evidenceSearchResponseSchema,
  healthResponseSchema,
  type CardLookupResponse,
  type ConfirmedQuestionEvidenceRequest,
  type EvidenceSearchResponse,
  questionInterpretRequestSchema,
  questionInterpretResponseSchema,
  persistedRulingResponseSchema,
  type QuestionInterpretResponse,
  type RulingGenerationResponse,
  type PersistedRulingResponse,
  type SourceStatusResponse,
} from "@mtg-rules/contracts";
import { AiUsageLimitError, sendAiUsageLimitError } from "./ai/usage.js";
import { lookupCardsByExactFaceName } from "./cards/lookup.js";
import { interpretQuestion } from "./questions/interpret.js";
import { assembleConfirmedEvidence, InvalidConfirmedCardsError } from "./search/retrieval.js";
import { getSourceStatus } from "./sources/status.js";
import { generateRuling } from "./rulings/generate.js";
import { getRuling, saveRuling } from "./rulings/persistence.js";

export interface BuildAppOptions {
  lookupCardsByExactFaceName?: (name: string) => Promise<CardLookupResponse>;
  interpretQuestion?: (question: string, clientIp: string) => Promise<QuestionInterpretResponse>;
  assembleQuestionEvidence?: (
    request: ConfirmedQuestionEvidenceRequest,
  ) => Promise<EvidenceSearchResponse>;
  generateRuling?: (
    request: ConfirmedQuestionEvidenceRequest,
    clientIp: string,
  ) => Promise<RulingGenerationResponse>;
  saveRuling?: (
    request: ConfirmedQuestionEvidenceRequest,
    answer: RulingGenerationResponse,
  ) => Promise<PersistedRulingResponse>;
  getRuling?: (rulingId: string) => Promise<PersistedRulingResponse | null>;
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
  const assembleEvidence = options.assembleQuestionEvidence ?? assembleConfirmedEvidence;
  const createRuling = options.generateRuling ?? generateRuling;
  const persistRuling = options.saveRuling ?? saveRuling;
  const readRuling = options.getRuling ?? getRuling;
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
  app.post("/api/questions/evidence", async (request, reply) => {
    const parsed = confirmedQuestionEvidenceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_EVIDENCE_REQUEST" });
    }
    try {
      const result = await assembleEvidence(parsed.data);
      return reply.send(evidenceSearchResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof InvalidConfirmedCardsError) {
        return reply.code(400).send({ error: "CONFIRMED_CARD_UNAVAILABLE" });
      }
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Question evidence assembly failed",
      );
      return reply.code(503).send({ error: "EVIDENCE_UNAVAILABLE" });
    }
  });
  app.post("/api/questions/ruling", async (request, reply) => {
    const parsed = confirmedQuestionEvidenceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "INVALID_RULING_REQUEST" });
    }
    try {
      const result = await createRuling(parsed.data, request.ip);
      return reply.send(
        persistedRulingResponseSchema.parse(await persistRuling(parsed.data, result)),
      );
    } catch (error) {
      if (error instanceof AiUsageLimitError) return sendAiUsageLimitError(reply, error);
      if (error instanceof InvalidConfirmedCardsError) {
        return reply.code(400).send({ error: "CONFIRMED_CARD_UNAVAILABLE" });
      }
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Ruling generation failed",
      );
      return reply.code(502).send({ error: "RULING_GENERATION_UNAVAILABLE" });
    }
  });
  app.get<{ Params: { rulingId: string } }>("/api/rulings/:rulingId", async (request, reply) => {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        request.params.rulingId,
      )
    ) {
      return reply.code(400).send({ error: "INVALID_RULING_ID" });
    }
    const result = await readRuling(request.params.rulingId);
    if (!result) return reply.code(404).send({ error: "RULING_NOT_FOUND" });
    return reply.send(persistedRulingResponseSchema.parse(result));
  });
  return app;
}
