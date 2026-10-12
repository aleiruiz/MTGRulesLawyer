import type { PrismaClient } from "@prisma/client";
import {
  conversationDetailResponseSchema,
  conversationListResponseSchema,
  MAX_SAVED_CONVERSATIONS,
  type ConversationDetailResponse,
  type ConversationListResponse,
} from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";
import { getRuling } from "../rulings/persistence.js";

// Detail views load each turn's full ruling; a very long chat only shows its latest turns.
const MAX_TURNS_IN_DETAIL = 20;

export async function listConversations(
  userId: string,
  client: PrismaClient = prisma,
): Promise<ConversationListResponse> {
  const conversations = await client.conversation.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: MAX_SAVED_CONVERSATIONS,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { questions: true } },
      questions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          ruling: {
            select: {
              versions: { orderBy: { version: "desc" }, take: 1, select: { outcome: true } },
            },
          },
        },
      },
    },
  });
  return conversationListResponseSchema.parse({
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
      turnCount: conversation._count.questions,
      lastOutcome: conversation.questions[0]?.ruling?.versions[0]?.outcome.toLowerCase() ?? null,
    })),
  });
}

/** Returns null when the conversation does not exist or belongs to someone else. */
export async function getConversation(
  userId: string,
  conversationId: string,
  client: PrismaClient = prisma,
): Promise<ConversationDetailResponse | null> {
  const conversation = await client.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      questions: {
        where: { ruling: { isNot: null } },
        orderBy: { createdAt: "desc" },
        take: MAX_TURNS_IN_DETAIL,
        select: {
          ruling: { select: { id: true } },
          confirmedCards: {
            orderBy: { position: "asc" },
            select: {
              quantity: true,
              card: { select: { oracleId: true, name: true } },
              face: { select: { faceIndex: true } },
            },
          },
        },
      },
    },
  });
  if (!conversation) return null;
  const questions = [...conversation.questions].reverse();
  // Bounded by MAX_TURNS_IN_DETAIL; the reads run in parallel rather than one after another.
  const rulings = await Promise.all(
    questions.map((question) =>
      question.ruling ? getRuling(question.ruling.id, client) : Promise.resolve(null),
    ),
  );
  const turns = questions.flatMap((question, index) => {
    const ruling = rulings[index];
    if (!ruling) return [];
    return [
      {
        ruling: { ...ruling, conversationId: conversation.id },
        cards: question.confirmedCards.map((selection) => ({
          oracleId: selection.card.oracleId,
          name: selection.card.name,
          faceIndex: selection.face?.faceIndex ?? 0,
          quantity: selection.quantity,
        })),
      },
    ];
  });
  return conversationDetailResponseSchema.parse({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updatedAt.toISOString(),
    turns,
  });
}

/** Returns false when there was nothing of the user's to delete. */
export async function deleteConversation(
  userId: string,
  conversationId: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  const deleted = await client.conversation.deleteMany({ where: { id: conversationId, userId } });
  return deleted.count > 0;
}

export async function ownsConversation(
  userId: string,
  conversationId: string,
  client: PrismaClient = prisma,
): Promise<boolean> {
  const conversation = await client.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  return conversation !== null;
}
