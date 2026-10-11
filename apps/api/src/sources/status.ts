import type { PrismaClient } from "@prisma/client";
import { SnapshotStatus, SourceRefreshStatus } from "@prisma/client";
import { sourceStatusResponseSchema, type SourceStatusResponse } from "@mtg-rules/contracts";
import { prisma } from "../db/client.js";
import { ORACLE_METADATA_URL, SOURCE_STALE_AFTER_HOURS } from "./refresh.js";

const trackedSources = [
  { kind: "COMPREHENSIVE_RULES", sourceUrl: "https://magic.wizards.com/en/rules" },
  { kind: "ORACLE_CARDS", sourceUrl: ORACLE_METADATA_URL },
] as const;

export async function getSourceStatus(
  client: PrismaClient = prisma,
  now = new Date(),
): Promise<SourceStatusResponse> {
  const activeSnapshot = await client.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
    include: { sources: true },
  });
  const sources = await Promise.all(
    trackedSources.map(async ({ kind, sourceUrl }) => {
      const activeSource = activeSnapshot?.sources.find((source) => source.kind === kind);
      const latestCheck = await client.sourceRefreshLog.findFirst({
        where: { kind },
        orderBy: { checkedAt: "desc" },
      });
      const checkedAt = latestCheck?.checkedAt ?? activeSource?.importedAt ?? null;
      const stale =
        !checkedAt ||
        (now.getTime() - checkedAt.getTime()) / 3_600_000 > SOURCE_STALE_AFTER_HOURS ||
        latestCheck?.status === SourceRefreshStatus.FAILED ||
        latestCheck?.status === SourceRefreshStatus.RUNNING;
      return {
        kind,
        sourceUrl: activeSource?.sourceUrl ?? latestCheck?.sourceUrl ?? sourceUrl,
        sourceVersion: activeSource?.sourceVersion ?? latestCheck?.sourceVersion ?? null,
        checksumSha256: activeSource?.checksumSha256 ?? latestCheck?.checksumSha256 ?? null,
        importedAt: activeSource?.importedAt.toISOString() ?? null,
        checkedAt: checkedAt?.toISOString() ?? null,
        lastStatus: latestCheck?.status ?? null,
        lastError: latestCheck?.errorMessage ?? null,
        stale,
      };
    }),
  );

  return sourceStatusResponseSchema.parse({
    activeSnapshot: activeSnapshot
      ? {
          id: activeSnapshot.id,
          version: activeSnapshot.version,
          activatedAt: activeSnapshot.activatedAt?.toISOString() ?? null,
        }
      : null,
    staleAfterHours: SOURCE_STALE_AFTER_HOURS,
    sources,
  });
}
