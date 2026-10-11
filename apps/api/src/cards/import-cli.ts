import "dotenv/config";
import { prisma } from "../db/client.js";
import { importOracleBulk, PrismaOracleSnapshotWriter } from "./oracle-import.js";
import {
  downloadOracleBulk,
  fetchOracleBulkMetadata,
  removeDownloadedOracleBulk,
} from "./source.js";

async function main(): Promise<void> {
  let download: Awaited<ReturnType<typeof downloadOracleBulk>> | undefined;
  try {
    const metadata = await fetchOracleBulkMetadata();
    download = await downloadOracleBulk(metadata);
    const result = await importOracleBulk(download, new PrismaOracleSnapshotWriter(prisma));
    console.info(
      `Imported Oracle snapshot ${result.snapshot.version} with ${result.cardCount} cards (${result.checksumSha256}, ${result.byteLength} bytes).`,
    );
  } finally {
    if (download) await removeDownloadedOracleBulk(download);
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("Oracle Cards import failed; the active snapshot was not changed.", error);
  process.exitCode = 1;
});
