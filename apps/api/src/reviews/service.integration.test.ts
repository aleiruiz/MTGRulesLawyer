import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import { after, describe, it } from "node:test";
import { listMyChallenges, submitChallenge } from "../challenges/service.js";
import { getReviewQueue, requestMoreInformation } from "./service.js";

const enabled = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const prisma = new PrismaClient();

void after(async () => prisma.$disconnect());

void describe("review service integration", { skip: !enabled }, () => {
  void it("shows the original ruling snapshot and records a request for more information", async () => {
    const suffix = randomUUID();
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `c04-${suffix}`, status: SnapshotStatus.CANDIDATE },
    });
    const challenger = await prisma.appUser.create({
      data: { supabaseUserId: `c04-challenger-${suffix}` },
    });
    const reviewer = await prisma.appUser.create({
      data: { supabaseUserId: `c04-reviewer-${suffix}`, role: "ADMIN" },
    });
    const card = await prisma.card.create({
      data: {
        snapshotId: snapshot.id,
        oracleId: `c04-oracle-${suffix}`,
        name: "Fixture Card",
        layout: "normal",
        faces: {
          create: {
            faceIndex: 0,
            role: "FRONT",
            name: "Fixture Card",
            oracleText: "Fixture oracle text.",
          },
        },
      },
      include: { faces: true },
    });
    const question = await prisma.question.create({
      data: {
        text: "C04 review fixture question",
        gameState: {
          events: ["A creature entered the battlefield."],
          knownFacts: [],
          missingFacts: [],
          searchTerms: [],
        },
        confirmedCards: {
          create: {
            cardId: card.id,
            faceId: card.faces[0]?.id,
            quantity: 2,
            position: 0,
          },
        },
      },
    });
    const ruling = await prisma.ruling.create({
      data: {
        questionId: question.id,
        versions: {
          create: {
            snapshotId: snapshot.id,
            version: 1,
            outcome: "RESOLVED",
            summary: "C04 original answer",
            reasoningSteps: [{ text: "C04 original reasoning." }],
            assumptions: ["C04 original assumption."],
          },
        },
      },
    });
    try {
      const challenge = await submitChallenge(
        {
          rulingId: ruling.id,
          userId: challenger.id,
          explanation: "The original ruling may miss a replacement effect.",
        },
        prisma,
      );
      const before = await getReviewQueue(prisma);
      const queueItem = before.challenges.find(
        (item) => item.challengeId === challenge.challengeId,
      );
      assert.ok(queueItem);
      assert.equal(queueItem.originalRuling.snapshot.version, snapshot.version);
      assert.equal(queueItem.originalRuling.reasoningSteps[0]?.text, "C04 original reasoning.");
      assert.deepEqual(queueItem.originalRuling.gameState.events, [
        "A creature entered the battlefield.",
      ]);
      assert.equal(queueItem.originalRuling.confirmedCards[0]?.faceName, "Fixture Card");

      const reason = "Please identify the replacement effect you believe applies.";
      await requestMoreInformation(challenge.challengeId, reviewer.id, reason, prisma);
      const event = await prisma.reviewEvent.findFirstOrThrow({
        where: { challengeId: challenge.challengeId },
      });
      assert.equal(event.reviewerId, reviewer.id);
      assert.equal(event.reason, reason);
      assert.equal(event.decision, "REQUEST_INFORMATION");
      assert.equal(event.toStatus, "NEEDS_INFORMATION");
      assert.equal(
        (await prisma.challenge.findUniqueOrThrow({ where: { id: challenge.challengeId } })).status,
        "NEEDS_INFORMATION",
      );
      const challengerList = await listMyChallenges(challenger.id, prisma);
      assert.equal(challengerList.challenges[0]?.latestInformationRequest?.reason, reason);
      assert.ok(challengerList.challenges[0]?.latestInformationRequest?.createdAt);
      const updatedItem = (await getReviewQueue(prisma)).challenges.find(
        (item) => item.challengeId === challenge.challengeId,
      );
      assert.equal(updatedItem?.challenge.status, "needs_information");
    } finally {
      await prisma.reviewEvent.deleteMany({
        where: { challenge: { rulingVersion: { rulingId: ruling.id } } },
      });
      await prisma.challenge.deleteMany({ where: { rulingVersion: { rulingId: ruling.id } } });
      await prisma.ruling.delete({ where: { id: ruling.id } });
      await prisma.question.delete({ where: { id: question.id } });
      await prisma.appUser.deleteMany({ where: { id: { in: [challenger.id, reviewer.id] } } });
      await prisma.dataSnapshot.delete({ where: { id: snapshot.id } });
    }
  });
});
