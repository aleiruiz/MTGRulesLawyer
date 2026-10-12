import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
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
  challengeSubmissionRequestSchema,
  challengeResponseSchema,
  myChallengesResponseSchema,
  type ChallengeResponse,
  type ChallengeSubmissionRequest,
  type MyChallengesResponse,
  reviewQueueResponseSchema,
  requestChallengeInformationSchema,
  type ReviewQueueResponse,
  reviewDecisionRequestSchema,
  reviewDecisionResponseSchema,
  type ReviewDecisionRequest,
  type ReviewDecisionResponse,
  conversationDetailResponseSchema,
  conversationListResponseSchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
} from "@mtg-rules/contracts";
import { AiUsageLimitError, sendAiUsageLimitError } from "./ai/usage.js";
import { lookupCardsByName } from "./cards/lookup.js";
import { interpretQuestion } from "./questions/interpret.js";
import { assembleConfirmedEvidence, InvalidConfirmedCardsError } from "./search/retrieval.js";
import { getSourceStatus } from "./sources/status.js";
import { generateRuling } from "./rulings/generate.js";
import { getRuling, saveRuling } from "./rulings/persistence.js";
import {
  loadPriorTurns,
  type PriorTurn,
  type PriorTurnLoader,
  type PriorTurnScope,
} from "./conversations/prior-turns.js";
import type { RulingOwner } from "./conversations/attach.js";
import {
  deleteConversation,
  getConversation,
  listConversations,
  ownsConversation,
} from "./conversations/service.js";
import { prisma } from "./db/client.js";
import {
  createAuthenticationPreHandler,
  registerAuthentication,
  requireAuthenticatedUser,
  type AppUserResolver,
} from "./auth/authorization.js";
import {
  AccountDeletionUnavailableError,
  AuthIdentityDeletionError,
  createAccountDeleter,
  createSupabaseAuthIdentityDeleter,
  deleteAppUserData,
  deleteAppUserDataBySupabaseUserId,
  hasSupabaseSecretKey,
} from "./account/deletion.js";
import { evaluateAdminAssurance, readAdminAuthMaxAgeSeconds } from "./auth/admin-assurance.js";
import { createAttemptLimiter } from "./http/attempt-limiter.js";
import { readCorsAllowedOrigins, readTrustedProxies } from "./http/network-config.js";
import {
  createSupabaseAccessTokenVerifier,
  type AccessTokenVerifier,
} from "./auth/supabase-auth.js";
import {
  ChallengeNotFoundError,
  ChallengeRateLimitError,
  DuplicateChallengeError,
  listMyChallenges,
  submitChallenge,
} from "./challenges/service.js";
import {
  decideChallenge,
  getReviewQueue,
  requestMoreInformation,
  ReviewChallengeConflictError,
  ReviewEvaluationConsentRequiredError,
  ReviewChallengeNotFoundError,
} from "./reviews/service.js";

// Each attempt can reach the Supabase admin API; a person needs at most a few retries.
const ACCOUNT_DELETION_ATTEMPTS_PER_HOUR = 3;

