import "dotenv/config";
import { prisma } from "../db/client.js";
import { refreshLocalizedCardNames } from "./localized-names.js";

// Imports printed card names in other languages (Spanish) from Scryfall. Runs at most once a
// week unless called with --force, for example after a new set comes out.
try {
  const result = await refreshLocalizedCardNames(prisma, {
    force: process.argv.includes("--force"),
  });
  if (result.status === "SKIPPED") {
    console.info(`Localized card names: skipped (${result.reason}).`);
  } else if (result.status === "FAILED") {
    console.error(`Localized card names refresh failed: ${result.errorMessage}`);
    process.exitCode = 1;
  } else {
    const counts = Object.entries(result.counts)
      .map(([language, count]) => `${language}: ${count}`)
      .join(", ");
    console.info(
      `Localized card names: ${result.status.toLowerCase()}${counts ? ` (${counts})` : ""}.`,
    );
  }
} finally {
  await prisma.$disconnect();
}
