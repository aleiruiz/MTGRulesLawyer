import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, SourceKind } from "@prisma/client";
import { SourceRefreshStatus, SnapshotStatus } from "@prisma/client";
import { prisma } from "../db/client.js";
import {
  importOracleBulk,
  ORACLE_IMPORTER_REVISION,
  PrismaOracleSnapshotWriter,
} from "../cards/oracle-import.js";
import {
  downloadOracleBulk,
  fetchOracleBulkMetadata,
  removeDownloadedOracleBulk,
  type DownloadedOracleBulk,
  type OracleBulkMetadata,
} from "../cards/source.js";
import { importRulesText, PrismaRulesSnapshotWriter } from "../rules/import.js";
import { fetchLatestRulesDocument } from "../rules/source.js";
import type { RulesSourceDocument } from "../rules/source.js";

export const SOURCE_STALE_AFTER_HOURS = Number(process.env.SOURCE_STALE_AFTER_HOURS ?? "72");
export const ORACLE_METADATA_URL = "https://api.scryfall.com/bulk-data/oracle-cards";

export interface SourceRefreshDependencies {
  fetchRulesDocument: () => Promise<RulesSourceDocument>;
  fetchOracleMetadata: () => Promise<OracleBulkMetadata>;
  downloadOracleBulk: (metadata: OracleBulkMetadata) => Promise<DownloadedOracleBulk>;
  removeDownloadedOracleBulk: (download: DownloadedOracleBulk) => Promise<void>;
  minimumRuleCount: number;
  minimumOracleCardCount: number;
}

const defaultDependencies: SourceRefreshDependencies = {
  fetchRulesDocument: fetchLatestRulesDocument,
  fetchOracleMetadata: fetchOracleBulkMetadata,
  downloadOracleBulk,
  removeDownloadedOracleBulk,
  minimumRuleCount: 1000,
  minimumOracleCardCount: 1000,
};

interface RefreshOutcome {
  kind: SourceKind;
  status: "UNCHANGED" | "IMPORTED" | "FAILED";
  snapshotVersion: string | null;
  errorMessage: string | null;
}

export async function refreshAllSources(
  client: PrismaClient = prisma,
  overrides: Partial<SourceRefreshDependencies> = {},
  runId: ReturnType<typeof randomUUID> = randomUUID(),
): Promise<RefreshOutcome[]> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const outcomes: RefreshOutcome[] = [];
  // Snapshot activation is serialized: each importer copies the other active dataset.
  outcomes.push(await refreshRules(client, dependencies, runId));
  outcomes.push(await refreshOracle(client, dependencies, runId));
  return outcomes;
}

async function refreshRules(
  client: PrismaClient,
  dependencies: SourceRefreshDependencies,
  runId: string,
): Promise<RefreshOutcome> {
  return runLoggedRefresh(
    client,
    "COMPREHENSIVE_RULES",
    "https://magic.wizards.com/en/rules",
    runId,
    async () => {
      const active = await getActiveSource(client, "COMPREHENSIVE_RULES");
      const document = await dependencies.fetchRulesDocument();
      const checksumSha256 = createHash("sha256").update(document.text, "utf8").digest("hex");
      if (active?.checksumSha256 === checksumSha256) {
        const activeSnapshot = await client.dataSnapshot.findFirst({
          where: { status: SnapshotStatus.ACTIVE },
          select: { version: true },
        });
        return {
          sourceUrl: document.sourceUrl,
          sourceVersion: active.sourceVersion ?? activeSnapshot?.version ?? "",
          checksumSha256,
          snapshotVersion: activeSnapshot?.version ?? null,
          unchanged: true,
        };
      }
      const result = await importRulesText(
        document.text,
        document.sourceUrl,
        new PrismaRulesSnapshotWriter(client),
        new Date(),
        dependencies.minimumRuleCount,
      );
      return {
        sourceUrl: document.sourceUrl,
        sourceVersion: result.snapshot.version,
        checksumSha256: result.checksumSha256,
        snapshotVersion: result.snapshot.version,
        unchanged: active?.checksumSha256 === result.checksumSha256,
      };
    },
  );
}

