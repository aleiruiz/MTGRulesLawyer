import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  downloadOracleBulk,
  fetchOracleBulkMetadata,
  removeDownloadedOracleBulk,
} from "./source.js";

void describe("Scryfall Oracle bulk metadata", () => {
  void it("uses the current Oracle JSONL gzip metadata fields", async () => {
    const fetcher: typeof fetch = (input, init) => {
      const requestedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      assert.equal(requestedUrl, "https://api.scryfall.com/bulk-data/oracle-cards");
      assert.match(new Headers(init?.headers).get("user-agent") ?? "", /Oracle bulk import/);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: "oracle_cards",
            updated_at: "2026-10-10T21:01:55.638+00:00",
            uri: "https://api.scryfall.com/bulk-data/27bf3214-1271-490b-bdfe-c0be6c23d02e",
            jsonl_download_uri:
              "https://data.scryfall.io/oracle-cards/oracle-cards-20261010210155.jsonl.gz",
            compressed_size: 24605753,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };

    const metadata = await fetchOracleBulkMetadata(fetcher);
    assert.equal(metadata.updatedAt.toISOString(), "2026-10-10T21:01:55.638Z");
    assert.equal(metadata.declaredSize, 24605753);
    assert.match(metadata.downloadUrl, /\.jsonl\.gz$/);
    assert.equal(
      metadata.sourceUrl,
      "https://api.scryfall.com/bulk-data/27bf3214-1271-490b-bdfe-c0be6c23d02e",
    );
  });

  void it("rejects an unexpected source host", async () => {
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: "oracle_cards",
            updated_at: "2026-10-10T21:01:55Z",
            uri: "https://api.scryfall.com/bulk-data/oracle-cards",
            jsonl_download_uri: "https://example.com/oracle.jsonl.gz",
          }),
        ),
      );
    await assert.rejects(fetchOracleBulkMetadata(fetcher), /unexpected host/);
  });

  void it("downloads to temporary storage and records the compressed file checksum", async () => {
    const bytes = gzipSync(Buffer.from('{"oracle_id":"one"}\n', "utf8"));
    const metadata = {
      updatedAt: new Date("2026-10-10T21:01:55Z"),
      sourceUrl: "https://api.scryfall.com/bulk-data/oracle-cards",
      downloadUrl: "https://data.scryfall.io/oracle-cards/fixture.jsonl.gz",
      declaredSize: bytes.byteLength,
    };
    const fetcher: typeof fetch = () =>
      Promise.resolve(
        new Response(bytes, { status: 200, headers: { "content-type": "application/gzip" } }),
      );
    const download = await downloadOracleBulk(metadata, fetcher);
    try {
      assert.equal(download.byteLength, bytes.byteLength);
      assert.equal(download.checksumSha256, createHash("sha256").update(bytes).digest("hex"));
    } finally {
      await removeDownloadedOracleBulk(download);
    }
  });
});
