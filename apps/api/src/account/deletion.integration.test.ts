import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import { after, describe, it } from "node:test";
import { DELETED_CHALLENGE_EXPLANATION, deleteAppUserData } from "./deletion.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

void describe("account deletion integration", { skip: !enabled }, () => {
  void it("removes the account, unreviewed challenges and usage, and anonymizes the audit trail", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `l09-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    const player = await prisma.appUser.create({ data: { supabaseUserId: `l09-${randomUUID()}` } });
    const admin = await prisma.appUser.create({
      data: { supabaseUserId: `l09-${randomUUID()}`, role: "ADMIN" },
    });
    const rulingIds: string[] = [];
    const versionIds: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      const question = await prisma.question.create({ data: { text: `L09 fixture ${index}` } });
      const ruling = await prisma.ruling.create({
        data: {
          questionId: question.id,
          versions: {
            create: {
              snapshotId: snapshot.id,
              version: 1,
              outcome: "RESOLVED",
              summary: "Fixture ruling",
              reasoningSteps: [],
            },
          },
        },
        include: { versions: true },
      });
      rulingIds.push(ruling.id);
      versionIds.push(ruling.versions[0].id);
    }
    try {
      const unreviewed = await prisma.challenge.create({
        data: {
          rulingVersionId: versionIds[0],
          userId: player.id,
          explanation: "Private explanation that was never reviewed.",
        },
      });
      const reviewed = await prisma.challenge.create({
        data: {
          rulingVersionId: versionIds[1],
          userId: player.id,
          explanation: "Private explanation an admin reviewed.",
          proposedOutcome: "CONDITIONAL",
          evaluationConsent: true,
          status: "REJECTED",
        },
      });
      const event = await prisma.reviewEvent.create({
        data: {
          challengeId: reviewed.id,
          reviewerId: admin.id,
          decision: "REJECT",
          fromStatus: "OPEN",
          toStatus: "REJECTED",
          reason: "The original ruling was correct.",
          includeInEvaluation: true,
          evaluationFixture: { question: "Sanitized fixture" },
        },
      });
      await prisma.usageWindow.create({
        data: {
          userId: player.id,
          kind: "RULING",
          principalHash: `l09-${randomUUID()}`,
          windowStartedAt: new Date(),
          windowEndsAt: new Date(Date.now() + 60_000),
        },
      });

      assert.deepEqual(await deleteAppUserData(player.id, prisma), {
        supabaseUserId: player.supabaseUserId,
      });
      assert.equal(await prisma.appUser.findUnique({ where: { id: player.id } }), null);
      assert.equal(await prisma.challenge.findUnique({ where: { id: unreviewed.id } }), null);
      assert.equal(await prisma.usageWindow.count({ where: { userId: player.id } }), 0);
      const kept = await prisma.challenge.findUniqueOrThrow({ where: { id: reviewed.id } });
      assert.equal(kept.userId, null);
      assert.equal(kept.explanation, DELETED_CHALLENGE_EXPLANATION);
      assert.equal(kept.proposedOutcome, null);
      assert.equal(kept.evaluationConsent, false);
      assert.equal(kept.status, "REJECTED");
      const withdrawn = await prisma.reviewEvent.findUniqueOrThrow({ where: { id: event.id } });
      assert.equal(withdrawn.includeInEvaluation, false);
      assert.equal(withdrawn.evaluationFixture, null);

      assert.deepEqual(await deleteAppUserData(admin.id, prisma), {
        supabaseUserId: admin.supabaseUserId,
      });
      const keptEvent = await prisma.reviewEvent.findUniqueOrThrow({ where: { id: event.id } });
      assert.equal(keptEvent.reviewerId, null);
      assert.equal(keptEvent.reason, "The original ruling was correct.");
      assert.equal(await deleteAppUserData(admin.id, prisma), null);
    } finally {
      await prisma.reviewEvent.deleteMany({
        where: { challenge: { rulingVersionId: { in: versionIds } } },
      });
      await prisma.challenge.deleteMany({ where: { rulingVersionId: { in: versionIds } } });
      await prisma.ruling.deleteMany({ where: { id: { in: rulingIds } } });
      await prisma.question.deleteMany({ where: { text: { startsWith: "L09 fixture" } } });
      await prisma.appUser.deleteMany({ where: { id: { in: [player.id, admin.id] } } });
      await prisma.dataSnapshot.delete({ where: { id: snapshot.id } });
    }
  });
});
