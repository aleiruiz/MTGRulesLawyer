import type { ChatGameState } from "./api";
import type { ChatCard } from "./turns";

/** The first question of a new chat, prepared on the home screen. */
export interface ChatDraft {
  question: string;
  gameState: ChatGameState;
  cards: ChatCard[];
}

// Drafts only live for the hand-off between screens, so memory is enough. Route params would
// put the question text in the URL, which ends up in web history.
const drafts = new Map<string, ChatDraft>();
let nextDraftId = 0;

export function saveDraft(draft: ChatDraft): string {
  nextDraftId += 1;
  const id = `draft-${Date.now()}-${nextDraftId}`;
  drafts.set(id, draft);
  return id;
}

/** A reload finds nothing, since drafts are never persisted. */
export function getDraft(id: string): ChatDraft | undefined {
  return drafts.get(id);
}

export function discardDraft(id: string): void {
  drafts.delete(id);
}
