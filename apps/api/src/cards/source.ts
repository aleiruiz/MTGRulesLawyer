import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const BULK_DATA_URL = "https://api.scryfall.com/bulk-data/oracle-cards";
const REQUEST_HEADERS = {
  accept: "application/json;q=0.9,*/*;q=0.8",
  "user-agent": "MTGRulesLawyer/0.1 (Oracle bulk import)",
};
const MAX_BULK_BYTES = 1024 * 1024 * 1024;

export interface OracleBulkMetadata {
  updatedAt: Date;
  sourceUrl: string;
  downloadUrl: string;
  declaredSize: number | null;
}

export interface DownloadedOracleBulk {
  metadata: OracleBulkMetadata;
  filePath: string;
  checksumSha256: string;
  byteLength: number;
}

export async function fetchOracleBulkMetadata(
  fetcher: typeof fetch = fetch,
): Promise<OracleBulkMetadata> {
  const response = await fetcher(BULK_DATA_URL, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Scryfall bulk metadata returned HTTP ${response.status}.`);
  }

  const metadata: unknown = await response.json();
  if (!isRecord(metadata) || metadata.type !== "oracle_cards") {
    throw new Error("Scryfall did not return Oracle Cards bulk metadata.");
  }
  if (typeof metadata.updated_at !== "string" || Number.isNaN(Date.parse(metadata.updated_at))) {
    throw new Error("Scryfall Oracle Cards metadata did not include a valid update date.");
  }
  const sourceUrl = requireScryfallUrl(metadata.uri, "metadata");
  const downloadUrl = requireScryfallUrl(metadata.jsonl_download_uri, "download");
  const declaredSize =
    typeof metadata.compressed_size === "number"
      ? metadata.compressed_size
      : typeof metadata.size === "number"
        ? metadata.size
        : null;
  if (declaredSize !== null && (declaredSize < 1 || declaredSize > MAX_BULK_BYTES)) {
    throw new Error("Scryfall Oracle Cards bulk file exceeds the 1 GiB size limit.");
  }

  return {
    updatedAt: new Date(metadata.updated_at),
    sourceUrl,
    downloadUrl,
    declaredSize,
  };
}

export async function downloadOracleBulk(
  metadata: OracleBulkMetadata,
  fetcher: typeof fetch = fetch,
): Promise<DownloadedOracleBulk> {
  const response = await fetcher(metadata.downloadUrl, {
    headers: { ...REQUEST_HEADERS, accept: "application/json;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Scryfall Oracle Cards bulk download returned HTTP ${response.status}.`);
  }

  const directory = await mkdtemp(join(tmpdir(), "mtg-oracle-import-"));
  const filePath = join(directory, "oracle-cards.jsonl.gz");
  const checksum = createHash("sha256");
  let byteLength = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      byteLength += chunk.byteLength;
      if (byteLength > MAX_BULK_BYTES) {
        callback(new Error("Scryfall Oracle Cards bulk file exceeded the 1 GiB size limit."));
        return;
      }
      checksum.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      meter,
      createWriteStream(filePath, { flags: "wx" }),
    );
    if (metadata.declaredSize !== null && byteLength !== metadata.declaredSize) {
      throw new Error(
        `Scryfall Oracle Cards bulk file size changed from ${metadata.declaredSize} to ${byteLength} bytes during download.`,
      );
    }
    return {
      metadata,
      filePath,
      checksumSha256: checksum.digest("hex"),
      byteLength,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function removeDownloadedOracleBulk(download: DownloadedOracleBulk): Promise<void> {
  await rm(dirname(download.filePath), { recursive: true, force: true });
}

function requireScryfallUrl(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Scryfall Oracle Cards ${label} URL was missing.`);
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["api.scryfall.com", "data.scryfall.io"].includes(url.hostname)
  ) {
    throw new Error(`Scryfall Oracle Cards ${label} URL used an unexpected host.`);
  }
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
