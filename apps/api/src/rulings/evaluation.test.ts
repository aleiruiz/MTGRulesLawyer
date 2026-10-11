import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyRulingOutput } from "./generate.js";
import {
  getCitationRuleNumbers,
  makeEvaluationEvidence,
  makeRecordedModelOutput,
} from "./evaluation-fixtures.js";
import { rulingEvaluationSeedSet } from "./evaluation-seed-set.js";

void describe("Reviewed ruling evaluation seed set", () => {
  void it("loads versioned reviewed fixtures with explicit origins and error categories", () => {
    const reviewedCases = rulingEvaluationSeedSet.filter((fixture) => fixture.errorCategory);
    assert.ok(reviewedCases.length > 0);
    assert.ok(
      reviewedCases.some(
        (fixture) =>
          fixture.reviewSource === "maintainer_curated" && fixture.fixtureOrigin === "synthetic",
      ),
    );
    for (const fixture of reviewedCases) {
      assert.ok(fixture.errorCategory);
      assert.ok(fixture.reviewSource);
      assert.ok(fixture.fixtureOrigin);
      if (fixture.reviewSource === "approved_challenge") {
        assert.equal(fixture.fixtureOrigin, "exported");
      }
      assert.ok(fixture.modelOutput.summary.trim());
    }
  });

  for (const [index, fixture] of rulingEvaluationSeedSet.entries()) {
    void it(`${fixture.id}: ${fixture.title}`, () => {
      const evidence = makeEvaluationEvidence(fixture, index);
      const modelOutput = makeRecordedModelOutput(fixture, evidence);
      const verified = verifyRulingOutput(modelOutput, evidence, "evaluation-fixture");

      assert.equal(verified.outcome, fixture.expectedOutcome);
      assert.deepEqual(getCitationRuleNumbers(verified.citations), fixture.expectedRuleNumbers);
      assert.equal(verified.clarificationQuestions.length, fixture.expectedClarificationCount);
      assert.equal(verified.snapshot.version, "rules-2026-06-19");
    });
  }
});
