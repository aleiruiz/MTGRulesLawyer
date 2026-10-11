import "dotenv/config";
import { exportReviewedEvaluationCases } from "./reviewed-evaluation-export.js";
import { prisma } from "../db/client.js";

try {
  await exportReviewedEvaluationCases();
} catch (error) {
  console.error("Could not export approved review cases.", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
