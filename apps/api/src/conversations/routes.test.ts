import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConfirmedQuestionEvidenceRequest,
  ConversationDetailResponse,
  ConversationListResponse,
  PersistedRulingResponse,
  QuestionInterpretResponse,
  RulingGenerationResponse,
} from "@mtg-rules/contracts";
import type { AiUsageIdentity } from "../ai/usage.js";
import { buildApp } from "../app.js";
import type { RulingOwner } from "./attach.js";
import type { PriorTurn } from "./prior-turns.js";

const FIRST_RULING_ID = "00000000-0000-4000-8000-000000000011";
const OWN_CONVERSATION_ID = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CONVERSATION_ID = "00000000-0000-4000-8000-0000000000c2";
const priorTurn: PriorTurn = {
  question: "Does the bolt fizzle?",
  outcome: "resolved",
  summary: "Yes, with no legal target it does not resolve.",
};

const answer: RulingGenerationResponse = {
  outcome: "uncertain",
  summary: "The evidence does not establish a supported outcome.",
  reasoningSteps: [],
  summaryCitationIds: [],
  assumptions: [],
  clarificationQuestions: [],
  citations: [],
  snapshot: { id: "snapshot-id", version: "rules-test", activatedAt: null },
  sources: [],
  modelName: "test-model",
  promptVersion: "test-prompt",
};

function createApp() {
  const calls = {
    priorTurnIds: [] as string[][],
    priorTurnScopes: [] as unknown[],
    interpretTurns: [] as PriorTurn[][],
    rulingTurns: [] as PriorTurn[][],
    owners: [] as Array<RulingOwner | undefined>,
    rulingRequests: [] as ConfirmedQuestionEvidenceRequest[],
    deleted: [] as Array<[string, string]>,
    identities: [] as AiUsageIdentity[],
  };
  const app = buildApp({
    verifyAccessToken: (token) =>
      Promise.resolve(
        token === "owner-token"
          ? { subject: "owner" }
          : token === "other-token"
            ? { subject: "other" }
            : token === "admin-token"
              ? { subject: "admin" }
              : null,
      ),
    resolveAppUser: (subject) =>
      Promise.resolve({ id: `user-${subject}`, role: subject === "admin" ? "ADMIN" : "USER" }),
    loadPriorTurns: (ids, scope) => {
      calls.priorTurnIds.push(ids);
      calls.priorTurnScopes.push(scope);
      return Promise.resolve(ids.length > 0 ? [priorTurn] : []);
    },
    interpretQuestion: (_question, identity, _signal, priorTurns = []) => {
      calls.identities.push(identity);
      calls.interpretTurns.push(priorTurns);
      return Promise.resolve({
        inScope: true,
        scopeReason: "Rules question.",
        cardMentions: [],
        entities: [],
        events: [],
        knownFacts: [],
        missingFacts: [],
        searchTerms: [],
      } satisfies QuestionInterpretResponse);
    },
    generateRuling: (request, identity, _signal, priorTurns = []) => {
      calls.identities.push(identity);
      calls.rulingRequests.push(request);
      calls.rulingTurns.push(priorTurns);
      return Promise.resolve(answer);
    },
    saveRuling: (request, ruling, owner) => {
      calls.owners.push(owner);
      return Promise.resolve({
        rulingId: "00000000-0000-4000-8000-000000000012",
        version: 1,
        createdAt: "2026-10-12T00:00:00.000Z",
        question: request.question,
        confirmedCards: request.confirmedCards ?? [],
        ruling,
        conversationId: owner ? (owner.conversationId ?? OWN_CONVERSATION_ID) : null,
      } satisfies PersistedRulingResponse);
    },
    ownsConversation: (userId, conversationId) =>
      Promise.resolve(userId === "user-owner" && conversationId === OWN_CONVERSATION_ID),
    listConversations: (userId): Promise<ConversationListResponse> =>
      Promise.resolve({
        conversations: [
          {
            id: OWN_CONVERSATION_ID,
            title: `Owned by ${userId}`,
            updatedAt: "2026-10-12T00:00:00.000Z",
            turnCount: 2,
            lastOutcome: "resolved",
          },
        ],
      }),
    getConversation: (userId, conversationId): Promise<ConversationDetailResponse | null> =>
      Promise.resolve(
        userId === "user-owner" && conversationId === OWN_CONVERSATION_ID
          ? {
              id: OWN_CONVERSATION_ID,
              title: "Does the bolt fizzle?",
              updatedAt: "2026-10-12T00:00:00.000Z",
              turns: [],
            }
          : null,
      ),
    deleteConversation: (userId, conversationId) => {
      calls.deleted.push([userId, conversationId]);
      return Promise.resolve(userId === "user-owner" && conversationId === OWN_CONVERSATION_ID);
    },
  });
  return { app, calls };
}

