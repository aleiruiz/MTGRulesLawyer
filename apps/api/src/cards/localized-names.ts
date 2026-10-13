import { createHash, randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import type { PrismaClient } from "@prisma/client";
import { SourceRefreshStatus } from "@prisma/client";
import { prisma } from "../db/client.js";
import { runLoggedRefresh } from "../sources/refresh.js";
import {
  fetchAllCardsBulkMetadata,
  MAX_BULK_BYTES,
  SCRYFALL_REQUEST_HEADERS,
  type OracleBulkMetadata,
} from "./source.js";

/** Languages whose printed card names players can use in questions and card search. */
export const LOCALIZED_NAME_LANGUAGES = ["es"] as const;
export type LocalizedNameLanguage = (typeof LOCALIZED_NAME_LANGUAGES)[number];

/** Fewer names than this means a truncated or changed file; the current names are kept. */
export const MINIMUM_LOCALIZED_NAMES = 10_000;
/** Printed names change only with new sets, so the large file is read about once a week. */
export const LOCALIZED_NAMES_REFRESH_DAYS = 7;

const MAX_NAME_LENGTH = 200;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 6 * 1024 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20 * 60_000;
const INSERT_BATCH_SIZE = 5_000;

export interface LocalizedName {
  oracleId: string;
  faceIndex: number;
  language: string;
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_NAME_LENGTH ? trimmed : null;
}

/**
 * The printed names of one Scryfall printing in a wanted language, per face. Faces follow the
 * same order as the Oracle import (card_faces order, or face 0 for single-faced cards). Names
 * equal to the English name add nothing and are skipped.
 */
export function localizedNamesFromPrinting(
  record: unknown,
  languages: ReadonlySet<string>,
): LocalizedName[] {
  if (!isRecord(record) || typeof record.lang !== "string" || !languages.has(record.lang)) {
    return [];
  }
  const language = record.lang;
  const faces = Array.isArray(record.card_faces) ? record.card_faces.filter(isRecord) : [];
  const sources =
    faces.length > 0 && faces.some((face) => text(face.printed_name))
      ? faces.map((face) => ({ face, oracleId: face.oracle_id ?? record.oracle_id }))
      : [{ face: record, oracleId: record.oracle_id }];
  const names: LocalizedName[] = [];
  sources.forEach(({ face, oracleId }, faceIndex) => {
    const printed = text(face.printed_name);
    const english = text(face.name);
    if (typeof oracleId !== "string" || !oracleId || !printed) return;
    if (english && printed.toLowerCase() === english.toLowerCase()) return;
    names.push({ oracleId, faceIndex, language, name: printed });
  });
  return names;
}

/**
 * Streams Scryfall's every-printing file (hundreds of MB) and keeps only the printed names in
 * the wanted languages. Nothing is written to disk.
 */
export async function readLocalizedNames(
  metadata: OracleBulkMetadata,
  languages: ReadonlySet<string>,
  fetcher: typeof fetch = fetch,
): Promise<{ names: LocalizedName[]; checksumSha256: string; byteLength: number }> {
  const response = await fetcher(metadata.downloadUrl, {
    headers: SCRYFALL_REQUEST_HEADERS,
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Scryfall All Cards bulk download returned HTTP ${response.status}.`);
  }

  const checksum = createHash("sha256");
  let byteLength = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_BULK_BYTES) {
        callback(new Error("Scryfall All Cards bulk file exceeded the 1 GiB size limit."));
        return;
      }
      checksum.update(chunk);
      callback(null, chunk);
    },
  });
  const source = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
  const gunzip = createGunzip();
  // Errors on either stream end the line reader, so they surface instead of hanging.
  for (const stream of [source, meter]) stream.on("error", (error) => gunzip.destroy(error));
  const lines = createInterface({ input: source.pipe(meter).pipe(gunzip), crlfDelay: Infinity });

  const unique = new Map<string, LocalizedName>();
  let decompressed = 0;
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const lineBytes = Buffer.byteLength(line, "utf8");
      decompressed += lineBytes;
      if (lineBytes > MAX_RECORD_BYTES) {
        throw new Error("Scryfall All Cards bulk file contains a record larger than 1 MiB.");
      }
      if (decompressed > MAX_DECOMPRESSED_BYTES) {
        throw new Error("Scryfall All Cards bulk file exceeded the decompressed size limit.");
      }
      let record: unknown;
      try {
        record = JSON.parse(line) as unknown;
      } catch {
        throw new Error("Scryfall All Cards bulk file contains an invalid record.");
      }
      for (const name of localizedNamesFromPrinting(record, languages)) {
        const key = `${name.language}\u0000${name.oracleId}\u0000${name.faceIndex}\u0000${name.name.toLowerCase()}`;
        if (!unique.has(key)) unique.set(key, name);
      }
    }
  } finally {
    // Closes the download if reading stopped early (a bad record or a size limit), so the
    // process does not wait on the open socket.
    lines.close();
    source.destroy();
    gunzip.destroy();
  }
  if (metadata.declaredSize !== null && byteLength !== metadata.declaredSize) {
    throw new Error(
      `Scryfall All Cards bulk file size changed from ${metadata.declaredSize} to ${byteLength} bytes during download.`,
    );
  }
  return { names: [...unique.values()], checksumSha256: checksum.digest("hex"), byteLength };
}

/** Replaces one language's names in a single transaction, so lookups never see a partial set. */
export async function replaceLocalizedNames(
  client: PrismaClient,
  language: string,
  names: LocalizedName[],
): Promise<void> {
  await client.$transaction(
    async (tx) => {
      await tx.cardLocalizedName.deleteMany({ where: { language } });
      for (let start = 0; start < names.length; start += INSERT_BATCH_SIZE) {
        await tx.cardLocalizedName.createMany({
          data: names.slice(start, start + INSERT_BATCH_SIZE),
          skipDuplicates: true,
        });
      }
    },
    { timeout: 5 * 60_000, maxWait: 30_000 },
  );
}

export interface LocalizedNamesRefreshDependencies {
  fetchMetadata: () => Promise<OracleBulkMetadata>;
  readNames: (
    metadata: OracleBulkMetadata,
    languages: ReadonlySet<string>,
  ) => Promise<{ names: LocalizedName[]; checksumSha256: string; byteLength: number }>;
  minimumNames: number;
  languages: readonly string[];
}

const defaultDependencies: LocalizedNamesRefreshDependencies = {
  fetchMetadata: fetchAllCardsBulkMetadata,
  readNames: readLocalizedNames,
  minimumNames: MINIMUM_LOCALIZED_NAMES,
  languages: LOCALIZED_NAME_LANGUAGES,
};

export type LocalizedNamesRefreshResult =
  | { status: "SKIPPED"; reason: string }
  | { status: "UNCHANGED" | "IMPORTED"; counts: Record<string, number> }
  | { status: "FAILED"; errorMessage: string };

/**
 * Imports printed names for every supported language. Runs at most about once a week (the
 * source file is large) unless forced, and skips files it already imported.
 */
export async function refreshLocalizedCardNames(
  client: PrismaClient = prisma,
  options: { force?: boolean; now?: Date } = {},
  overrides: Partial<LocalizedNamesRefreshDependencies> = {},
): Promise<LocalizedNamesRefreshResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const now = options.now ?? new Date();
  const last = await client.sourceRefreshLog.findFirst({
    where: {
      kind: "LOCALIZED_CARD_NAMES",
      status: { in: [SourceRefreshStatus.IMPORTED, SourceRefreshStatus.UNCHANGED] },
    },
    orderBy: { checkedAt: "desc" },
  });
  const ageDays = last ? (now.getTime() - last.checkedAt.getTime()) / 86_400_000 : Infinity;
  if (!options.force && ageDays < LOCALIZED_NAMES_REFRESH_DAYS) {
    return {
      status: "SKIPPED",
      reason: `last checked ${ageDays.toFixed(1)} days ago; runs every ${LOCALIZED_NAMES_REFRESH_DAYS} days`,
    };
  }

  const counts: Record<string, number> = {};
  const outcome = await runLoggedRefresh(
    client,
    "LOCALIZED_CARD_NAMES",
    "https://api.scryfall.com/bulk-data/all-cards",
    randomUUID(),
    async () => {
      const metadata = await dependencies.fetchMetadata();
      const sourceVersion = metadata.updatedAt.toISOString();
      const lastImported = await client.sourceRefreshLog.findFirst({
        where: { kind: "LOCALIZED_CARD_NAMES", status: SourceRefreshStatus.IMPORTED },
        orderBy: { checkedAt: "desc" },
      });
      if (!options.force && lastImported?.sourceVersion === sourceVersion) {
        return {
          sourceUrl: metadata.sourceUrl,
          sourceVersion,
          checksumSha256: lastImported.checksumSha256 ?? "0".repeat(64),
          snapshotVersion: null,
          unchanged: true,
        };
      }
      const languages = new Set<string>(dependencies.languages);
      const { names, checksumSha256 } = await dependencies.readNames(metadata, languages);
      for (const language of dependencies.languages) {
        const forLanguage = names.filter((name) => name.language === language);
        if (forLanguage.length < dependencies.minimumNames) {
          throw new Error(
            `Only ${forLanguage.length} "${language}" card names were found; expected at least ${dependencies.minimumNames}. The current names were kept.`,
          );
        }
        await replaceLocalizedNames(client, language, forLanguage);
        counts[language] = forLanguage.length;
      }
      return {
        sourceUrl: metadata.sourceUrl,
        sourceVersion,
        checksumSha256,
        snapshotVersion: null,
        unchanged: false,
      };
    },
  );
  if (outcome.status === "FAILED") {
    return { status: "FAILED", errorMessage: outcome.errorMessage ?? "Unknown failure." };
  }
  return { status: outcome.status, counts };
}