async function refreshOracle(
  client: PrismaClient,
  dependencies: SourceRefreshDependencies,
  runId: string,
): Promise<RefreshOutcome> {
  return runLoggedRefresh(client, "ORACLE_CARDS", ORACLE_METADATA_URL, runId, async () => {
    const active = await getActiveSource(client, "ORACLE_CARDS");
    const metadata = await dependencies.fetchOracleMetadata();
    const activeSnapshot = await client.dataSnapshot.findFirst({
      where: { status: SnapshotStatus.ACTIVE },
      select: { id: true, version: true, notes: true },
    });
    const normalizedRevision = activeSnapshot?.notes?.match(
      /(?:^|\n)oracle-importer-revision=(\d+)(?:$|\n)/,
    )?.[1];
    if (
      active &&
      active.sourceVersion === metadata.updatedAt.toISOString() &&
      normalizedRevision === String(ORACLE_IMPORTER_REVISION)
    ) {
      return {
        sourceUrl: metadata.sourceUrl,
        sourceVersion: metadata.updatedAt.toISOString(),
        checksumSha256: active.checksumSha256,
        snapshotVersion: activeSnapshot?.version ?? null,
        unchanged: true,
      };
    }

    let download: Awaited<ReturnType<typeof downloadOracleBulk>> | undefined;
    try {
      download = await dependencies.downloadOracleBulk(metadata);
      const result = await importOracleBulk(
        download,
        new PrismaOracleSnapshotWriter(client),
        new Date(),
        dependencies.minimumOracleCardCount,
      );
      return {
        sourceUrl: metadata.sourceUrl,
        sourceVersion: metadata.updatedAt.toISOString(),
        checksumSha256: result.checksumSha256,
        snapshotVersion: result.snapshot.version,
        unchanged: result.snapshot.id === activeSnapshot?.id,
      };
    } finally {
      if (download) await dependencies.removeDownloadedOracleBulk(download);
    }
  });
}

async function runLoggedRefresh(
  client: PrismaClient,
  kind: SourceKind,
  initialUrl: string,
  runId: string,
  refresh: () => Promise<{
    sourceUrl: string;
    sourceVersion: string;
    checksumSha256: string;
    snapshotVersion: string | null;
    unchanged: boolean;
  }>,
): Promise<RefreshOutcome> {
  const log = await client.sourceRefreshLog.create({
    data: { runId, kind, sourceUrl: initialUrl, status: SourceRefreshStatus.RUNNING },
  });
  try {
    const result = await refresh();
    const status = result.unchanged ? SourceRefreshStatus.UNCHANGED : SourceRefreshStatus.IMPORTED;
    await client.sourceRefreshLog.update({
      where: { id: log.id },
      data: {
        sourceUrl: result.sourceUrl,
        sourceVersion: result.sourceVersion,
        checksumSha256: result.checksumSha256,
        snapshotVersion: result.snapshotVersion,
        status,
        completedAt: new Date(),
      },
    });
    return { kind, status, snapshotVersion: result.snapshotVersion, errorMessage: null };
  } catch (error) {
    const errorMessage = toSafeErrorMessage(error);
    await client.sourceRefreshLog.update({
      where: { id: log.id },
      data: { status: SourceRefreshStatus.FAILED, completedAt: new Date(), errorMessage },
    });
    return { kind, status: "FAILED", snapshotVersion: null, errorMessage };
  }
}

async function getActiveSource(client: PrismaClient, kind: SourceKind) {
  const active = await client.dataSnapshot.findFirst({
    where: { status: SnapshotStatus.ACTIVE },
    include: { sources: { where: { kind } } },
  });
  return active?.sources[0] ?? null;
}

function toSafeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown source refresh failure.";
  return message.replace(/https?:\/\/\S+/gi, "[source URL]").slice(0, 500);
}
