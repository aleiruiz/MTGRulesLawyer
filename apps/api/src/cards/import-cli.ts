import "dotenv/config";
import { prisma } from "../db/client.js";
import { importOracleBulk, PrismaOracleSnapshotWriter } from "./oracle-import.js";
import {
  downloadOracleBulk,
  fetchOracleBulkMetadata,
  fetchRulingsBulkMetadata,
  removeDownloadedOracleBulk,
} from "./source.js";

async function main(): Promise<void> {
  let download: Awaited<ReturnType<typeof downloadOracleBulk>> | undefined;
  let rulingsDownload: Awaited<ReturnType<typeof downloadOracleBulk>> | undefined;
  try {
    download = await downloadOracleBulk(await fetchOracleBulkMetadata());
    rulingsDownload = await downloadOracleBulk(await fetchRulingsBulkMetadata());
    const result = await importOracleBulk(
      download,
      new PrismaOracleSnapshotWriter(prisma),
      new Date(),
      1000,
      rulingsDownload,
    );
    console.info(
      `Imported Oracle snapshot ${result.snapshot.version} with ${result.cardCount} cards (${result.checksumSha256}, ${result.byteLength} bytes).`,
    );
  } finally {
    if (download) await removeDownloadedOracleBulk(download);
    if (rulingsDownload) await removeDownloadedOracleBulk(rulingsDownload);
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("Oracle Cards import failed; the active snapshot was not changed.", error);
  process.exitCode = 1;
});
