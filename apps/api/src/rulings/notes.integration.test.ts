import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import { after, describe, it } from "node:test";
import type { RulingGenerationResponse } from "@mtg-rules/contracts";
import { deleteNotesForCards, findNotesForCards, saveResearchNote } from "./notes.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

function answer(outcome: RulingGenerationResponse["outcome"]): RulingGenerationResponse {
  return {
    outcome,
    summary: "Both spells can be cast, one per trigger.",
    reasoningSteps: [{ text: "The triggers resolve one at a time.", citationIds: ["r1"] }],
    summaryCitationIds: ["r1"],
    assumptions: [],
    clarificationQuestions: [],
    citations: [
      {
        id: "r1",
        kind: "RULE",
        label: "405.5",
        excerpt: "Top resolves first.",
        sourceUrl: "https://example.com/rules",
      },
    ],
    snapshot: { id: "s", version: "v", activatedAt: null },
    sources: [],
    modelName: "test",
    promptVersion: "test",
  } as unknown as RulingGenerationResponse;
}

void describe("judge notes integration", { skip: !enabled }, () => {
  void it("saves settled research, finds it for the same cards, and deletes it on correction", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `notes-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    const cards = [`card-b-${randomUUID()}`, `card-a-${randomUUID()}`];
    try {
      await saveResearchNote(
        {
          snapshotId: snapshot.id,
          oracleIds: cards,
          answer: answer("resolved"),
          sourceUrls: ["https://judges.example/ruling"],
        },
        prisma,
      );
      await saveResearchNote(
        { snapshotId: snapshot.id, oracleIds: cards, answer: answer("uncertain"), sourceUrls: [] },
        prisma,
      );
      const found = await findNotesForCards(snapshot.id, [...cards].reverse(), prisma);
      assert.equal(found.length, 1);
      assert.deepEqual(found[0]?.ruleNumbers, ["405.5"]);
      // Notes from another snapshot are not used.
      assert.deepEqual(await findNotesForCards(randomUUID(), cards, prisma), []);

      assert.equal(await deleteNotesForCards(cards, prisma), 1);
      assert.deepEqual(await findNotesForCards(snapshot.id, cards, prisma), []);
    } finally {
      await prisma.dataSnapshot.delete({ where: { id: snapshot.id } });
    }
  });
});
