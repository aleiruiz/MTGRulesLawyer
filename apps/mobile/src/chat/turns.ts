import type {
  CardLookupResponse,
  PersistedRulingResponse,
  QuestionInterpretResponse,
} from "@mtg-rules/contracts";

// Keep in sync with MAX_CONFIRMED_CARDS and MAX_PRIOR_TURNS in @mtg-rules/contracts. They are
// repeated here so this module stays importable from plain Node tests.
export const MAX_CHAT_CARDS = 10;
export const MAX_CONTEXT_TURNS = 5;

/** A confirmed card as the chat shows it: identity plus a display name. */
export interface ChatCard {
  oracleId: string;
  name: string;
  faceIndex: number;
  quantity: number;
}

type Mention = QuestionInterpretResponse["cardMentions"][number];
type Candidate = CardLookupResponse["cards"][number];

export interface MentionResolution {
  /** Mentions with exactly one candidate, ready to use. */
  resolved: ChatCard[];
  /** Mentions with several candidates; the player has to pick one. */
  ambiguous: Mention[];
  /** Mention text with no card match in the active data. */
  unmatched: string[];
}

export function toChatCard(candidate: Candidate): ChatCard {
  return {
    oracleId: candidate.oracleId,
    name: candidate.name,
    faceIndex: candidate.matchedFace.faceIndex,
    quantity: 1,
  };
}

/** Sorts a follow-up's card mentions into usable, needs-a-choice, and not found. */
export function resolveMentions(mentions: Mention[]): MentionResolution {
  const resolution: MentionResolution = { resolved: [], ambiguous: [], unmatched: [] };
  for (const mention of mentions) {
    const [only, ...others] = mention.candidates;
    if (!only) resolution.unmatched.push(mention.text);
    else if (others.length === 0) resolution.resolved.push(toChatCard(only));
    else resolution.ambiguous.push(mention);
  }
  return resolution;
}

/**
 * Cards carried from earlier turns plus the follow-up's new ones, without duplicates.
 * Earlier cards keep their place; new cards that do not fit the limit are dropped.
 */
export function mergeCards(previous: ChatCard[], added: ChatCard[]): ChatCard[] {
  const merged = [...previous];
  for (const card of added) {
    if (merged.some((existing) => existing.oracleId === card.oracleId)) continue;
    if (merged.length >= MAX_CHAT_CARDS) break;
    merged.push(card);
  }
  return merged;
}

/** The most recent answered turns, oldest first, as context for the next question. */
export function contextRulingIds(rulings: Array<PersistedRulingResponse | undefined>): string[] {
  return rulings.flatMap((ruling) => (ruling ? [ruling.rulingId] : [])).slice(-MAX_CONTEXT_TURNS);
}
