import "dotenv/config";
import { prisma } from "../db/client.js";
import { refreshAllSources } from "./refresh.js";

try {
  const outcomes = await refreshAllSources(prisma);
  for (const outcome of outcomes) {
    if (outcome.status === "FAILED") {
      console.error(`${outcome.kind} refresh failed: ${outcome.errorMessage}`);
    } else {
      console.info(
        `${outcome.kind}: ${outcome.status.toLowerCase()} (${outcome.snapshotVersion ?? "no active snapshot"})`,
      );
    }
  }
  if (outcomes.some(({ status }) => status === "FAILED")) process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
