import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isYesNoQuestion, rulesDate, splitLead, splitVerdict } from "./verdict-text";

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

void describe("splitLead", () => {
  void it("keeps a short first sentence at full size", () => {
    assert.deepEqual(splitLead("Yes. It deals damage."), {
      lead: "Yes.",
      body: "It deals damage.",
      compact: false,
    });
  });

  void it("keeps a longer first sentence as a compact lead", () => {
    const first = `${"Because ".repeat(15)}it works.`;
    assert.deepEqual(splitLead(`${first} Then it ends.`), {
      lead: first,
      body: "Then it ends.",
      compact: true,
    });
  });

  void it("leaves a paragraph-long first sentence in the body", () => {
    const summary = `${"Because ".repeat(40)}it works.`;
    assert.deepEqual(splitLead(summary), { lead: null, body: summary, compact: false });
  });
});

void describe("isYesNoQuestion", () => {
  void it("recognizes yes/no questions", () => {
    assert.equal(isYesNoQuestion("Did it have a -1/-1 counter on it?"), true);
    assert.equal(isYesNoQuestion("Which creature blocked?"), false);
    assert.equal(isYesNoQuestion("Is it tapped"), false);
  });

  void it("recognizes Spanish yes/no questions", () => {
    assert.equal(isYesNoQuestion("¿Tenía un contador -1/-1 cuando murió?"), true);
    assert.equal(isYesNoQuestion("¿La criatura está girada?"), true);
    assert.equal(isYesNoQuestion("¿Qué criatura bloqueó?"), false);
    assert.equal(isYesNoQuestion("¿Cuántos contadores tenía?"), false);
    assert.equal(isYesNoQuestion("¿Por qué lo sacrificaste?"), false);
  });
});

void describe("rulesDate", () => {
  void it("reads the date from a snapshot version", () => {
    assert.ok(rulesDate("rules-v2-20260925-8d860e451f20")?.includes("2026"));
    assert.equal(rulesDate(null), null);
  });
});
