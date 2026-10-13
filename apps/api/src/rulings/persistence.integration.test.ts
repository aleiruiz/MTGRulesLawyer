import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus, SourceKind } from "@prisma/client";
import type {
  ConfirmedQuestionEvidenceRequest,
  RulingGenerationResponse,
} from "@mtg-rules/contracts";
import { after, describe, it } from "node:test";
import { getRuling, saveRuling } from "./persistence.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

void describe("Ruling persistence integration", { skip: !enabled }, () => {
  void it("stores and reloads a shareable answer with snapshot citations and confirmed cards", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `r07-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    let questionId: string | undefined;
    try {
      const source = await prisma.sourceSnapshot.create({
        data: {
          snapshotId: snapshot.id,
          kind: SourceKind.COMPREHENSIVE_RULES,
          sourceUrl: "https://example.test/rules",
          sourceVersion: "fixture",
          checksumSha256: "a".repeat(64),
        },
      });
      const rule = await prisma.rule.create({
        data: { snapshotId: snapshot.id, number: "999.1", text: "A test rule.", sortOrder: 1 },
      });
      const request: ConfirmedQuestionEvidenceRequest = {
        question: "Does this test answer cite the stored rule?",
        gameState: { events: [], knownFacts: ["Fixture"], missingFacts: [], searchTerms: [] },
        confirmedCards: [],
      };
      const answer: RulingGenerationResponse = {
        outcome: "resolved",
        summary: "The answer cites the stored rule.",
        reasoningSteps: [{ text: "The rule applies.", citationIds: [rule.id] }],
        summaryCitationIds: [rule.id],
        assumptions: ["The fixture is accurate."],
        clarificationQuestions: [],
        citations: [
          {
            id: rule.id,
            kind: "RULE",
            label: rule.number,
            excerpt: rule.text,
            sourceId: source.id,
            sourceUrl: source.sourceUrl,
          },
        ],
        snapshot: { id: snapshot.id, version: snapshot.version, activatedAt: null },
        sources: [
          {
            id: source.id,
            kind: SourceKind.COMPREHENSIVE_RULES,
            sourceUrl: source.sourceUrl,
            sourceVersion: source.sourceVersion,
            sourcePublishedAt: null,
            checksumSha256: source.checksumSha256,
          },
        ],
        modelName: "fixture-model",
        promptVersion: "fixture-prompt",
      };
      const saved = await saveRuling(request, answer, prisma);
      questionId = (await prisma.ruling.findUniqueOrThrow({ where: { id: saved.rulingId } }))
        .questionId;
      const loaded = await getRuling(saved.rulingId, prisma);

      assert.ok(loaded);
      assert.equal(loaded.ruling.summary, answer.summary);
      assert.equal(loaded.ruling.snapshot.id, snapshot.id);
      assert.deepEqual(loaded.ruling.summaryCitationIds, [rule.id]);
      assert.equal(loaded.ruling.citations[0]?.sourceId, source.id);
      assert.equal(loaded.ruling.citations[0]?.sourceUrl, source.sourceUrl);
      assert.deepEqual(loaded.ruling.assumptions, answer.assumptions);
    } finally {
      if (questionId) await prisma.question.deleteMany({ where: { id: questionId } });
      await prisma.dataSnapshot.deleteMany({ where: { id: snapshot.id } });
    }
  });
});
