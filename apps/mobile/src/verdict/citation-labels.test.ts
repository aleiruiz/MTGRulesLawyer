import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setCurrentLanguage } from "../i18n/core";
import { citationChipLabel, citationChipLabels, type Citation } from "./citation-labels";

function citation(kind: Citation["kind"], label: string, id = label): Citation {
  return { id, kind, label, excerpt: "", sourceId: "s", sourceUrl: "https://example.com" };
}

void describe("citation chip labels", () => {
  afterEach(() => setCurrentLanguage("en"));

  void it("names the card an official ruling belongs to", () => {
    assert.equal(
      citationChipLabel(citation("CARD_RULING", "Blood Moon ruling (2024-11-08)")),
      "Ruling · Blood Moon",
    );
    setCurrentLanguage("es");
    assert.equal(
      citationChipLabel(citation("CARD_RULING", "Blood Moon ruling (2024-11-08)")),
      "Aclaración · Blood Moon",
    );
  });

  void it("falls back to a generic label for an unexpected ruling label", () => {
    assert.equal(citationChipLabel(citation("CARD_RULING", "Something else")), "Official ruling");
  });

  void it("numbers chips that would read the same", () => {
    assert.deepEqual(
      citationChipLabels([
        citation("CARD_RULING", "Blood Moon ruling (2024-11-08)"),
        citation("RULE", "613.1d"),
        citation("CARD_RULING", "Blood Moon ruling (2019-01-01)"),
      ]),
      ["Ruling · Blood Moon 1", "613.1d", "Ruling · Blood Moon 2"],
    );
  });
});
