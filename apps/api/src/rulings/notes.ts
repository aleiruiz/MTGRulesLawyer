import type { Prisma, PrismaClient, RulingOutcome } from "@prisma/client";
import type { RulingGenerationResponse } from "@mtg-rules/contracts";
import { prisma as defaultPrisma } from "../db/client.js";

/** What the ruling model sees of a note: our own verified conclusion, never web text. */
export interface PromptNote {
  conclusion: string;
  reasoning: string[];
  ruleNumbers: string[];
}

const MAX_NOTES_PER_PROMPT = 3;
const MAX_NOTE_CHARACTERS = 1_500;
const MAX_SOURCE_URLS = 5;

type NoteClient = Pick<PrismaClient, "judgeNote"> | Prisma.TransactionClient;

export function noteCardKey(oracleIds: string[]): string[] {
  return [...new Set(oracleIds)].sort();
}

/**
 * Notes about the confirmed cards in the active snapshot, most specific first: a note about
 * exactly these cards, then notes sharing the most cards, newest first.
 */
export async function findNotesForCards(
  snapshotId: string,
  oracleIds: string[],
  client: NoteClient = defaultPrisma,
): Promise<PromptNote[]> {
  const key = noteCardKey(oracleIds);
  if (key.length === 0) return [];
  const notes = await client.judgeNote.findMany({
    where: { snapshotId, oracleIds: { hasSome: key } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { oracleIds: true, summary: true, reasoning: true, ruleNumbers: true },
  });
  return selectPromptNotes(key, notes);
}

/** Ranks candidate notes by shared cards (exact set first) and bounds what the prompt gets. */
export function selectPromptNotes(
  key: string[],
  notes: Array<{
    oracleIds: string[];
    summary: string;
    reasoning: string[];
    ruleNumbers: string[];
  }>,
): PromptNote[] {
  const wanted = new Set(key);
  const scored = notes.map((note, index) => {
    const shared = note.oracleIds.filter((id) => wanted.has(id)).length;
    const exact = shared === key.length && note.oracleIds.length === key.length;
    return { note, index, score: (exact ? 1_000 : 0) + shared };
  });
  // Notes about other cards add little; require at least two shared cards unless one was asked.
  const minimumShared = Math.min(2, key.length);
  let remaining = MAX_NOTE_CHARACTERS * MAX_NOTES_PER_PROMPT;
  return scored
    .filter(({ score }) => score % 1_000 >= minimumShared)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_NOTES_PER_PROMPT)
    .flatMap(({ note }) => {
      const conclusion = note.summary.slice(0, Math.min(MAX_NOTE_CHARACTERS, remaining));
      remaining -= conclusion.length;
      if (!conclusion) return [];
      const reasoning: string[] = [];
      for (const step of note.reasoning) {
        if (remaining <= 0) break;
        const text = step.slice(0, remaining);
        remaining -= text.length;
        reasoning.push(text);
      }
      return [{ conclusion, reasoning, ruleNumbers: note.ruleNumbers.slice(0, 12) }];
    });
}

/** Saves a settled answer that web research produced, so later questions need no search. */
export async function saveResearchNote(
  input: {
    snapshotId: string;
    oracleIds: string[];
    answer: RulingGenerationResponse;
    sourceUrls: string[];
  },
  client: NoteClient = defaultPrisma,
): Promise<void> {
  const key = noteCardKey(input.oracleIds);
  if (key.length === 0) return;
  if (input.answer.outcome !== "resolved" && input.answer.outcome !== "conditional") return;
  await client.judgeNote.create({
    data: {
      snapshotId: input.snapshotId,
      oracleIds: key,
      outcome: input.answer.outcome.toUpperCase() as RulingOutcome,
      summary: input.answer.summary,
      reasoning: input.answer.reasoningSteps.map((step) => step.text),
      ruleNumbers: [
        ...new Set(
          input.answer.citations
            .filter((citation) => citation.kind === "RULE")
            .map((citation) => citation.label),
        ),
      ],
      sourceUrls: input.sourceUrls.slice(0, MAX_SOURCE_URLS),
    },
  });
}

/** Removes notes about exactly these cards, e.g. after a reviewer corrects such a ruling. */
export async function deleteNotesForCards(
  oracleIds: string[],
  client: NoteClient = defaultPrisma,
): Promise<number> {
  const key = noteCardKey(oracleIds);
  if (key.length === 0) return 0;
  const deleted = await client.judgeNote.deleteMany({ where: { oracleIds: { equals: key } } });
  return deleted.count;
}
