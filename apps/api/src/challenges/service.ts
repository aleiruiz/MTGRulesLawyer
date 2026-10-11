import {
  Prisma,
  type ChallengeStatus,
  type PrismaClient,
  type RulingOutcome,
} from "@prisma/client";
import {
  challengeResponseSchema,
  myChallengesResponseSchema,
  type ChallengeResponse,
  type ChallengeSubmissionRequest,
  type MyChallengesResponse,
} from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";

const CHALLENGES_PER_DAY = 5;
const DAY_MS = 24 * 60 * 60 * 1_000;

export class ChallengeNotFoundError extends Error {
  constructor() {
    super("Ruling is unavailable for challenges.");
    this.name = "ChallengeNotFoundError";
  }
}

export class DuplicateChallengeError extends Error {
  constructor() {
    super("A challenge for this ruling already exists.");
    this.name = "DuplicateChallengeError";
  }
}

export class ChallengeRateLimitError extends Error {
  constructor() {
    super("Challenge daily limit reached.");
    this.name = "ChallengeRateLimitError";
  }
}

export async function submitChallenge(
  input: ChallengeSubmissionRequest & { rulingId: string; userId: string },
  client: PrismaClient = prisma,
  now = new Date(),
): Promise<ChallengeResponse> {
  try {
    const row = await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.userId}, 0))::text`;
      const ruling = await tx.ruling.findUnique({
        where: { id: input.rulingId },
        select: {
          id: true,
          question: { select: { text: true } },
          versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true } },
        },
      });
      const currentVersion = ruling?.versions[0];
      if (!ruling || !currentVersion) throw new ChallengeNotFoundError();

      const existing = await tx.challenge.findUnique({
        where: {
          userId_rulingVersionId: { userId: input.userId, rulingVersionId: currentVersion.id },
        },
        select: { id: true },
      });
      if (existing) throw new DuplicateChallengeError();

      const recentCount = await tx.challenge.count({
        where: { userId: input.userId, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      });
      if (recentCount >= CHALLENGES_PER_DAY) throw new ChallengeRateLimitError();

      const challenge = await tx.challenge.create({
        data: {
          rulingVersionId: currentVersion.id,
          userId: input.userId,
          explanation: input.explanation,
          proposedOutcome: input.proposedOutcome?.toUpperCase() as RulingOutcome | undefined,
          evaluationConsent: input.evaluationConsent,
        },
        select: {
          id: true,
          explanation: true,
          proposedOutcome: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return {
        ...challenge,
        rulingId: ruling.id,
        rulingVersion: currentVersion.version,
        question: ruling.question.text,
      };
    });
    return serializeChallenge({
      ...row,
      latestInformationRequest: null,
      latestDecision: null,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new DuplicateChallengeError();
    }
    throw error;
  }
}

export async function listMyChallenges(
  userId: string,
  client: PrismaClient = prisma,
): Promise<MyChallengesResponse> {
  const challenges = await client.challenge.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      explanation: true,
      proposedOutcome: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      reviewEvents: {
        where: { decision: { in: ["REQUEST_INFORMATION", "APPROVE", "REJECT"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          decision: true,
          reason: true,
          createdAt: true,
          correctedVersion: { select: { rulingId: true, version: true } },
        },
      },
      rulingVersion: {
        select: {
          version: true,
          ruling: { select: { id: true, question: { select: { text: true } } } },
        },
      },
    },
  });
  return myChallengesResponseSchema.parse({
    challenges: challenges.map((challenge) =>
      serializeChallenge({
        ...challenge,
        rulingId: challenge.rulingVersion.ruling.id,
        rulingVersion: challenge.rulingVersion.version,
        question: challenge.rulingVersion.ruling.question.text,
        latestInformationRequest:
          challenge.status === "NEEDS_INFORMATION"
            ? (challenge.reviewEvents.find((event) => event.decision === "REQUEST_INFORMATION") ??
              null)
            : null,
        latestDecision:
          challenge.reviewEvents.flatMap((event) =>
            event.decision === "APPROVE" || event.decision === "REJECT" ? [event] : [],
          )[0] ?? null,
      }),
    ),
  });
}

function serializeChallenge(challenge: {
  id: string;
  rulingId: string;
  rulingVersion: number;
  question: string;
  explanation: string;
  proposedOutcome: RulingOutcome | null;
  status: ChallengeStatus;
  createdAt: Date;
  updatedAt: Date;
  latestInformationRequest: { reason: string; createdAt: Date } | null;
  latestDecision: {
    decision: string;
    reason: string;
    createdAt: Date;
    correctedVersion: { rulingId: string; version: number } | null;
  } | null;
}): ChallengeResponse {
  const outcome = challenge.proposedOutcome?.toLowerCase();
  return challengeResponseSchema.parse({
    challengeId: challenge.id,
    rulingId: challenge.rulingId,
    rulingVersion: challenge.rulingVersion,
    question: challenge.question,
    explanation: challenge.explanation,
    proposedOutcome:
      outcome === "resolved" ||
      outcome === "conditional" ||
      outcome === "needs_information" ||
      outcome === "uncertain"
        ? outcome
        : null,
    status: challenge.status.toLowerCase(),
    latestInformationRequest: challenge.latestInformationRequest
      ? {
          reason: challenge.latestInformationRequest.reason,
          createdAt: challenge.latestInformationRequest.createdAt.toISOString(),
        }
      : null,
    latestDecision: challenge.latestDecision
      ? {
          decision: challenge.latestDecision.decision.toLowerCase(),
          reason: challenge.latestDecision.reason,
          createdAt: challenge.latestDecision.createdAt.toISOString(),
          correctedRulingId: challenge.latestDecision.correctedVersion?.rulingId ?? null,
          correctedRulingVersion: challenge.latestDecision.correctedVersion?.version ?? null,
        }
      : null,
    createdAt: challenge.createdAt.toISOString(),
    updatedAt: challenge.updatedAt.toISOString(),
  });
}