export interface BuildAppOptions {
  lookupCardsByName?: (name: string) => Promise<CardLookupResponse>;
  interpretQuestion?: (
    question: string,
    clientIp: string,
    signal?: AbortSignal,
    priorTurns?: PriorTurn[],
  ) => Promise<QuestionInterpretResponse>;
  assembleQuestionEvidence?: (
    request: ConfirmedQuestionEvidenceRequest,
  ) => Promise<EvidenceSearchResponse>;
  generateRuling?: (
    request: ConfirmedQuestionEvidenceRequest,
    clientIp: string,
    signal?: AbortSignal,
    priorTurns?: PriorTurn[],
  ) => Promise<RulingGenerationResponse>;
  saveRuling?: (
    request: ConfirmedQuestionEvidenceRequest,
    answer: RulingGenerationResponse,
    owner?: RulingOwner,
  ) => Promise<PersistedRulingResponse>;
  loadPriorTurns?: PriorTurnLoader;
  listConversations?: (userId: string) => Promise<ConversationListResponse>;
  getConversation?: (
    userId: string,
    conversationId: string,
  ) => Promise<ConversationDetailResponse | null>;
  deleteConversation?: (userId: string, conversationId: string) => Promise<boolean>;
  ownsConversation?: (userId: string, conversationId: string) => Promise<boolean>;
  getRuling?: (rulingId: string, version?: number) => Promise<PersistedRulingResponse | null>;
  getSourceStatus?: () => Promise<SourceStatusResponse>;
  checkDatabase?: () => Promise<void>;
  verifyAccessToken?: AccessTokenVerifier;
  resolveAppUser?: AppUserResolver;
  adminAuthMaxAgeSeconds?: number;
  now?: () => number;
  /** Exact browser origins allowed by CORS; defaults to CORS_ALLOWED_ORIGINS. */
  corsAllowedOrigins?: string[];
  submitChallenge?: (
    input: ChallengeSubmissionRequest & { rulingId: string; userId: string },
  ) => Promise<ChallengeResponse>;
  listMyChallenges?: (userId: string) => Promise<MyChallengesResponse>;
  getReviewQueue?: () => Promise<ReviewQueueResponse>;
  requestMoreInformation?: (
    challengeId: string,
    reviewerId: string,
    reason: string,
  ) => Promise<void>;
  decideChallenge?: (
    challengeId: string,
    reviewerId: string,
    decision: ReviewDecisionRequest,
  ) => Promise<ReviewDecisionResponse>;
  deleteAccount?: (appUserId: string) => Promise<void>;
}

