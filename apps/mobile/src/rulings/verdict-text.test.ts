import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isYesNoQuestion, rulesDate, splitVerdict } from "./verdict-text";

void describe("splitVerdict", () => {
  void it("uses a short first sentence as the headline", () => {
    assert.deepEqual(splitVerdict("Up to 5 damage. 2 tramples over first, then 3 more."), {
      headline: "Up to 5 damage.",
      body: "2 tramples over first, then 3 more.",
    });
  });

  void it("keeps a long first sentence in the body", () => {
    const summary = `${"Because ".repeat(15)}it works.`;
    assert.deepEqual(splitVerdict(summary), { headline: null, body: summary });
  });

  void it("handles a one-sentence summary", () => {
    assert.deepEqual(splitVerdict("Yes."), { headline: "Yes.", body: "" });
  });

  void it("does not split decimals or rule numbers", () => {
    assert.equal(
      splitVerdict("Rule 702.19d applies. Then trample.").headline,
      "Rule 702.19d applies.",
    );
  });
});

void describe("isYesNoQuestion", () => {
  void it("recognizes yes/no questions", () => {
    assert.equal(isYesNoQuestion("Did it have a -1/-1 counter on it?"), true);
    assert.equal(isYesNoQuestion("Which creature blocked?"), false);
    assert.equal(isYesNoQuestion("Is it tapped"), false);
  });
});

void describe("rulesDate", () => {
  void it("reads the date from a snapshot version", () => {
    assert.ok(rulesDate("rules-v2-20260925-8d860e451f20")?.includes("2026"));
    assert.equal(rulesDate(null), null);
  });
});
