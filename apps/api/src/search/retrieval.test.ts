import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundEvidenceForPrompt } from "../rulings/generate.js";
import { CORE_RULE_NUMBERS, rankRulings, withCoreRules, withoutCardNames } from "./retrieval.js";

void describe("confirmed-card query text", () => {
  void it("removes multi-word card names and their part before a comma", () => {
    assert.equal(
      withoutCardNames("If I have a sakashima of a thousand faces copying it", [
        "Sakashima of a Thousand Faces",
      ]).trim(),
      "If I have a   copying it",
    );
    assert.equal(
      withoutCardNames("Does Lim-Dûl the Necromancer work?", ["Lim-Dûl the Necromancer"]),
      "Does   work?",
    );
  });

  void it("keeps single-word names, which may be rules words", () => {
    const question = "Can I cast Flash at instant speed with flash?";
    assert.equal(withoutCardNames(question, ["Flash", "Gandalf, Party Guest"]), question);
    assert.equal(withoutCardNames("Is Opt a sorcery?", ["Opt"]), "Is Opt a sorcery?");
  });
});

void describe("core rules", () => {
  void it("covers priority, the stack, turn structure, state-based actions and layers", () => {
    for (const section of ["117.", "405.", "603.3b", "608.", "500.1", "704.", "613.1"]) {
      assert.ok(
        CORE_RULE_NUMBERS.some((number) => number.startsWith(section)),
        `missing ${section}`,
      );
    }
    assert.equal(new Set(CORE_RULE_NUMBERS).size, CORE_RULE_NUMBERS.length);
    for (const number of CORE_RULE_NUMBERS) assert.equal(number, number.toLowerCase());
  });

  void it("keeps a core rule the search also found in the prompt, past the searched cap", () => {
    const rule = (id: string, number: string, includedBecause: "MATCH" | "PARENT" | "CORE") => ({
      id,
      number,
      text: `Rule ${number}.`,
      parentNumber: null,
      includedBecause,
      truncated: false,
    });
    const searched = [
      ...Array.from({ length: 14 }, (_, index) => rule(`s${index}`, `999.${index}`, "MATCH")),
      rule("core-613-7", "613.7", "PARENT"),
    ];
    const merged = withCoreRules(searched, [rule("core-613-7", "613.7", "CORE")]);
    assert.equal(merged.filter((item) => item.id === "core-613-7").length, 1);
    const bounded = boundEvidenceForPrompt({
      snapshot: { id: "snapshot", version: "v1", activatedAt: null },
      sources: [],
      cards: [],
      rules: merged,
      truncated: false,
    });
    assert.ok(bounded.rules.some((item) => item.number === "613.7"));
  });
});

void describe("official ruling ranking", () => {
  void it("puts rulings naming another confirmed card first, then shared question words", () => {
    const rulings = [
      { position: 0, text: "This card's ability is a mana ability." },
      { position: 1, text: "If Blood Moon is on the battlefield, this land is a Mountain." },
      { position: 2, text: "Each land is a Swamp in addition to its other types." },
      { position: 3, text: "It doesn't matter who controls it." },
    ];
    assert.deepEqual(
      rankRulings(rulings, "Are all lands Swamps with these on the battlefield?", [
        "Blood Moon",
      ]).map(({ position }) => position),
      [1, 2, 0, 3],
    );
  });
});