void describe("follow-up questions", () => {
  void it("gives interpretation and ruling the stored prior turns", async () => {
    const { app, calls } = createApp();
    const interpret = await app.inject({
      method: "POST",
      url: "/api/questions/interpret",
      payload: { question: "What if it had hexproof?", priorRulingIds: [FIRST_RULING_ID] },
    });
    assert.equal(interpret.statusCode, 200);
    assert.deepEqual(calls.interpretTurns[0], [priorTurn]);

    const ruling = await app.inject({
      method: "POST",
      url: "/api/questions/ruling",
      payload: { question: "What if it had hexproof?", priorRulingIds: [FIRST_RULING_ID] },
    });
    assert.equal(ruling.statusCode, 200);
    assert.deepEqual(calls.priorTurnIds.at(-1), [FIRST_RULING_ID]);
    assert.deepEqual(calls.rulingTurns[0], [priorTurn]);
    // Anonymous rulings are not saved to anyone's history.
    assert.equal(calls.owners[0], undefined);
    assert.equal(ruling.json<PersistedRulingResponse>().conversationId, null);
  });

  void it("rejects malformed or too many prior ruling IDs", async () => {
    const { app, calls } = createApp();
    const tooMany = Array.from(
      { length: 6 },
      (_, index) => `00000000-0000-4000-8000-00000000002${index}`,
    );
    for (const priorRulingIds of [["not-a-uuid"], tooMany, [FIRST_RULING_ID, FIRST_RULING_ID]]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/questions/ruling",
        payload: { question: "Follow-up?", priorRulingIds },
      });
      assert.equal(response.statusCode, 400);
    }
    assert.equal(calls.rulingRequests.length, 0);
  });
});

void describe("AI quota identity", () => {
  void it("uses the account's limits when signed in and none for an admin", async () => {
    const { app, calls } = createApp();
    const ask = (url: string, token?: string) =>
      app.inject({
        method: "POST",
        url,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        payload: { question: "Does the bolt fizzle?" },
      });
    assert.equal((await ask("/api/questions/interpret")).statusCode, 200);
    assert.equal((await ask("/api/questions/interpret", "owner-token")).statusCode, 200);
    assert.equal((await ask("/api/questions/ruling", "admin-token")).statusCode, 200);
    assert.deepEqual(calls.identities, [
      { clientIp: "127.0.0.1" },
      { clientIp: "127.0.0.1", accountId: "user-owner", unlimited: false },
      { clientIp: "127.0.0.1", accountId: "user-admin", unlimited: true },
    ]);
  });

  void it("rejects an invalid token instead of treating the caller as anonymous", async () => {
    const { app, calls } = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/questions/interpret",
      headers: { authorization: "Bearer forged-token" },
      payload: { question: "Does the bolt fizzle?" },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(calls.identities.length, 0);
  });
});

