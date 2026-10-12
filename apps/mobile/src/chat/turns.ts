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

/** True when a mention like "Bears" names a card already in the chat ("Grizzly Bears"). */
function refersToKnownCard(text: string, knownCards: ChatCard[]): boolean {
  const words = text.toLocaleLowerCase("en-US").split(/\s+/).filter(Boolean);
  return knownCards.some((card) => {
    // Whole words only, so a known "Brainstorm" does not hide a mention of "Storm".
    const nameWords = card.name.toLocaleLowerCase("en-US").split(/[\s,/-]+/);
    return words.length > 0 && words.every((word) => nameWords.includes(word));
  });
}

/**
 * Sorts a follow-up's card mentions into usable, needs-a-choice, and not found. Mentions of
 * cards already in the chat are settled without asking: an ambiguous name resolves to the card
 * the player already picked, and a short name like "Bears" is not reported as missing.
 */
export function resolveMentions(
  mentions: Mention[],
  knownCards: ChatCard[] = [],
): MentionResolution {
  const resolution: MentionResolution = { resolved: [], ambiguous: [], unmatched: [] };
  for (const mention of mentions) {
    // Only an exact name settles to a card already in the chat; a near match still asks.
    const known = mention.candidates.find(
      (candidate) =>
        candidate.matchKind !== "approximate" &&
        knownCards.some((card) => card.oracleId === candidate.oracleId),
    );
    const [only, ...others] = mention.candidates;
    if (known) continue;
    if (!only) {
      if (!refersToKnownCard(mention.text, knownCards)) resolution.unmatched.push(mention.text);
    } else if (others.length === 0 && only.matchKind !== "approximate") {
      resolution.resolved.push(toChatCard(only));
    } else resolution.ambiguous.push(mention);
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
