import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noteCardKey, selectPromptNotes } from "./notes.js";

const note = (oracleIds: string[], summary: string) => ({
  oracleIds,
  summary,
  reasoning: [`Because of ${summary}.`],
  ruleNumbers: ["405.5"],
});

void describe("judge notes", () => {
  void it("keys notes by the sorted, distinct confirmed cards", () => {
    assert.deepEqual(noteCardKey(["b", "a", "b"]), ["a", "b"]);
  });

  void it("prefers a note about exactly these cards, then the most shared cards", () => {
    const selected = selectPromptNotes(
      ["a", "b", "c"],
      [
        note(["a", "b"], "two shared"),
        note(["a", "x"], "one shared"),
        note(["a", "b", "c"], "exact"),
        note(["a", "b", "c", "d"], "superset"),
      ],
    );
    assert.deepEqual(
      selected.map((item) => item.conclusion),
      ["exact", "superset", "two shared"],
    );
  });

  void it("uses a single-card note only for single-card questions and bounds the text", () => {
    assert.deepEqual(selectPromptNotes(["a", "b"], [note(["a"], "only a")]), []);
    assert.equal(selectPromptNotes(["a"], [note(["a"], "only a")]).length, 1);
    // A note about a different interaction involving the card is not used.
    assert.deepEqual(selectPromptNotes(["a"], [note(["a", "x"], "a with x")]), []);
    const long = selectPromptNotes(["a"], [note(["a"], "x".repeat(5_000))]);
    assert.equal(long[0]?.conclusion.length, 1_500);
  });
});
