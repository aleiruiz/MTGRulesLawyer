import {
  conversationDetailResponseSchema,
  conversationListResponseSchema,
  persistedRulingResponseSchema,
  questionInterpretResponseSchema,
  type ConversationDetailResponse,
  type ConversationListResponse,
  type PersistedRulingResponse,
  type QuestionInterpretResponse,
} from "@mtg-rules/contracts";
import { apiUrl } from "../api-url";
import {
  QuestionRequestError,
  questionConnectionError,
  questionErrorMessage,
} from "../questions/question-error-message";
import { strings } from "../i18n/core";
import type { ChatCard } from "./turns";

/** Game facts the interpretation step extracted, sent along with the ruling request. */
export interface ChatGameState {
  events: string[];
  knownFacts: string[];
  missingFacts: string[];
  searchTerms: string[];
}

export const emptyGameState: ChatGameState = {
  events: [],
  knownFacts: [],
  missingFacts: [],
  searchTerms: [],
};

function errorMessages(): Record<string, string> {
  const t = strings().errors;
  return {
    CONVERSATION_NOT_FOUND: t.conversationNotFound,
    CONFIRMED_CARD_UNAVAILABLE: t.cardUnavailable,
    AUTHENTICATION_REQUIRED: t.sessionEnded,
    INVALID_ACCESS_TOKEN: t.sessionEnded,
  };
}

async function requestJson(
  path: string,
  init: RequestInit & { accessToken?: string },
  fallback = strings().errors.judgeUnavailable,
): Promise<unknown> {
  const { accessToken, headers, ...rest } = init;
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...rest,
      headers: {
        ...(rest.body ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(headers as Record<string, string> | undefined),
      },
    });
  } catch (error) {
    // Let cancellation propagate as-is; anything else is a connection problem.
    if (rest.signal?.aborted) throw error;
    throw new QuestionRequestError(questionConnectionError());
  }
  if (response.status === 204) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : undefined;
    const retryAfter =
      typeof body === "object" &&
      body !== null &&
      "retryAfterSeconds" in body &&
      typeof body.retryAfterSeconds === "number"
        ? body.retryAfterSeconds
        : undefined;
    // No JSON body means a proxy or gateway answered, not the API.
    if (body === null) throw new QuestionRequestError(questionConnectionError());
    throw new QuestionRequestError(
      (code && errorMessages()[code]) ?? questionErrorMessage(code, retryAfter, fallback),
    );
  }
  return body;
}

export async function interpretFollowUp(
  question: string,
  priorRulingIds: string[],
  signal?: AbortSignal,
): Promise<QuestionInterpretResponse> {
  return questionInterpretResponseSchema.parse(
    await requestJson("/api/questions/interpret", {
      method: "POST",
      body: JSON.stringify({ question, priorRulingIds }),
      signal,
    }),
  );
}

export async function askJudge(
  input: {
    question: string;
    gameState: ChatGameState;
    cards: ChatCard[];
    priorRulingIds: string[];
    conversationId?: string;
  },
  accessToken: string | undefined,
  signal?: AbortSignal,
): Promise<PersistedRulingResponse> {
  return persistedRulingResponseSchema.parse(
    await requestJson("/api/questions/ruling", {
      method: "POST",
      accessToken,
      signal,
      body: JSON.stringify({
        question: input.question,
        gameState: input.gameState,
        confirmedCards: input.cards.map(({ oracleId, faceIndex, quantity }) => ({
          oracleId,
          faceIndex,
          quantity,
        })),
        priorRulingIds: input.priorRulingIds,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      }),
    }),
  );
}

export async function fetchConversations(accessToken: string): Promise<ConversationListResponse> {
  return conversationListResponseSchema.parse(
    await requestJson(
      "/api/me/conversations",
      { method: "GET", accessToken },
      strings().recent.unavailable,
    ),
  );
}

export async function fetchConversation(
  accessToken: string,
  conversationId: string,
): Promise<ConversationDetailResponse> {
  return conversationDetailResponseSchema.parse(
    await requestJson(
      `/api/me/conversations/${encodeURIComponent(conversationId)}`,
      { method: "GET", accessToken },
      strings().chat.couldNotOpen,
    ),
  );
}

export async function removeConversation(
  accessToken: string,
  conversationId: string,
): Promise<void> {
  await requestJson(
    `/api/me/conversations/${encodeURIComponent(conversationId)}`,
    { method: "DELETE", accessToken },
    strings().recent.deleteFailed,
  );
}
