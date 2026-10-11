import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import { after, describe, it } from "node:test";
import {
  ChallengeRateLimitError,
  DuplicateChallengeError,
  listMyChallenges,
  submitChallenge,
} from "./service.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

async function createRuling(snapshotId: string) {
  const question = await prisma.question.create({
    data: { text: `Challenge fixture ${randomUUID()}` },
  });
  const ruling = await prisma.ruling.create({
    data: {
      questionId: question.id,
      versions: {
        create: {
          snapshotId,
          version: 1,
          outcome: "RESOLVED",
          summary: "Fixture ruling",
          reasoningSteps: [],
        },
      },
    },
  });
  return ruling.id;
}

void describe("challenge service integration", { skip: !enabled }, () => {
  void it("links challenges to the signed-in user, prevents duplicates, and scopes status lists", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `c03-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    const firstUser = await prisma.appUser.create({
      data: { supabaseUserId: `c03-${randomUUID()}` },
    });
    const secondUser = await prisma.appUser.create({
      data: { supabaseUserId: `c03-${randomUUID()}` },
    });
    const rulingId = await createRuling(snapshot.id);
    try {
      const input = {
        rulingId,
        userId: firstUser.id,
        explanation: "The ruling did not account for a replacement effect.",
        proposedOutcome: "conditional" as const,
      };
      const submitted = await submitChallenge(input, prisma);
      assert.equal(submitted.rulingId, rulingId);
      assert.equal(submitted.proposedOutcome, "conditional");
      await assert.rejects(submitChallenge(input, prisma), DuplicateChallengeError);

      await submitChallenge({ ...input, userId: secondUser.id }, prisma);
      const firstList = await listMyChallenges(firstUser.id, prisma);
      const secondList = await listMyChallenges(secondUser.id, prisma);
      assert.equal(firstList.challenges.length, 1);
      assert.equal(secondList.challenges.length, 1);
      assert.equal(firstList.challenges[0]?.explanation, input.explanation);
    } finally {
      await prisma.challenge.deleteMany({ where: { rulingVersion: { rulingId } } });
      await prisma.ruling.delete({ where: { id: rulingId } });
      await prisma.appUser.deleteMany({ where: { id: { in: [firstUser.id, secondUser.id] } } });
      await prisma.dataSnapshot.delete({ where: { id: snapshot.id } });
    }
  });

  void it("atomically limits signed-in users to five challenges per rolling day", async () => {
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `c03-limit-${randomUUID()}`, status: SnapshotStatus.CANDIDATE },
    });
    const user = await prisma.appUser.create({ data: { supabaseUserId: `c03-${randomUUID()}` } });
    const rulingIds: string[] = [];
    for (let index = 0; index < 6; index += 1) rulingIds.push(await createRuling(snapshot.id));
    try {
      const outcomes = await Promise.allSettled(
        rulingIds.map((rulingId) =>
          submitChallenge(
            {
              rulingId,
              userId: user.id,
              explanation: `Distinct challenge explanation ${rulingId}`,
            },
            prisma,
          ),
        ),
      );
      assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 5);
      const limited = outcomes.filter((outcome) => outcome.status === "rejected");
      assert.equal(limited.length, 1);
      assert.ok(
        limited[0]?.status === "rejected" && limited[0].reason instanceof ChallengeRateLimitError,
      );
    } finally {
      await prisma.challenge.deleteMany({ where: { userId: user.id } });
      await prisma.ruling.deleteMany({ where: { id: { in: rulingIds } } });
      await prisma.appUser.delete({ where: { id: user.id } });
      await prisma.dataSnapshot.delete({ where: { id: snapshot.id } });
    }
  });
});
