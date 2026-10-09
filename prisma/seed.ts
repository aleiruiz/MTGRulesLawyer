import "dotenv/config";
import { PrismaClient, SnapshotStatus } from "@prisma/client";

const prisma = new PrismaClient();
const localSnapshotVersion = "local-empty";

async function main(): Promise<void> {
  try {
    await prisma.dataSnapshot.upsert({
      where: { version: localSnapshotVersion },
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        version: localSnapshotVersion,
        status: SnapshotStatus.CANDIDATE,
        notes: "Empty local development baseline; no rules or cards have been imported.",
      },
      update: {
        status: SnapshotStatus.CANDIDATE,
        notes: "Empty local development baseline; no rules or cards have been imported.",
      },
    });
    console.info(`Seeded development snapshot ${localSnapshotVersion}.`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("Failed to seed the local database.", error);
  process.exitCode = 1;
});
