import { CitationKind, type PrismaClient } from "@prisma/client";
import {
  persistedRulingResponseSchema,
  confirmedQuestionEvidenceRequestSchema,
  type ConfirmedQuestionEvidenceRequest,
  type PersistedRulingResponse,
  type RulingGenerationResponse,
} from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";
import { attachToConversation, type RulingOwner } from "../conversations/attach.js";

const CITATION_KINDS = {
  RULE: CitationKind.RULE,
  CARD_FACE: CitationKind.CARD,
  CARD_RULING: CitationKind.CARD_RULING,
} as const;

export async function saveRuling(
  request: ConfirmedQuestionEvidenceRequest,
  answer: RulingGenerationResponse,
  client: PrismaClient = prisma,
  owner?: RulingOwner,
): Promise<PersistedRulingResponse> {
  const normalizedRequest = confirmedQuestionEvidenceRequestSchema.parse(request);
  return client.$transaction(async (tx) => {
    const selectedCards = normalizedRequest.confirmedCards.length
      ? await tx.card.findMany({
          where: {
            snapshotId: answer.snapshot.id,
            oracleId: { in: normalizedRequest.confirmedCards.map((card) => card.oracleId) },
          },
          include: { faces: true },
        })
      : [];
    const cardByOracleId = new Map(selectedCards.map((card) => [card.oracleId, card]));
    for (const selection of normalizedRequest.confirmedCards) {
      const card = cardByOracleId.get(selection.oracleId);
      if (!card || !card.faces.some((face) => face.faceIndex === selection.faceIndex)) {
        throw new Error("Confirmed card is not available in the ruling snapshot.");
      }
    }

    const conversationId = owner
      ? await attachToConversation(tx, owner, normalizedRequest.question)
      : null;
    const question = await tx.question.create({
      data: {
        ...(owner ? { userId: owner.userId, conversationId } : {}),
        text: normalizedRequest.question,
        gameState: normalizedRequest.gameState,
        status: answer.outcome === "needs_information" ? "NEEDS_INFORMATION" : "ANSWERED",
        confirmedCards: {
          create: normalizedRequest.confirmedCards.map((selection, position) => {
            const card = cardByOracleId.get(selection.oracleId);
            const face = card?.faces.find((item) => item.faceIndex === selection.faceIndex);
            if (!card || !face) throw new Error("Confirmed card selection disappeared.");
            return {
              cardId: card.id,
              faceId: face.id,
              quantity: selection.quantity,
              position,
              confirmedAt: new Date(),
            };
          }),
        },
      },
    });

    const ruling = await tx.ruling.create({
      data: {
        questionId: question.id,
        versions: {
          create: {
            snapshotId: answer.snapshot.id,
            version: 1,
            outcome: answer.outcome.toUpperCase() as
              "RESOLVED" | "CONDITIONAL" | "NEEDS_INFORMATION" | "UNCERTAIN",
            summary: answer.summary,
            reasoningSteps: answer.reasoningSteps,
            assumptions: answer.assumptions,
            summaryCitationIds: answer.summaryCitationIds,
            clarificationQuestions: answer.clarificationQuestions,
            modelName: answer.modelName,
            promptVersion: answer.promptVersion,
            citations: {
              create: answer.citations.map((citation) => ({
                kind: CITATION_KINDS[citation.kind],
                ...(citation.kind === "RULE"
                  ? { ruleId: citation.id }
                  : citation.kind === "CARD_RULING"
                    ? { cardRulingId: citation.id }
                    : { cardFaceId: citation.id }),
                label: citation.label,
                excerpt: citation.excerpt,
                sourceUrl: citation.sourceUrl,
                sourceSnapshotId: citation.sourceId,
              })),
            },
          },
        },
      },
      include: { versions: true },
    });
    const version = ruling.versions[0];
    if (!version) throw new Error("Saved ruling version could not be loaded.");
    return persistedRulingResponseSchema.parse({
      rulingId: ruling.id,
      version: version.version,
      createdAt: version.createdAt.toISOString(),
      question: normalizedRequest.question,
      confirmedCards: normalizedRequest.confirmedCards,
      ruling: answer,
      conversationId,
    });
  });
}

export async function getRuling(
  rulingId: string,
  client: PrismaClient = prisma,
  versionNumber?: number,
): Promise<PersistedRulingResponse | null> {
  const ruling = await client.ruling.findUnique({
    where: { id: rulingId },
    include: {
      question: {
        include: {
          confirmedCards: { orderBy: { position: "asc" }, include: { card: true, face: true } },
        },
      },
      versions: {
        ...(versionNumber === undefined
          ? { orderBy: { version: "desc" as const }, take: 1 }
          : { where: { version: versionNumber }, take: 1 }),
        include: { snapshot: { include: { sources: true } }, citations: true },
      },
    },
  });
  const version = ruling?.versions[0];
  if (!ruling || !version) return null;
  const sourceById = new Map(version.snapshot.sources.map((source) => [source.id, source]));
  const citations = version.citations.flatMap((citation) => {
    const source = sourceById.get(citation.sourceSnapshotId);
    return source
      ? [
          {
            id: citation.ruleId ?? citation.cardFaceId ?? citation.cardRulingId,
            kind: citation.kind === CitationKind.CARD ? ("CARD_FACE" as const) : citation.kind,
            label: citation.label,
            excerpt: citation.excerpt,
            sourceId: source.id,
            sourceUrl: citation.sourceUrl,
          },
        ]
      : [];
  });
  return persistedRulingResponseSchema.parse({
    rulingId: ruling.id,
    version: version.version,
    createdAt: version.createdAt.toISOString(),
    question: ruling.question.text,
    confirmedCards: ruling.question.confirmedCards.map((selection) => ({
      oracleId: selection.card.oracleId,
      faceIndex: selection.face?.faceIndex ?? 0,
      quantity: selection.quantity,
    })),
    ruling: {
      outcome: version.outcome.toLowerCase(),
      summary: version.summary,
      reasoningSteps: version.reasoningSteps,
      summaryCitationIds: version.summaryCitationIds,
      assumptions: version.assumptions,
      clarificationQuestions: version.clarificationQuestions,
      citations,
      snapshot: {
        id: version.snapshot.id,
        version: version.snapshot.version,
        activatedAt: version.snapshot.activatedAt?.toISOString() ?? null,
      },
      sources: version.snapshot.sources.map((source) => ({
        id: source.id,
        kind: source.kind,
        sourceUrl: source.sourceUrl,
        sourceVersion: source.sourceVersion,
        sourcePublishedAt: source.sourcePublishedAt?.toISOString() ?? null,
        checksumSha256: source.checksumSha256,
      })),
      modelName: version.modelName ?? "unknown",
      promptVersion: version.promptVersion ?? "unknown",
    },
  });
}
