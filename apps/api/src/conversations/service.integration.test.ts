import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus, SourceKind } from "@prisma/client";
import type {
  ConfirmedQuestionEvidenceRequest,
  RulingGenerationResponse,
} from "@mtg-rules/contracts";
import { MAX_SAVED_CONVERSATIONS } from "@mtg-rules/contracts";
import { after, describe, it } from "node:test";
import { saveRuling } from "../rulings/persistence.js";
import { loadPriorTurns } from "./prior-turns.js";
import {
  deleteConversation,
  getConversation,
  listConversations,
  ownsConversation,
} from "./service.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

void describe("Conversation history integration", { skip: !enabled }, () => {
  void it("keeps follow-ups in order, private to their owner, and only the latest ten", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `conversations-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    const owner = await prisma.appUser.create({ data: { supabaseUserId: randomUUID() } });
    const stranger = await prisma.appUser.create({ data: { supabaseUserId: randomUUID() } });
    try {
      const source = await prisma.sourceSnapshot.create({
        data: {
          snapshotId: snapshot.id,
          kind: SourceKind.COMPREHENSIVE_RULES,
          sourceUrl: "https://example.test/rules",
          sourceVersion: "fixture",
          checksumSha256: "b".repeat(64),
        },
      });
      const card = await prisma.card.create({
        data: {
          snapshotId: snapshot.id,
          oracleId: `oracle-${randomUUID()}`,
          name: "Fixture Bolt",
          layout: "normal",
          faces: { create: { faceIndex: 0, name: "Fixture Bolt", oracleText: "Deal 3 damage." } },
        },
      });
      const answer = (summary: string): RulingGenerationResponse => ({
        outcome: "uncertain",
        summary,
        reasoningSteps: [],
        summaryCitationIds: [],
        assumptions: [],
        clarificationQuestions: [],
        citations: [],
        snapshot: { id: snapshot.id, version: snapshot.version, activatedAt: null },
        sources: [
          {
            id: source.id,
            kind: source.kind,
            sourceUrl: source.sourceUrl,
            sourceVersion: source.sourceVersion,
            sourcePublishedAt: null,
            checksumSha256: source.checksumSha256,
          },
        ],
        modelName: "fixture-model",
        promptVersion: "fixture-prompt",
      });
      const request = (question: string): ConfirmedQuestionEvidenceRequest => ({
        question,
        confirmedCards: [{ oracleId: card.oracleId, faceIndex: 0, quantity: 1 }],
      });

      const first = await saveRuling(
        request("Does Fixture Bolt fizzle if its target leaves?"),
        answer("It does not resolve."),
        prisma,
        { userId: owner.id },
      );
      assert.ok(first.conversationId);
      const followUp = await saveRuling(
        request("What if the target gains hexproof instead?"),
        answer("It also does not resolve."),
        prisma,
        { userId: owner.id, conversationId: first.conversationId },
      );
      assert.equal(followUp.conversationId, first.conversationId);

      const detail = await getConversation(owner.id, first.conversationId, prisma);
      assert.ok(detail);
      assert.equal(detail.title, "Does Fixture Bolt fizzle if its target leaves?");
      assert.deepEqual(
        detail.turns.map((turn) => turn.ruling.question),
        [
          "Does Fixture Bolt fizzle if its target leaves?",
          "What if the target gains hexproof instead?",
        ],
      );
      assert.equal(detail.turns[0]?.cards[0]?.name, "Fixture Bolt");

      const priorTurns = await loadPriorTurns([first.rulingId, followUp.rulingId], prisma);
      assert.deepEqual(
        priorTurns.map((turn) => turn.summary),
        ["It does not resolve.", "It also does not resolve."],
      );

      assert.equal(await getConversation(stranger.id, first.conversationId, prisma), null);
      assert.equal(await ownsConversation(stranger.id, first.conversationId, prisma), false);
      // Naming someone else's conversation never joins it; the save starts the caller's own.
      const hijack = await saveRuling(request("Hijack attempt"), answer("No."), prisma, {
        userId: stranger.id,
        conversationId: first.conversationId,
      });
      assert.notEqual(hijack.conversationId, first.conversationId);
      assert.equal(
        (await getConversation(owner.id, first.conversationId, prisma))?.turns.length,
        2,
      );
      // Scoped context ignores rulings from other conversations and other users.
      assert.deepEqual(
        await loadPriorTurns([first.rulingId, hijack.rulingId], prisma, {
          userId: owner.id,
          conversationId: first.conversationId,
        }),
        [priorTurns[0]],
      );

      // A conversation deleted while the judge was thinking does not lose the answer.
      const doomed = await saveRuling(request("Short-lived chat"), answer("Yes."), prisma, {
        userId: owner.id,
      });
      assert.ok(doomed.conversationId);
      assert.equal(await deleteConversation(owner.id, doomed.conversationId, prisma), true);
      const rescued = await saveRuling(request("Still there?"), answer("Saved."), prisma, {
        userId: owner.id,
        conversationId: doomed.conversationId,
      });
      assert.ok(rescued.conversationId);
      assert.notEqual(rescued.conversationId, doomed.conversationId);
      assert.ok(await prisma.ruling.findUnique({ where: { id: rescued.rulingId } }));
      assert.equal(await deleteConversation(stranger.id, first.conversationId, prisma), false);

      for (let index = 0; index < MAX_SAVED_CONVERSATIONS; index += 1) {
        await saveRuling(request(`Separate question ${index}`), answer("Fine."), prisma, {
          userId: owner.id,
        });
      }
      const list = await listConversations(owner.id, prisma);
      assert.equal(list.conversations.length, MAX_SAVED_CONVERSATIONS);
      assert.ok(!list.conversations.some((item) => item.id === first.conversationId));
      assert.equal(await prisma.conversation.count({ where: { userId: owner.id } }), 10);
      // Forgetting a conversation keeps its public rulings.
      assert.ok(await prisma.ruling.findUnique({ where: { id: first.rulingId } }));

      const newest = list.conversations[0];
      assert.ok(newest);
      assert.equal(newest.turnCount, 1);
      assert.equal(newest.lastOutcome, "uncertain");
      assert.equal(await deleteConversation(owner.id, newest.id, prisma), true);
      assert.equal((await listConversations(owner.id, prisma)).conversations.length, 9);
    } finally {
      await prisma.question.deleteMany({ where: { userId: { in: [owner.id, stranger.id] } } });
      await prisma.appUser.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
      await prisma.dataSnapshot.deleteMany({ where: { id: snapshot.id } });
    }
  });
});
