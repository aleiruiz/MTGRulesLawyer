import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CardLookupResponse, PersistedRulingResponse } from "@mtg-rules/contracts";
import {
  contextRulingIds,
  MAX_CHAT_CARDS,
  MAX_CONTEXT_TURNS,
  mergeCards,
  resolveMentions,
  type ChatCard,
} from "./turns";

function candidate(oracleId: string, name: string): CardLookupResponse["cards"][number] {
  return {
    id: `id-${oracleId}`,
    oracleId,
    name,
    layout: "normal",
    matchedFace: {
      id: `face-${oracleId}`,
      faceIndex: 0,
      name,
      manaCost: "",
      typeLine: "Instant",
      oracleText: "",
      power: null,
      toughness: null,
      imageUri: null,
    },
    faces: [],
  } as unknown as CardLookupResponse["cards"][number];
}

function card(oracleId: string): ChatCard {
  return { oracleId, name: oracleId, faceIndex: 0, quantity: 1 };
}

void describe("chat follow-up cards", () => {
  void it("uses single matches, asks about ambiguous ones, and reports misses", () => {
    const resolution = resolveMentions([
      { text: "Bolt", start: 0, end: 4, candidates: [candidate("bolt", "Lightning Bolt")] },
      {
        text: "Jace",
        start: 10,
        end: 14,
        candidates: [candidate("jace-a", "Jace A"), candidate("jace-b", "Jace B")],
      },
      { text: "Nonsense", start: 20, end: 28, candidates: [] },
    ]);
    assert.deepEqual(resolution.resolved, [
      { oracleId: "bolt", name: "Lightning Bolt", faceIndex: 0, quantity: 1 },
    ]);
    assert.equal(resolution.ambiguous[0]?.text, "Jace");
    assert.deepEqual(resolution.unmatched, ["Nonsense"]);
  });

  void it("asks the player to confirm a lone near match instead of using it", () => {
    const guess = { ...candidate("leech", "Mana Leech"), matchKind: "approximate" as const };
    const resolution = resolveMentions([
      { text: "Mana Leek", start: 0, end: 9, candidates: [guess] },
    ]);
    assert.deepEqual(resolution.resolved, []);
    assert.equal(resolution.ambiguous[0]?.text, "Mana Leek");
  });

  void it("settles mentions of cards already in the chat without asking", () => {
    const known = [{ oracleId: "bolt", name: "Lightning Bolt", faceIndex: 0, quantity: 1 }];
    const resolution = resolveMentions(
      [
        {
          text: "Lightning Bolt",
          start: 0,
          end: 14,
          candidates: [
            candidate("bolt-mdfc", "Emeritus // Lightning Bolt"),
            candidate("bolt", "Lightning Bolt"),
          ],
        },
        { text: "Bolt", start: 20, end: 24, candidates: [] },
      ],
      known,
    );
    assert.deepEqual(resolution, { resolved: [], ambiguous: [], unmatched: [] });
  });

  void it("settles a short name to the chat's card even among near matches", () => {
    const near = (oracleId: string, name: string) => ({
      ...candidate(oracleId, name),
      matchKind: "approximate" as const,
    });
    const known = [
      { oracleId: "gandalf-guest", name: "Gandalf, Party Guest", faceIndex: 0, quantity: 1 },
      { oracleId: "brainstorm", name: "Brainstorm", faceIndex: 0, quantity: 1 },
    ];
    const resolution = resolveMentions(
      [
        {
          text: "gandalf",
          start: 0,
          end: 7,
          candidates: [
            near("gandalf-grey", "Gandalf the Grey"),
            near("gandalf-guest", "Gandalf, Party Guest"),
          ],
        },
        // "Storm" is not a word of "Brainstorm", so the player still chooses.
        { text: "Storm", start: 12, end: 17, candidates: [near("brainstorm", "Brainstorm")] },
      ],
      known,
    );
    assert.deepEqual(resolution.resolved, []);
    assert.deepEqual(
      resolution.ambiguous.map((mention) => mention.text),
      ["Storm"],
    );
  });

  void it("keeps earlier cards, skips duplicates, and stops at the card limit", () => {
    assert.deepEqual(
      mergeCards([card("a"), card("b")], [card("b"), card("c")]).map((item) => item.oracleId),
      ["a", "b", "c"],
    );
    const full = Array.from({ length: MAX_CHAT_CARDS }, (_, index) => card(`c${index}`));
    assert.equal(mergeCards(full, [card("extra")]).length, MAX_CHAT_CARDS);
  });

  void it("sends only the latest answered turns as context", () => {
    const rulings = Array.from({ length: MAX_CONTEXT_TURNS + 2 }, (_, index) =>
      index === 1 ? undefined : ({ rulingId: `r${index}` } as PersistedRulingResponse),
    );
    assert.deepEqual(contextRulingIds(rulings), ["r2", "r3", "r4", "r5", "r6"]);
  });
});
