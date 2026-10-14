import { localeFor } from "../i18n/core";

const shortDate: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

/** The Comprehensive Rules date in a snapshot version like "rules-v2-20260925-<checksum>". */
export function rulesDate(
  version: string | null | undefined,
  locale: string = localeFor(),
): string | null {
  const match = version?.match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(
    locale,
    shortDate,
  );
}

const HEADLINE_MAX = 90;
// Past this a first sentence reads as a paragraph, so it stays in the body.
const LEAD_MAX = 240;

/**
 * Splits a ruling summary into a short headline (its first sentence) and the explanation
 * that follows, so the answer reads first. Long first sentences stay in the body.
 */
export function splitVerdict(summary: string): { headline: string | null; body: string } {
  const text = summary.trim();
  const match = /^(.+?[.!?])(?:\s+([\s\S]*))?$/.exec(text);
  const first = match?.[1];
  if (!first || first.length > HEADLINE_MAX) return { headline: null, body: text };
  return { headline: first, body: match?.[2]?.trim() ?? "" };
}

/**
 * Like splitVerdict, but keeps first sentences up to LEAD_MAX as the lead so every ruling opens
 * the same way; `compact` marks leads too long for the full headline size.
 */
export function splitLead(summary: string): {
  lead: string | null;
  body: string;
  compact: boolean;
} {
  const text = summary.trim();
  const match = /^(.+?[.!?])(?:\s+([\s\S]*))?$/.exec(text);
  const first = match?.[1];
  if (!first || first.length > LEAD_MAX) return { lead: null, body: text, compact: false };
  return { lead: first, body: match?.[2]?.trim() ?? "", compact: first.length > HEADLINE_MAX };
}

const yesNoStart = /^(did|does|do|is|are|was|were|can|could|has|have|had|will|would|should)\b/i;

// Spanish yes/no questions have no auxiliary verb, so instead rule out the ones that ask for
// something else ("¿Qué…?", "¿Cuántos…?").
const spanishOpenQuestion =
  /^¿\s*(qu[eé]|cu[aá]l|cu[aá]les|cu[aá]nt[oa]s?|c[oó]mo|qui[eé]n|qui[eé]nes|d[oó]nde|cu[aá]ndo|por\s+qu[eé]|para\s+qu[eé]|a\s+qu[eé]|de\s+qu[eé]|en\s+qu[eé])(?![a-záéíóúüñ])/i;

/** Clarifying questions the player can answer with a tap, in English or Spanish. */
export function isYesNoQuestion(question: string): boolean {
  const text = question.trim();
  if (!text.endsWith("?")) return false;
  if (text.startsWith("¿")) return !spanishOpenQuestion.test(text);
  return yesNoStart.test(text);
}
