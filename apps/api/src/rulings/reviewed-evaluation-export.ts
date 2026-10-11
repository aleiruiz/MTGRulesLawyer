import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ReviewDecision, type Prisma } from "@prisma/client";
import { reviewedEvaluationFixtureSchema } from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";
import reviewedEvaluationCases from "./reviewed-evaluation-cases-v1.json" with { type: "json" };
import { rulingEvaluationCaseSchema, type RulingEvaluationCase } from "./evaluation-seed-set.js";

const approvedReviewSelection = {
  where: {
    decision: ReviewDecision.APPROVE,
    errorCategory: { not: null },
    correctedVersionId: { not: null },
    includeInEvaluation: true,
    challenge: { evaluationConsent: true },
  },
  orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  select: { errorCategory: true, evaluationFixture: true },
} satisfies Prisma.ReviewEventFindManyArgs;

type ApprovedReview = Prisma.ReviewEventGetPayload<typeof approvedReviewSelection>;

export function mapApprovedReviewToEvaluationCase(
  review: ApprovedReview,
  caseNumber: number,
): RulingEvaluationCase | null {
  if (!review.errorCategory || !review.evaluationFixture) return null;
  const fixture = reviewedEvaluationFixtureSchema.safeParse(review.evaluationFixture);
  if (!fixture.success) return null;

  const category = review.errorCategory.toLowerCase();
  return rulingEvaluationCaseSchema.parse({
    ...fixture.data,
    id: `reviewed-challenge-${String(caseNumber).padStart(3, "0")}`,
    errorCategory: category as NonNullable<RulingEvaluationCase["errorCategory"]>,
    reviewSource: "approved_challenge",
    fixtureOrigin: "exported",
    title: `Reviewed scenario ${String(caseNumber).padStart(3, "0")} (${category.replaceAll("_", " ")})`,
  });
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
  console.info(`Exported ${cases.length} reviewed evaluation case(s) to ${outputPath}`);
}
