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
