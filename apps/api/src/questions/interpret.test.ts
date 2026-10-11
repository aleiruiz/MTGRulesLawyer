import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CardLookupResponse } from "@mtg-rules/contracts";
import { resolveQuestionInterpretation, type ModelQuestionInterpretation } from "./interpret.js";

const interpretedQuestion = {
  inScope: true,
  scopeReason: "This asks about a Magic combat interaction.",
  cardMentions: [
    { text: "Lightning Bolt", start: 0, end: 14 },
    { text: "Lightning Bolt", start: 49, end: 63 },
  ],
  entities: ["Lightning Bolt"],
  events: ["Lightning Bolt is cast", "the opponent responds"],
  knownFacts: ["The question names Lightning Bolt."],
  missingFacts: ["Whether the spell resolves."],
  searchTerms: ["spell resolution", "responses"],
} satisfies ModelQuestionInterpretation;

const card: CardLookupResponse["cards"][number] = {
  oracleId: "oracle-lightning-bolt",
  name: "Lightning Bolt",
  layout: "normal",
  matchedFace: {
    faceIndex: 0,
    role: "FRONT",
    name: "Lightning Bolt",
    manaCost: "{R}",
    typeLine: "Instant",
    oracleText: "Lightning Bolt deals 3 damage to any target.",
    power: null,
    toughness: null,
    imageUri: null,
  },
  faces: [
    {
      faceIndex: 0,
      role: "FRONT",
      name: "Lightning Bolt",
      manaCost: "{R}",
      typeLine: "Instant",
      oracleText: "Lightning Bolt deals 3 damage to any target.",
      power: null,
      toughness: null,
      imageUri: null,
    },
  ],
};

void describe("question interpretation resolution", () => {
  void it("validates mention spans and resolves card identities through exact local lookup", async () => {
    let lookupCount = 0;
    const response = await resolveQuestionInterpretation(
      "Lightning Bolt fizzles if its target leaves, but Lightning Bolt still costs one red.",
      interpretedQuestion,
      (name) => {
        lookupCount += 1;
        assert.equal(name, "Lightning Bolt");
        return Promise.resolve({ cards: [card] });
      },
    );

    assert.equal(lookupCount, 1);
    assert.deepEqual(
      response.cardMentions.map(({ start, end }) => [start, end]),
      [
        [0, 14],
        [49, 63],
      ],
    );
    assert.equal(response.cardMentions[0]?.candidates[0]?.oracleId, "oracle-lightning-bolt");
    assert.equal(response.cardMentions[1]?.candidates[0]?.oracleId, "oracle-lightning-bolt");
    assert.deepEqual(response.missingFacts, ["Whether the spell resolves."]);
  });

  void it("rejects hallucinated mention spans instead of highlighting unrelated text", async () => {
    await assert.rejects(
      resolveQuestionInterpretation("The opponent casts a spell.", interpretedQuestion),
      /mention that does not appear in the question/,
    );
  });

  void it("repairs provider offsets after Unicode text while keeping the mention exact", async () => {
    const response = await resolveQuestionInterpretation(
      "🧙 Lightning Bolt deals damage.",
      { ...interpretedQuestion, cardMentions: [{ text: "Lightning Bolt", start: 0, end: 14 }] },
      () => Promise.resolve({ cards: [card] }),
    );

    assert.deepEqual([response.cardMentions[0]?.start, response.cardMentions[0]?.end], [3, 17]);
  });

  void it("returns every exact identity choice when a card name is ambiguous", async () => {
    const response = await resolveQuestionInterpretation(
      "Lightning Bolt deals damage.",
      { ...interpretedQuestion, cardMentions: [{ text: "Lightning Bolt", start: 0, end: 14 }] },
      () => Promise.resolve({ cards: [card, { ...card, oracleId: "oracle-another-printing" }] }),
    );

    assert.deepEqual(
      response.cardMentions[0]?.candidates.map(({ oracleId }) => oracleId),
      ["oracle-lightning-bolt", "oracle-another-printing"],
    );
  });

  void it("stops off-topic interpretation before resolving card mentions", async () => {
    let lookups = 0;
    const response = await resolveQuestionInterpretation(
      "What is the capital of France?",
      {
        ...interpretedQuestion,
        inScope: false,
        scopeReason: "This is general geography, not a Magic rules question.",
        cardMentions: [{ text: "France", start: 19, end: 25 }],
        entities: ["France"],
        events: ["Question was asked"],
        knownFacts: ["France is a country."],
        searchTerms: ["capital"],
      },
      () => {
        lookups += 1;
        return Promise.resolve({ cards: [] });
      },
    );

    assert.equal(lookups, 0);
    assert.equal(response.inScope, false);
    assert.deepEqual(response.cardMentions, []);
    assert.deepEqual(response.events, []);
    assert.deepEqual(response.searchTerms, []);
  });
});
