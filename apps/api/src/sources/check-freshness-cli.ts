import "dotenv/config";
import { prisma } from "../db/client.js";
import { getSourceStatus } from "./status.js";

try {
  const result = await getSourceStatus(prisma);
  const staleSources = result.sources.filter(({ stale }) => stale);
  for (const source of result.sources) {
    const state = source.stale ? "STALE" : "fresh";
    console.info(`${source.kind}: ${state}; last check ${source.checkedAt ?? "never"}`);
  }
  if (staleSources.length > 0) {
    console.error(
      `Source freshness alert: ${staleSources.map(({ kind }) => kind).join(", ")} exceeded the ${result.staleAfterHours}-hour limit or had a failed/in-progress refresh.`,
    );
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
