import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { questionErrorMessage } from "./question-error-message";

void describe("question error messages", () => {
  void it("never shows internal error codes", () => {
    for (const code of [
      "QUESTION_INTERPRETATION_UNAVAILABLE",
      "AI_DAILY_LIMIT",
      "AI_IP_BURST_LIMIT",
      "AI_GLOBAL_COST_LIMIT",
      undefined,
    ]) {
      const message = questionErrorMessage(code, 120);
      assert.doesNotMatch(message, /[A-Z]+_[A-Z]+/);
    }
  });

  void it("explains limits with a readable wait", () => {
    assert.equal(
      questionErrorMessage("AI_DAILY_LIMIT", 7_200),
      "You have reached today's limit of rules questions. Try again in 2 hours.",
    );
    assert.equal(
      questionErrorMessage("AI_IP_BURST_LIMIT"),
      "Too many questions in a short time. Wait a moment and try again.",
    );
    assert.equal(
      questionErrorMessage("AI_CONCURRENCY_LIMIT", 1),
      "The rules assistant is busy or paused right now. Try again in a moment.",
    );
  });

  void it("uses the caller's fallback for unknown codes", () => {
    assert.equal(
      questionErrorMessage("RULING_GENERATION_UNAVAILABLE", undefined, "The judge is unavailable."),
      "The judge is unavailable.",
    );
  });
});