function createClientDisconnectController(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const abortOnDisconnect = () => controller.abort(new Error("Client disconnected."));
  const abortOnResponseClose = () => {
    if (!reply.raw.writableEnded) abortOnDisconnect();
  };
  request.raw.once("aborted", abortOnDisconnect);
  reply.raw.once("close", abortOnResponseClose);
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.off("aborted", abortOnDisconnect);
      reply.raw.off("close", abortOnResponseClose);
    },
  };
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const trustedProxies = readTrustedProxies(process.env.TRUSTED_PROXY_IPS);
  const corsAllowedOrigins =
    options.corsAllowedOrigins ??
    readCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS, process.env.NODE_ENV === "production");
  const app = Fastify({
    logger: true,
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });
  const lookupCards = options.lookupCardsByName ?? lookupCardsByName;
  const interpret = options.interpretQuestion ?? interpretQuestion;
  const assembleEvidence = options.assembleQuestionEvidence ?? assembleConfirmedEvidence;
  const createRuling = options.generateRuling ?? generateRuling;
  const persistRuling =
    options.saveRuling ??
    ((
      request: ConfirmedQuestionEvidenceRequest,
      answer: RulingGenerationResponse,
      owner?: RulingOwner,
    ) => saveRuling(request, answer, prisma, owner));
  const readPriorTurns =
    options.loadPriorTurns ??
    ((ids: string[], scope?: PriorTurnScope) => loadPriorTurns(ids, prisma, scope));
  const readConversations =
    options.listConversations ?? ((userId: string) => listConversations(userId));
  const readConversation =
    options.getConversation ?? ((userId: string, id: string) => getConversation(userId, id));
  const removeConversation =
    options.deleteConversation ?? ((userId: string, id: string) => deleteConversation(userId, id));
  const checkConversationOwner =
    options.ownsConversation ?? ((userId: string, id: string) => ownsConversation(userId, id));
  const readRuling =
    options.getRuling ?? ((rulingId, version) => getRuling(rulingId, prisma, version));
  const readSourceStatus = options.getSourceStatus ?? getSourceStatus;
  const checkDatabase =
    options.checkDatabase ?? (() => prisma.$queryRaw`SELECT 1`.then(() => undefined));
  const verifyAccessToken =
    options.verifyAccessToken ??
    createSupabaseAccessTokenVerifier({
      url: process.env.SUPABASE_URL ?? "https://your-project.supabase.co",
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "replace-me",
    });
  const resolveAppUser =
    options.resolveAppUser ??
    (async (subject) => {
      const user = await prisma.appUser.upsert({
        where: { supabaseUserId: subject },
        create: { supabaseUserId: subject },
        update: {},
        select: { id: true, role: true },
      });
      return user;
    });
  const createChallenge = options.submitChallenge ?? submitChallenge;
  const readMyChallenges = options.listMyChallenges ?? listMyChallenges;
  const readReviewQueue = options.getReviewQueue ?? getReviewQueue;
  const requestChallengeInformation = options.requestMoreInformation ?? requestMoreInformation;
  const decideReview = options.decideChallenge ?? decideChallenge;
  const deleteAccount =
    options.deleteAccount ??
    createAccountDeleter({
      deleteAppUserData: (appUserId) => deleteAppUserData(appUserId),
      deleteAppUserDataBySupabaseUserId: (supabaseUserId) =>
        deleteAppUserDataBySupabaseUserId(supabaseUserId),
      onCleanupError: () =>
        app.log.warn(
          { event: "account.cleanup_failed" },
          "A record recreated during account deletion could not be removed",
        ),
      deleteAuthIdentity: hasSupabaseSecretKey(process.env.SUPABASE_SECRET_KEY)
        ? createSupabaseAuthIdentityDeleter({
            url: process.env.SUPABASE_URL ?? "https://your-project.supabase.co",
            secretKey: process.env.SUPABASE_SECRET_KEY,
          })
        : null,
    });

  const adminAuthMaxAgeSeconds =
    options.adminAuthMaxAgeSeconds ??
    readAdminAuthMaxAgeSeconds(process.env.ADMIN_AUTH_MAX_AGE_SECONDS);
  const now = options.now ?? Date.now;
  registerAuthentication(app, verifyAccessToken, resolveAppUser, {
    adminAuthMaxAgeSeconds,
    now,
  });
  const accountDeletionLimiter = createAttemptLimiter({
    maxAttempts: ACCOUNT_DELETION_ATTEMPTS_PER_HOUR,
    windowMs: 60 * 60 * 1_000,
    now,
  });

  void app.register(cors, {
    origin: corsAllowedOrigins.length > 0 ? corsAllowedOrigins : false,
  });
  app.addHook("onResponse", (request, reply, done) => {
    const statusCode = reply.statusCode;
    const event = statusCode >= 500 ? "api.request.failed" : "api.request.completed";
    const metadata = {
      event,
      method: request.method,
      route: request.routeOptions.url ?? "unmatched",
      statusCode,
      durationMs: Math.round(reply.elapsedTime),
    };
    if (statusCode >= 500) request.log.error(metadata, "API request failed");
    else if (statusCode >= 400) request.log.warn(metadata, "API request rejected");
    else request.log.info(metadata, "API request completed");
    done();
  });
  app.get("/health", async (_request, reply) =>
    reply.send(healthResponseSchema.parse({ status: "ok", service: "mtg-rules-api" })),
  );
  app.get("/api/auth/me", async (request, reply) =>
    reply.send({ userId: request.appUser?.id, role: request.appUser?.role }),
  );
  const authenticate = createAuthenticationPreHandler(verifyAccessToken, resolveAppUser);
  app.post<{ Params: { rulingId: string } }>(
    "/api/rulings/:rulingId/challenges",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply);
      if (!user) return reply;
      if (!isUuid(request.params.rulingId))
        return reply.code(400).send({ error: "INVALID_RULING_ID" });
      const parsed = challengeSubmissionRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_CHALLENGE" });
      try {
        return reply.send(
          challengeResponseSchema.parse(
            await createChallenge({
              ...parsed.data,
              rulingId: request.params.rulingId,
              userId: user.id,
            }),
          ),
        );
      } catch (error) {
        if (error instanceof ChallengeNotFoundError)
          return reply.code(404).send({ error: "RULING_NOT_FOUND" });
        if (error instanceof DuplicateChallengeError)
          return reply.code(409).send({ error: "CHALLENGE_ALREADY_EXISTS" });
        if (error instanceof ChallengeRateLimitError) {
          reply.header("Retry-After", "86400");
          return reply
            .code(429)
            .send({ error: "CHALLENGE_DAILY_LIMIT", retryAfterSeconds: 86_400 });
        }
        request.log.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Challenge submission failed",
        );
        return reply.code(503).send({ error: "CHALLENGE_UNAVAILABLE" });
      }
    },
  );
  app.delete("/api/me", { preHandler: authenticate }, async (request, reply) => {
    const user = requireAuthenticatedUser(request, reply);
    if (!user) return reply;
    if (user.role === "ADMIN") {
      // Deleting an admin account removes reviewer attribution, so it needs the same step-up
      // check as any other admin action. It runs first: it calls nothing external, so a denied
      // attempt should not use up the deletion limit.
      const assurance = evaluateAdminAssurance(request.authSession, now(), adminAuthMaxAgeSeconds);
      if (assurance !== "allowed") {
        return reply.code(403).send({
          error:
            assurance === "mfa_required" ? "ADMIN_MFA_REQUIRED" : "ADMIN_REAUTHENTICATION_REQUIRED",
        });
      }
    }
    // Keyed by the Supabase user: after a failed identity deletion the app record is recreated
    // with a new ID, which must not reset the limit.
    const retryAfterSeconds = accountDeletionLimiter.attempt(request.authSubject ?? user.id);
    if (retryAfterSeconds !== null) {
      reply.header("Retry-After", String(retryAfterSeconds));
      return reply.code(429).send({ error: "ACCOUNT_DELETION_RATE_LIMITED", retryAfterSeconds });
    }
    try {
      await deleteAccount(user.id);
      request.log.info({ event: "account.deleted" }, "Account deleted");
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof AccountDeletionUnavailableError)
        return reply.code(503).send({ error: "ACCOUNT_DELETION_UNAVAILABLE" });
      if (error instanceof AuthIdentityDeletionError) {
        request.log.error(
          { event: "account.identity_deletion_failed" },
          "App data was deleted but the sign-in identity remains",
        );
        return reply.code(502).send({ error: "ACCOUNT_IDENTITY_DELETION_FAILED" });
      }
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Account deletion failed",
      );
      return reply.code(503).send({ error: "ACCOUNT_DELETION_FAILED" });
    }
  });
  app.get("/api/me/challenges", { preHandler: authenticate }, async (request, reply) => {
    const user = requireAuthenticatedUser(request, reply);
    if (!user) return reply;
    try {
      return reply.send(myChallengesResponseSchema.parse(await readMyChallenges(user.id)));
    } catch (error) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Challenge list failed",
      );
      return reply.code(503).send({ error: "CHALLENGES_UNAVAILABLE" });
    }
  });
  app.get("/api/me/conversations", { preHandler: authenticate }, async (request, reply) => {
    const user = requireAuthenticatedUser(request, reply);
    if (!user) return reply;
    try {
      return reply.send(conversationListResponseSchema.parse(await readConversations(user.id)));
    } catch (error) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Conversation list failed",
      );
      return reply.code(503).send({ error: "CONVERSATIONS_UNAVAILABLE" });
    }
  });
  app.get<{ Params: { conversationId: string } }>(
    "/api/me/conversations/:conversationId",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply);
      if (!user) return reply;
      if (!isUuid(request.params.conversationId))
        return reply.code(400).send({ error: "INVALID_CONVERSATION_ID" });
      try {
        const conversation = await readConversation(user.id, request.params.conversationId);
        // Another user's conversation looks the same as a missing one.
        if (!conversation) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
        return reply.send(conversationDetailResponseSchema.parse(conversation));
      } catch (error) {
        request.log.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Conversation read failed",
        );
        return reply.code(503).send({ error: "CONVERSATIONS_UNAVAILABLE" });
      }
    },
  );
  app.delete<{ Params: { conversationId: string } }>(
    "/api/me/conversations/:conversationId",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply);
      if (!user) return reply;
      if (!isUuid(request.params.conversationId))
        return reply.code(400).send({ error: "INVALID_CONVERSATION_ID" });
      try {
        const deleted = await removeConversation(user.id, request.params.conversationId);
        if (!deleted) return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
        return reply.code(204).send();
      } catch (error) {
        request.log.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Conversation delete failed",
        );
        return reply.code(503).send({ error: "CONVERSATIONS_UNAVAILABLE" });
      }
    },
  );
  app.get("/api/admin/challenges", async (request, reply) => {
    if (request.appUser?.role !== "ADMIN") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
    try {
      return reply.send(reviewQueueResponseSchema.parse(await readReviewQueue()));
    } catch (error) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Review queue could not be loaded",
      );
      return reply.code(503).send({ error: "REVIEW_QUEUE_UNAVAILABLE" });
    }
  });
  app.post<{ Params: { challengeId: string } }>(
    "/api/admin/challenges/:challengeId/request-information",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply);
      if (!user) return reply;
      if (!isUuid(request.params.challengeId))
        return reply.code(400).send({ error: "INVALID_CHALLENGE_ID" });
      const parsed = requestChallengeInformationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_REVIEW_REQUEST" });
      try {
        await requestChallengeInformation(request.params.challengeId, user.id, parsed.data.reason);
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof ReviewChallengeNotFoundError)
          return reply.code(404).send({ error: "CHALLENGE_NOT_FOUND" });
        if (error instanceof ReviewChallengeConflictError)
          return reply.code(409).send({ error: "CHALLENGE_STATUS_CHANGED" });
        request.log.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Review request could not be saved",
        );
        return reply.code(503).send({ error: "REVIEW_REQUEST_UNAVAILABLE" });
      }
    },
  );
  app.post<{ Params: { challengeId: string } }>(
    "/api/admin/challenges/:challengeId/decision",
    async (request, reply) => {
      const user = requireAuthenticatedUser(request, reply);
      if (!user) return reply;
      if (!isUuid(request.params.challengeId))
        return reply.code(400).send({ error: "INVALID_CHALLENGE_ID" });
      const parsed = reviewDecisionRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "INVALID_REVIEW_DECISION" });
      try {
        return reply.send(
          reviewDecisionResponseSchema.parse(
            await decideReview(request.params.challengeId, user.id, parsed.data),
          ),
        );
      } catch (error) {
        if (error instanceof ReviewEvaluationConsentRequiredError)
          return reply.code(400).send({ error: "EVALUATION_CONSENT_REQUIRED" });
        if (error instanceof ReviewChallengeNotFoundError)
          return reply.code(404).send({ error: "CHALLENGE_NOT_FOUND" });
        if (error instanceof ReviewChallengeConflictError)
          return reply.code(409).send({ error: "CHALLENGE_ALREADY_DECIDED" });
        request.log.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Challenge decision could not be saved",
        );
        return reply.code(503).send({ error: "CHALLENGE_DECISION_UNAVAILABLE" });
      }
    },
  );
  app.get("/ready", async (request, reply) => {
    try {
      await checkDatabase();
      return reply.send({ status: "ok", database: "ok" });
    } catch {
      request.log.error(
        { event: "health.database_unavailable" },
        "Database readiness check failed",
      );
      return reply.code(503).send({ status: "unavailable", database: "unavailable" });
    }
  });
  app.get("/api/sources/status", async (request, reply) => {
    const status = await readSourceStatus();
    const staleSources = status.sources
      .filter((source) => source.stale)
      .map((source) => source.kind);
    if (staleSources.length > 0) {
      request.log.warn(
        { event: "source.freshness.stale", sourceKinds: staleSources },
        "One or more source snapshots need attention",
      );
    }
    return reply.send(status);
  });
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
    const disconnect = createClientDisconnectController(request, reply);
    try {
      const priorTurns = await readPriorTurns(parsed.data.priorRulingIds);
      const result = await interpret(
        parsed.data.question,
        request.ip,
        disconnect.signal,
        priorTurns,
      );
      return reply.send(questionInterpretResponseSchema.parse(result));
    } catch (error) {
      if (disconnect.signal.aborted) return reply;
      if (error instanceof AiUsageLimitError) {
        request.log.warn(
          { event: "ai.usage.limit_reached", reason: error.code, statusCode: error.statusCode },
          "AI request blocked by an operational limit",
        );
        return sendAiUsageLimitError(reply, error);
      }
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Question interpretation failed",
      );
      return reply.code(502).send({ error: "QUESTION_INTERPRETATION_UNAVAILABLE" });
    } finally {
      disconnect.cleanup();
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
    // Signing in is optional here; a signed-in ruling is saved to the user's conversation history.
    if (request.headers.authorization !== undefined || parsed.data.conversationId) {
      await authenticate(request, reply);
      if (reply.sent) return reply;
    }
    const owner: RulingOwner | undefined = request.appUser
      ? {
          userId: request.appUser.id,
          ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
        }
      : undefined;
    try {
      // Check before generating so a bad conversation ID does not spend a model call.
      if (
        owner?.conversationId &&
        !(await checkConversationOwner(owner.userId, owner.conversationId))
      )
        return reply.code(404).send({ error: "CONVERSATION_NOT_FOUND" });
    } catch (error) {
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Conversation lookup failed",
      );
      return reply.code(503).send({ error: "CONVERSATIONS_UNAVAILABLE" });
    }
    const disconnect = createClientDisconnectController(request, reply);
    try {
      // In a saved conversation, context may only come from that conversation's own turns.
      const priorTurns = await readPriorTurns(
        parsed.data.priorRulingIds,
        owner?.conversationId
          ? { userId: owner.userId, conversationId: owner.conversationId }
          : undefined,
      );
      const result = await createRuling(parsed.data, request.ip, disconnect.signal, priorTurns);
      return reply.send(
        persistedRulingResponseSchema.parse(await persistRuling(parsed.data, result, owner)),
      );
    } catch (error) {
      if (disconnect.signal.aborted) return reply;
      if (error instanceof AiUsageLimitError) {
        request.log.warn(
          { event: "ai.usage.limit_reached", reason: error.code, statusCode: error.statusCode },
          "AI request blocked by an operational limit",
        );
        return sendAiUsageLimitError(reply, error);
      }
      if (error instanceof InvalidConfirmedCardsError) {
        return reply.code(400).send({ error: "CONFIRMED_CARD_UNAVAILABLE" });
      }
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Ruling generation failed",
      );
      return reply.code(502).send({ error: "RULING_GENERATION_UNAVAILABLE" });
    } finally {
      disconnect.cleanup();
    }
  });
  app.get<{ Params: { rulingId: string }; Querystring: { version?: string } }>(
    "/api/rulings/:rulingId",
    async (request, reply) => {
      if (!isUuid(request.params.rulingId)) {
        return reply.code(400).send({ error: "INVALID_RULING_ID" });
      }
      const version =
        request.query.version === undefined ? undefined : Number(request.query.version);
      if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
        return reply.code(400).send({ error: "INVALID_RULING_VERSION" });
      }
      const result = await readRuling(request.params.rulingId, version);
      if (!result) return reply.code(404).send({ error: "RULING_NOT_FOUND" });
      return reply.send(persistedRulingResponseSchema.parse(result));
    },
  );
  return app;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
