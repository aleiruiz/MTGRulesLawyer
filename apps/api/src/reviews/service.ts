import { ChallengeStatus, ReviewDecision, type PrismaClient } from "@prisma/client";
import {
  confirmedQuestionEvidenceRequestSchema,
  reviewQueueResponseSchema,
  type ReviewQueueResponse,
} from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";

export class ReviewChallengeNotFoundError extends Error {
  constructor() {
    super("Challenge is unavailable for review.");
    this.name = "ReviewChallengeNotFoundError";
  }
}

export class ReviewChallengeConflictError extends Error {
  constructor() {
    super("Challenge status changed before the review was saved.");
    this.name = "ReviewChallengeConflictError";
  }
}

export async function getReviewQueue(client: PrismaClient = prisma): Promise<ReviewQueueResponse> {
  const rows = await client.challenge.findMany({
    where: { status: { in: [ChallengeStatus.OPEN, ChallengeStatus.NEEDS_INFORMATION] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      id: true,
      explanation: true,
      proposedOutcome: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      rulingVersion: {
        select: {
          version: true,
          outcome: true,
          summary: true,
          reasoningSteps: true,
          assumptions: true,
          snapshot: { select: { version: true, activatedAt: true } },
          citations: { select: { label: true, excerpt: true, sourceUrl: true } },
          ruling: {
            select: {
              id: true,
              question: {
                select: {
                  text: true,
                  gameState: true,
                  confirmedCards: {
                    orderBy: { position: "asc" },
                    select: {
                      quantity: true,
                      card: { select: { oracleId: true, name: true } },
                      face: { select: { faceIndex: true, name: true, oracleText: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      reviewEvents: {
        where: { decision: ReviewDecision.REQUEST_INFORMATION },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { reason: true, createdAt: true },
      },
    },
  });

  return reviewQueueResponseSchema.parse({
    challenges: rows.map((row) => {
      const version = row.rulingVersion;
      const rulingId = version.ruling.id;
      const question = version.ruling.question.text;
      const gameStateResult = confirmedQuestionEvidenceRequestSchema.shape.gameState.safeParse(
        version.ruling.question.gameState ?? undefined,
      );
      const gameState = gameStateResult.success
        ? gameStateResult.data
        : { events: [], knownFacts: [], missingFacts: [], searchTerms: [] };
      const challenge = {
        challengeId: row.id,
        rulingId,
        question,
        explanation: row.explanation,
        proposedOutcome: row.proposedOutcome?.toLowerCase() ?? null,
        status: row.status.toLowerCase(),
        latestInformationRequest: row.reviewEvents[0]
          ? {
              reason: row.reviewEvents[0].reason,
              createdAt: row.reviewEvents[0].createdAt.toISOString(),
            }
          : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
      const reasoningSteps = Array.isArray(version.reasoningSteps)
        ? version.reasoningSteps.flatMap((step) => {
            if (typeof step !== "object" || step === null || !("text" in step)) return [];
            const text = step.text;
            return typeof text === "string" ? [{ text }] : [];
          })
        : [];
      return {
        challengeId: row.id,
        rulingId,
        question,
        challenge,
        originalRuling: {
          version: version.version,
          outcome: version.outcome.toLowerCase(),
          summary: version.summary,
          reasoningSteps,
          assumptions: version.assumptions,
          gameState,
          confirmedCards: version.ruling.question.confirmedCards.map((selected) => ({
            oracleId: selected.card.oracleId,
            cardName: selected.card.name,
            faceIndex: selected.face?.faceIndex ?? null,
            faceName: selected.face?.name ?? null,
            quantity: selected.quantity,
            oracleText: selected.face?.oracleText ?? null,
          })),
          snapshot: {
            version: version.snapshot.version,
            activatedAt: version.snapshot.activatedAt?.toISOString() ?? null,
          },
          citations: version.citations,
        },
      };
    }),
  });
}

export async function requestMoreInformation(
  challengeId: string,
  reviewerId: string,
  reason: string,
  client: PrismaClient = prisma,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const challenge = await tx.challenge.findUnique({
      where: { id: challengeId },
      select: { id: true, status: true },
    });
    if (!challenge) throw new ReviewChallengeNotFoundError();
    if (
      challenge.status !== ChallengeStatus.OPEN &&
      challenge.status !== ChallengeStatus.NEEDS_INFORMATION
    ) {
      throw new ReviewChallengeConflictError();
    }
    const updated = await tx.challenge.updateMany({
      where: { id: challengeId, status: challenge.status },
      data: { status: ChallengeStatus.NEEDS_INFORMATION },
    });
    if (updated.count !== 1) throw new ReviewChallengeConflictError();
    await tx.reviewEvent.create({
      data: {
        challengeId,
        reviewerId,
        decision: ReviewDecision.REQUEST_INFORMATION,
        fromStatus: challenge.status,
        toStatus: ChallengeStatus.NEEDS_INFORMATION,
        reason,
      },
    });
  });
}
