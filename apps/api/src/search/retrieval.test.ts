import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CORE_RULE_NUMBERS, withoutCardNames } from "./retrieval.js";

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
  });
});