void describe("signed-in conversation history", () => {
  void it("saves a signed-in ruling to the caller's own conversation", async () => {
    const { app, calls } = createApp();
    const started = await app.inject({
      method: "POST",
      url: "/api/questions/ruling",
      headers: { authorization: "Bearer owner-token" },
      payload: { question: "Does the bolt fizzle?" },
    });
    assert.equal(started.statusCode, 200);
    assert.deepEqual(calls.owners[0], { userId: "user-owner" });
    assert.equal(started.json<PersistedRulingResponse>().conversationId, OWN_CONVERSATION_ID);

    const continued = await app.inject({
      method: "POST",
      url: "/api/questions/ruling",
      headers: { authorization: "Bearer owner-token" },
      payload: {
        question: "And with hexproof?",
        conversationId: OWN_CONVERSATION_ID,
        priorRulingIds: [FIRST_RULING_ID],
      },
    });
    assert.equal(continued.statusCode, 200);
    // Context for a saved conversation is limited to that conversation.
    assert.deepEqual(calls.priorTurnScopes.at(-1), {
      userId: "user-owner",
      conversationId: OWN_CONVERSATION_ID,
    });
    assert.deepEqual(calls.owners[1], {
      userId: "user-owner",
      conversationId: OWN_CONVERSATION_ID,
    });
  });

  void it("refuses to continue a conversation without the owner's session", async () => {
    const { app, calls } = createApp();
    const anonymous = await app.inject({
      method: "POST",
      url: "/api/questions/ruling",
      payload: { question: "Hijack?", conversationId: OWN_CONVERSATION_ID },
    });
    assert.equal(anonymous.statusCode, 401);

    for (const [token, conversationId] of [
      ["other-token", OWN_CONVERSATION_ID],
      ["owner-token", OTHER_CONVERSATION_ID],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/questions/ruling",
        headers: { authorization: `Bearer ${token}` },
        payload: { question: "Hijack?", conversationId },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json<{ error: string }>().error, "CONVERSATION_NOT_FOUND");
    }
    const forged = await app.inject({
      method: "POST",
      url: "/api/questions/ruling",
      headers: { authorization: "Bearer forged" },
      payload: { question: "Who am I?" },
    });
    assert.equal(forged.statusCode, 401);
    // None of the refused requests reached the model.
    assert.equal(calls.rulingRequests.length, 0);
  });

  void it("lists, reads, and deletes only the caller's conversations", async () => {
    const { app, calls } = createApp();
    const unauthenticated = await app.inject({ method: "GET", url: "/api/me/conversations" });
    assert.equal(unauthenticated.statusCode, 401);

    const list = await app.inject({
      method: "GET",
      url: "/api/me/conversations",
      headers: { authorization: "Bearer owner-token" },
    });
    assert.equal(list.statusCode, 200);
    assert.equal(
      list.json<ConversationListResponse>().conversations[0]?.title,
      "Owned by user-owner",
    );

    const own = await app.inject({
      method: "GET",
      url: `/api/me/conversations/${OWN_CONVERSATION_ID}`,
      headers: { authorization: "Bearer owner-token" },
    });
    assert.equal(own.statusCode, 200);
    const foreign = await app.inject({
      method: "GET",
      url: `/api/me/conversations/${OWN_CONVERSATION_ID}`,
      headers: { authorization: "Bearer other-token" },
    });
    assert.equal(foreign.statusCode, 404);
    const invalid = await app.inject({
      method: "GET",
      url: "/api/me/conversations/not-a-uuid",
      headers: { authorization: "Bearer owner-token" },
    });
    assert.equal(invalid.statusCode, 400);

    const foreignDelete = await app.inject({
      method: "DELETE",
      url: `/api/me/conversations/${OWN_CONVERSATION_ID}`,
      headers: { authorization: "Bearer other-token" },
    });
    assert.equal(foreignDelete.statusCode, 404);
    const ownDelete = await app.inject({
      method: "DELETE",
      url: `/api/me/conversations/${OWN_CONVERSATION_ID}`,
      headers: { authorization: "Bearer owner-token" },
    });
    assert.equal(ownDelete.statusCode, 204);
    assert.deepEqual(calls.deleted, [
      ["user-other", OWN_CONVERSATION_ID],
      ["user-owner", OWN_CONVERSATION_ID],
    ]);
  });
});
