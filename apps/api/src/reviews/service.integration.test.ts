import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, SnapshotStatus } from "@prisma/client";
import { after, describe, it } from "node:test";
import { listMyChallenges, submitChallenge } from "../challenges/service.js";
import { getRuling } from "../rulings/persistence.js";
import {
  decideChallenge,
  getReviewQueue,
  requestMoreInformation,
  ReviewChallengeConflictError,
} from "./service.js";

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
            reasoningSteps: [{ text: "C04 original reasoning.", citationIds: [] }],
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
      const informationRequested = (await getReviewQueue(prisma)).challenges.find(
        (item) => item.challengeId === challenge.challengeId,
      );
      assert.equal(informationRequested?.challenge.status, "needs_information");

      const decisions = await Promise.allSettled([
        decideChallenge(
          challenge.challengeId,
          reviewer.id,
          {
            decision: "approve",
            reason: "The challenger identified the applicable replacement effect.",
            correction: {
              outcome: "conditional",
              summary: "The spell resolves conditionally after applying the replacement effect.",
              reasoningSteps: ["Apply the replacement effect before determining the final result."],
              assumptions: ["No later effect changes the outcome."],
            },
          },
          prisma,
        ),
        decideChallenge(
          challenge.challengeId,
          reviewer.id,
          { decision: "reject", reason: "The original result follows from the cited rules." },
          prisma,
        ),
      ]);
      assert.equal(decisions.filter((decision) => decision.status === "fulfilled").length, 1);
      const rejectedDecision = decisions.find((decision) => decision.status === "rejected");
      assert.ok(
        rejectedDecision?.status === "rejected" &&
          rejectedDecision.reason instanceof ReviewChallengeConflictError,
      );
      const finalChallenge = await prisma.challenge.findUniqueOrThrow({
        where: { id: challenge.challengeId },
      });
      const reviewEvents = await prisma.reviewEvent.findMany({
        where: { challengeId: challenge.challengeId },
        orderBy: { createdAt: "asc" },
      });
      assert.equal(reviewEvents.length, 2);
      assert.ok(finalChallenge.status === "APPROVED" || finalChallenge.status === "REJECTED");
      if (finalChallenge.status === "APPROVED") {
        const original = await getRuling(ruling.id, prisma, 1);
        const corrected = await getRuling(ruling.id, prisma, 2);
        assert.equal(original?.ruling.summary, "C04 original answer");
        assert.equal(
          corrected?.ruling.summary,
          "The spell resolves conditionally after applying the replacement effect.",
        );
        const finalList = await listMyChallenges(challenger.id, prisma);
        assert.equal(finalList.challenges[0]?.latestDecision?.decision, "approve");
        assert.equal(finalList.challenges[0]?.latestDecision?.correctedRulingVersion, 2);
      } else {
        const finalList = await listMyChallenges(challenger.id, prisma);
        assert.equal(finalList.challenges[0]?.latestDecision?.decision, "reject");
        assert.equal(finalList.challenges[0]?.latestDecision?.correctedRulingVersion, null);
      }
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

  void it("rejects a challenge with an immutable reason and no corrected version", async () => {
    const suffix = randomUUID();
    const snapshot = await prisma.dataSnapshot.create({
      data: { version: `c05-reject-${suffix}`, status: SnapshotStatus.CANDIDATE },
    });
    const challenger = await prisma.appUser.create({
      data: { supabaseUserId: `c05-reject-user-${suffix}` },
    });
    const reviewer = await prisma.appUser.create({
      data: { supabaseUserId: `c05-reject-admin-${suffix}`, role: "ADMIN" },
    });
    const question = await prisma.question.create({ data: { text: "C05 rejection fixture" } });
    const ruling = await prisma.ruling.create({
      data: {
        questionId: question.id,
        versions: {
          create: {
            snapshotId: snapshot.id,
            version: 1,
            outcome: "UNCERTAIN",
            summary: "Original uncertain answer",
            reasoningSteps: [{ text: "More facts are needed.", citationIds: [] }],
          },
        },
      },
    });
    try {
      const challenge = await submitChallenge(
        {
          rulingId: ruling.id,
          userId: challenger.id,
          explanation: "This answer has enough evidence.",
        },
        prisma,
      );
      const reason = "The cited evidence does not support the proposed correction.";
      const result = await decideChallenge(
        challenge.challengeId,
        reviewer.id,
        { decision: "reject", reason },
        prisma,
      );
      assert.equal(result.status, "rejected");
      assert.equal(result.correctedRulingVersion, null);
      assert.equal(await prisma.rulingVersion.count({ where: { rulingId: ruling.id } }), 1);
      const event = await prisma.reviewEvent.findFirstOrThrow({
        where: { challengeId: challenge.challengeId },
      });
      assert.equal(event.reason, reason);
      assert.equal(event.reviewerId, reviewer.id);
      assert.equal(event.decision, "REJECT");
      const ownList = await listMyChallenges(challenger.id, prisma);
      assert.equal(ownList.challenges[0]?.latestDecision?.decision, "reject");
      assert.equal(ownList.challenges[0]?.latestDecision?.reason, reason);
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
