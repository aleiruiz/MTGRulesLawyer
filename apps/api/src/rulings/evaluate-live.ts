import "dotenv/config";
import { createOpenAiAdapter, readOpenAiConfig } from "../ai/openai.js";
import {
  boundEvidenceForPrompt,
  buildModelPrompt,
  createClarificationResponse,
  modelRulingSchema,
  RULING_PROMPT_VERSION,
  RULING_SYSTEM_PROMPT,
  verifyRulingOutput,
} from "./generate.js";
import {
  getCitationRuleNumbers,
  makeEvaluationEvidence,
  makeEvaluationRequest,
} from "./evaluation-fixtures.js";
import { rulingEvaluationSeedSet } from "./evaluation-seed-set.js";

const config = readOpenAiConfig();
const model = createOpenAiAdapter(config);
let failures = 0;

for (const [index, fixture] of rulingEvaluationSeedSet.entries()) {
  const evidence = makeEvaluationEvidence(fixture, index);
  const request = makeEvaluationRequest(fixture, evidence);
  const missingFacts = request.gameState?.missingFacts ?? [];
  const result =
    missingFacts.length > 0
      ? createClarificationResponse(evidence, missingFacts)
      : verifyRulingOutput(
          await model.generateStructuredOutput({
            schema: modelRulingSchema,
            schemaName: "mtg_ruling_evaluation",
            systemPrompt: RULING_SYSTEM_PROMPT,
            userPrompt: buildModelPrompt(request, evidence),
            promptVersion: RULING_PROMPT_VERSION,
          }),
          boundEvidenceForPrompt(evidence),
          config.model,
        );
  const actualRules = getCitationRuleNumbers(result.citations);
  const outcomeMatches = result.outcome === fixture.expectedOutcome;
  const citationsMatch =
    JSON.stringify([...actualRules].sort()) ===
    JSON.stringify([...fixture.expectedRuleNumbers].sort());
  const clarificationMatches =
    result.clarificationQuestions.length >= fixture.expectedClarificationCount;
  const passed = outcomeMatches && citationsMatch && clarificationMatches;
  if (!passed) failures += 1;
  console.info(
    JSON.stringify({
      id: fixture.id,
      title: fixture.title,
      status: passed ? "PASS" : "FAIL",
      expectedOutcome: fixture.expectedOutcome,
      actualOutcome: result.outcome,
      expectedRuleNumbers: fixture.expectedRuleNumbers,
      actualRuleNumbers: actualRules,
      clarificationCount: result.clarificationQuestions.length,
      model: result.modelName,
      promptVersion: result.promptVersion,
    }),
  );
}

if (failures > 0) {
  console.error(`${failures} of ${rulingEvaluationSeedSet.length} ruling evaluations failed.`);
  process.exitCode = 1;
} else {
  console.info(`All ${rulingEvaluationSeedSet.length} ruling evaluations passed.`);
}
