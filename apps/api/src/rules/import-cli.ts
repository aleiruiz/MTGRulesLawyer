import "dotenv/config";
import { prisma } from "../db/client.js";
import { importRulesText, PrismaRulesSnapshotWriter } from "./import.js";
import { fetchLatestRulesDocument } from "./source.js";

async function main(): Promise<void> {
  try {
    const document = await fetchLatestRulesDocument();
    const result = await importRulesText(
      document.text,
      document.sourceUrl,
      new PrismaRulesSnapshotWriter(prisma),
    );
    console.info(
      `Activated rules snapshot ${result.snapshot.version} with ${result.ruleCount} sections (${result.checksumSha256}).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("Comprehensive Rules import failed; the active snapshot was not changed.", error);
  process.exitCode = 1;
});
