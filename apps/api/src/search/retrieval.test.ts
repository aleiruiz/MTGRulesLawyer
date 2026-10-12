import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { needsStackTimingRules, withoutCardNames } from "./retrieval.js";

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

  void it("adds stack rules for timing questions and phase triggers, not for every 'when'", () => {
    assert.equal(needsStackTimingRules("Do both triggers resolve?", []), true);
    assert.equal(
      needsStackTimingRules("What happens?", ["At the beginning of combat on your turn, ..."]),
      true,
    );
    assert.equal(
      needsStackTimingRules("Does it die?", ["When this creature enters, draw a card."]),
      false,
    );
  });
});
