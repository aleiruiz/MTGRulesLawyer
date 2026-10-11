import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Prisma, RulingOutcome } from "@prisma/client";
import { prisma } from "../db/client.js";
import reviewedEvaluationCases from "./reviewed-evaluation-cases-v1.json" with { type: "json" };
import { rulingEvaluationCaseSchema, type RulingEvaluationCase } from "./evaluation-seed-set.js";

const approvedReviewSelection = {
  where: {
    decision: "APPROVE",
    errorCategory: { not: null },
    correctedVersionId: { not: null },
    includeInEvaluation: true,
    evaluationQuestion: { not: null },
    challenge: { evaluationConsent: true },
  },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: {
    errorCategory: true,
    evaluationQuestion: true,
    challenge: {
      select: {
        rulingVersion: {
          select: {
            ruling: {
              select: {
                question: {
                  select: {
                    confirmedCards: {
                      orderBy: { position: "asc" },
                      select: {
                        quantity: true,
                        card: { select: { name: true } },
                        face: { select: { name: true, oracleText: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    correctedVersion: {
      select: {
        outcome: true,
        summary: true,
        reasoningSteps: true,
        assumptions: true,
        summaryCitationIds: true,
        clarificationQuestions: true,
        citations: {
          orderBy: [{ label: "asc" }, { id: "asc" }],
          select: {
            kind: true,
            ruleId: true,
            cardFaceId: true,
            rule: { select: { number: true } },
            label: true,
            excerpt: true,
          },
        },
      },
    },
  },
} satisfies Prisma.ReviewEventFindManyArgs;

type ApprovedReview = Prisma.ReviewEventGetPayload<typeof approvedReviewSelection>;

const rulingOutcomeMap = {
  RESOLVED: "resolved",
  CONDITIONAL: "conditional",
  NEEDS_INFORMATION: "needs_information",
  UNCERTAIN: "uncertain",
} satisfies Record<RulingOutcome, RulingEvaluationCase["expectedOutcome"]>;

function readStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === "string")
    : [];
}

function readReasoningSteps(value: unknown): Array<{ text: string; citationIds: string[] }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((step: unknown) => {
    if (typeof step !== "object" || step === null || !("text" in step)) return [];
    const text = step.text;
    if (typeof text !== "string") return [];
    const citationIds = "citationIds" in step ? readStrings(step.citationIds) : [];
    return [{ text, citationIds }];
  });
}

export function mapApprovedReviewToEvaluationCase(
  review: ApprovedReview,
  caseNumber: number,
): RulingEvaluationCase | null {
  const corrected = review.correctedVersion;
  const category = review.errorCategory?.toLowerCase();
  if (!corrected || !category || !review.evaluationQuestion) return null;
  if (
    category !== "card_resolution" &&
    category !== "missing_game_fact" &&
    category !== "retrieval" &&
    category !== "reasoning" &&
    category !== "outdated_source" &&
    category !== "presentation"
  ) {
    return null;
  }

  const sourceQuestion = review.challenge.rulingVersion.ruling.question;
  const citations = corrected.citations;
  const evidenceIdToRuleNumber = new Map<string, string>();
  for (const citation of citations) {
    if (citation.kind === "RULE" && citation.ruleId && citation.rule?.number) {
      evidenceIdToRuleNumber.set(citation.ruleId, citation.rule.number);
    }
  }
  const toRuleNumbers = (ids: string[]) =>
    [
      ...new Set(
        ids.flatMap((id) => {
          const number = evidenceIdToRuleNumber.get(id);
          return number ? [number] : [];
        }),
      ),
    ].sort();
  const reasoningSteps = readReasoningSteps(corrected.reasoningSteps);
  const outcome = rulingOutcomeMap[corrected.outcome];

  return {
    id: `reviewed-challenge-${String(caseNumber).padStart(3, "0")}`,
    errorCategory: category,
    reviewSource: "approved_challenge",
    fixtureOrigin: "exported",
    title: `Reviewed challenge ${String(caseNumber).padStart(3, "0")} (${category.replaceAll("_", " ")})`,
    question: review.evaluationQuestion,
    cards: sourceQuestion.confirmedCards.map((selected) => ({
      name: selected.face?.name ?? selected.card.name,
      oracleText: selected.face?.oracleText ?? "",
      quantity: selected.quantity,
    })),
    rules: citations.flatMap((citation) =>
      citation.kind === "RULE" && citation.rule?.number
        ? [{ number: citation.rule.number, text: citation.excerpt }]
        : [],
    ),
    expectedOutcome: outcome,
    expectedRuleNumbers: toRuleNumbers([
      ...corrected.summaryCitationIds,
      ...reasoningSteps.flatMap((step) => step.citationIds),
    ]),
    expectedClarificationCount: corrected.clarificationQuestions.length,
    modelOutput: {
      outcome,
      summary: corrected.summary,
      summarySupport: "SUPPORTED",
      summaryCitationNumbers: toRuleNumbers(corrected.summaryCitationIds),
      reasoningSteps: reasoningSteps.map((step) => ({
        text: step.text,
        support: "SUPPORTED",
        citationNumbers: toRuleNumbers(step.citationIds),
      })),
      assumptions: corrected.assumptions,
      clarificationQuestions: corrected.clarificationQuestions,
    },
  };
}

export async function getReviewedEvaluationCases(
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<RulingEvaluationCase[]> {
  const reviews = await client.reviewEvent.findMany(approvedReviewSelection);
  return reviews.flatMap((review, index) => {
    const evaluationCase = mapApprovedReviewToEvaluationCase(review, index + 1);
    return evaluationCase ? [evaluationCase] : [];
  });
}

export async function exportReviewedEvaluationCases(): Promise<void> {
  const curatedCases: RulingEvaluationCase[] = rulingEvaluationCaseSchema
    .array()
    .parse(reviewedEvaluationCases)
    .filter(
      (evaluationCase) =>
        evaluationCase.reviewSource === "maintainer_curated" &&
        evaluationCase.fixtureOrigin === "synthetic",
    );
  const cases = [...curatedCases, ...(await getReviewedEvaluationCases())];
  const outputPath = fileURLToPath(new URL("./reviewed-evaluation-cases-v1.json", import.meta.url));
  await writeFile(outputPath, `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  console.info(`Exported ${cases.length} approved, categorized review case(s) to ${outputPath}`);
}
