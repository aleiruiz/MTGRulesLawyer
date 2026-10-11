import {
  ChallengeStatus,
  ReviewDecision,
  type PrismaClient,
  type ReviewErrorCategory,
} from "@prisma/client";
import {
  confirmedQuestionEvidenceRequestSchema,
  reviewDecisionResponseSchema,
  reviewQueueResponseSchema,
  type ReviewDecisionRequest,
  type ReviewDecisionResponse,
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

export class ReviewEvaluationConsentRequiredError extends Error {
  constructor() {
    super("The challenger has not opted into evaluation use.");
    this.name = "ReviewEvaluationConsentRequiredError";
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
      evaluationConsent: true,
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
        rulingVersion: version.version,
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
        latestDecision: null,
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
        evaluationConsent: row.evaluationConsent,
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

export async function decideChallenge(
  challengeId: string,
  reviewerId: string,
  decision: ReviewDecisionRequest,
  client: PrismaClient = prisma,
): Promise<ReviewDecisionResponse> {
  return client.$transaction(async (tx) => {
    const challengeReference = await tx.challenge.findUnique({
      where: { id: challengeId },
      select: { rulingVersion: { select: { rulingId: true } } },
    });
    if (!challengeReference) throw new ReviewChallengeNotFoundError();
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${challengeReference.rulingVersion.rulingId}, 1))::text`;
    const challenge = await tx.challenge.findUnique({
      where: { id: challengeId },
      select: {
        id: true,
        status: true,
        evaluationConsent: true,
        rulingVersion: {
          select: {
            rulingId: true,
            snapshotId: true,
            citations: {
              select: {
                kind: true,
                ruleId: true,
                cardFaceId: true,
                label: true,
                excerpt: true,
                sourceUrl: true,
                sourceSnapshotId: true,
              },
            },
          },
        },
      },
    });
    if (!challenge) throw new ReviewChallengeNotFoundError();
    if (
      decision.decision === "approve" &&
      decision.correction.includeInEvaluation &&
      !challenge.evaluationConsent
    ) {
      throw new ReviewEvaluationConsentRequiredError();
    }
    if (
      challenge.status !== ChallengeStatus.OPEN &&
      challenge.status !== ChallengeStatus.NEEDS_INFORMATION
    ) {
      throw new ReviewChallengeConflictError();
    }

    const toStatus =
      decision.decision === "approve" ? ChallengeStatus.APPROVED : ChallengeStatus.REJECTED;
    const updated = await tx.challenge.updateMany({
      where: { id: challengeId, status: challenge.status },
      data: { status: toStatus },
    });
    if (updated.count !== 1) throw new ReviewChallengeConflictError();

    let correctedVersionId: string | null = null;
    let correctedRulingVersion: number | null = null;
    if (decision.decision === "approve") {
      const latestVersion = await tx.rulingVersion.aggregate({
        where: { rulingId: challenge.rulingVersion.rulingId },
        _max: { version: true },
      });
      const evidenceIds = challenge.rulingVersion.citations
        .map((citation) => citation.ruleId ?? citation.cardFaceId)
        .filter((id): id is string => id !== null);
      const corrected = await tx.rulingVersion.create({
        data: {
          rulingId: challenge.rulingVersion.rulingId,
          snapshotId: challenge.rulingVersion.snapshotId,
          version: (latestVersion._max.version ?? 0) + 1,
          outcome: decision.correction.outcome.toUpperCase() as
            "RESOLVED" | "CONDITIONAL" | "NEEDS_INFORMATION" | "UNCERTAIN",
          summary: decision.correction.summary,
          reasoningSteps: decision.correction.reasoningSteps.map((text) => ({
            text,
            citationIds: evidenceIds.slice(0, 8),
          })),
          assumptions: decision.correction.assumptions,
          summaryCitationIds: evidenceIds.slice(0, 8),
          clarificationQuestions: [],
          modelName: "human-review",
          promptVersion: "review-correction-v1",
          citations: {
            create: challenge.rulingVersion.citations.map((citation) => ({
              kind: citation.kind,
              ruleId: citation.ruleId,
              cardFaceId: citation.cardFaceId,
              label: citation.label,
              excerpt: citation.excerpt,
              sourceUrl: citation.sourceUrl,
              sourceSnapshotId: citation.sourceSnapshotId,
            })),
          },
        },
        select: { id: true, version: true },
      });
      correctedVersionId = corrected.id;
      correctedRulingVersion = corrected.version;
    }

    await tx.reviewEvent.create({
      data: {
        challengeId,
        reviewerId,
        decision: decision.decision === "approve" ? ReviewDecision.APPROVE : ReviewDecision.REJECT,
        errorCategory:
          decision.decision === "approve"
            ? (decision.correction.errorCategory.toUpperCase() as ReviewErrorCategory)
            : null,
        includeInEvaluation:
          decision.decision === "approve" && decision.correction.includeInEvaluation,
        ...(decision.decision === "approve" && decision.correction.includeInEvaluation
          ? {
              evaluationFixture: decision.correction.evaluationFixture,
            }
          : {}),
        fromStatus: challenge.status,
        toStatus,
        reason: decision.reason,
        correctedVersionId,
      },
    });
    return reviewDecisionResponseSchema.parse({
      challengeId,
      status: toStatus.toLowerCase(),
      correctedRulingId: decision.decision === "approve" ? challenge.rulingVersion.rulingId : null,
      correctedRulingVersion,
    });
  });
}
