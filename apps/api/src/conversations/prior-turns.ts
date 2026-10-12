import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.js";

/** An earlier question and the judge's latest answer to it, as context for a follow-up. */
export interface PriorTurn {
  question: string;
  outcome: string;
  summary: string;
}

export type PriorTurnLoader = (rulingIds: string[]) => Promise<PriorTurn[]>;

// Each prior turn costs prompt tokens on every follow-up, so keep them short.
const MAX_PRIOR_QUESTION_CHARACTERS = 500;
const MAX_PRIOR_SUMMARY_CHARACTERS = 600;

/**
 * Loads the stored question and latest answer for each ruling ID, in the order given.
 * The text comes from the database, never from the client, so a follow-up cannot smuggle in
 * a fabricated "earlier answer". Unknown IDs are skipped.
 */
export async function loadPriorTurns(
  rulingIds: string[],
  client: PrismaClient = prisma,
): Promise<PriorTurn[]> {
  if (rulingIds.length === 0) return [];
  const rulings = await client.ruling.findMany({
    where: { id: { in: rulingIds } },
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
