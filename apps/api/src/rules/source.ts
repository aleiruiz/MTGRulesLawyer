import { RULES_SOURCE_PAGE } from "./import.js";

const REQUEST_HEADERS = {
  accept: "text/html, text/plain;q=0.9, */*;q=0.8",
  "user-agent": "MTGRulesLawyer/0.1 (Comprehensive Rules import)",
};
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface RulesSourceDocument {
  sourceUrl: string;
  text: string;
}

export async function fetchLatestRulesDocument(
  fetcher: typeof fetch = fetch,
): Promise<RulesSourceDocument> {
  const pageResponse = await fetcher(RULES_SOURCE_PAGE, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(30_000),
  });
  if (!pageResponse.ok) {
    throw new Error(`Official rules page returned HTTP ${pageResponse.status}.`);
  }

  const pageHtml = await pageResponse.text();
  const textLink = pageHtml.match(/href=["']([^"']+\.txt(?:\?[^"']*)?)["']/i)?.[1];
  if (!textLink) {
    throw new Error("Official rules page did not provide a TXT document link.");
  }

  const sourceUrl = new URL(textLink, RULES_SOURCE_PAGE);
  if (sourceUrl.protocol !== "https:" || sourceUrl.hostname !== "media.wizards.com") {
    throw new Error("Official rules page linked to an unexpected TXT host.");
  }

  const documentResponse = await fetcher(sourceUrl, {
    headers: { ...REQUEST_HEADERS, accept: "text/plain, */*;q=0.8" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!documentResponse.ok) {
    throw new Error(`Official rules TXT returned HTTP ${documentResponse.status}.`);
  }

  const declaredLength = Number(documentResponse.headers.get("content-length"));
  if (declaredLength > MAX_DOCUMENT_BYTES) {
    throw new Error("Official rules TXT exceeded the 5 MiB size limit.");
  }
  const text = await documentResponse.text();
  if (Buffer.byteLength(text, "utf8") > MAX_DOCUMENT_BYTES) {
    throw new Error("Official rules TXT exceeded the 5 MiB size limit.");
  }
  if (text.trimStart().startsWith("<!DOCTYPE html") || text.trimStart().startsWith("<html")) {
    throw new Error("Official rules TXT response contained HTML instead of plain text.");
  }

  return { sourceUrl: sourceUrl.toString(), text };
}
