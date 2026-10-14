import type { RulingGenerationResponse } from "@mtg-rules/contracts";
import { strings } from "../i18n/core";

export type Citation = RulingGenerationResponse["citations"][number];

// Official rulings are labelled "<card name> ruling (<date>)" by the API.
const rulingLabel = /^(.+) ruling \(([^)]*)\)$/;

/** The card and date of an official ruling, or null for a label in another shape. */
export function parseRulingLabel(label: string): { card: string; date: string } | null {
  const match = rulingLabel.exec(label);
  return match?.[1] && match[2] !== undefined ? { card: match[1], date: match[2] } : null;
}

/** What a citation is called on its chip: a rule number, a card name or the ruling's card. */
export function citationChipLabel(citation: Citation): string {
  if (citation.kind !== "CARD_RULING") return citation.label;
  const ruling = parseRulingLabel(citation.label);
  return ruling ? strings().citation.rulingFor(ruling.card) : strings().citation.officialRuling;
}

/** Chip labels for a row of citations, numbered where two would otherwise read the same. */
export function citationChipLabels(citations: Citation[]): string[] {
  const labels = citations.map(citationChipLabel);
  const totals = new Map<string, number>();
  for (const label of labels) totals.set(label, (totals.get(label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return labels.map((label) => {
    if ((totals.get(label) ?? 0) < 2) return label;
    const index = (seen.get(label) ?? 0) + 1;
    seen.set(label, index);
    return `${label} ${index}`;
  });
}
