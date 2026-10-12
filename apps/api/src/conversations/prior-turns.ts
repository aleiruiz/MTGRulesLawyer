import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.js";

/** An earlier question and the judge's latest answer to it, as context for a follow-up. */
export interface PriorTurn {
  question: string;
  outcome: string;
  summary: string;
}

/** Limits prior turns to one user's saved conversation. */
export interface PriorTurnScope {
  userId: string;
  conversationId: string;
}

export type PriorTurnLoader = (rulingIds: string[], scope?: PriorTurnScope) => Promise<PriorTurn[]>;

// Each prior turn costs prompt tokens on every follow-up, so keep them short.
const MAX_PRIOR_QUESTION_CHARACTERS = 500;
const MAX_PRIOR_SUMMARY_CHARACTERS = 600;

/**
 * Loads the stored question and latest answer for each ruling ID, in the order given, and
 * skips unknown IDs. The text comes from stored rulings rather than the request, so a
 * client cannot hand the model an answer the judge never gave. Any public ruling can serve as
 * context for an anonymous follow-up; with a scope, only that conversation's turns count.
 * Either way the prompts treat prior turns as untrusted context, never as evidence.
 */
export async function loadPriorTurns(
  rulingIds: string[],
  client: PrismaClient = prisma,
  scope?: PriorTurnScope,
): Promise<PriorTurn[]> {
  if (rulingIds.length === 0) return [];
  const rulings = await client.ruling.findMany({
    where: {
      id: { in: rulingIds },
      ...(scope
        ? { question: { userId: scope.userId, conversationId: scope.conversationId } }
        : {}),
    },
    select: {
      id: true,
      question: { select: { text: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { outcome: true, summary: true },
      },
    },
  });
  const byId = new Map(rulings.map((ruling) => [ruling.id, ruling]));
  return rulingIds.flatMap((id) => {
    const ruling = byId.get(id);
    const version = ruling?.versions[0];
    if (!ruling || !version) return [];
    return [
      {
        question: ruling.question.text.slice(0, MAX_PRIOR_QUESTION_CHARACTERS),
        outcome: version.outcome.toLowerCase(),
        summary: version.summary.slice(0, MAX_PRIOR_SUMMARY_CHARACTERS),
      },
    ];
  });
}
