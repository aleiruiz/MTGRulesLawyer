import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importRulesText, parseRulesDocument, type RulesSnapshotInput } from "./import.js";

const rulesFixture = [
  "Magic: The Gathering Comprehensive Rules",
  "These rules are effective as of September 25, 2026.",
  "Contents",
  "Credits",
  "1. Game Concepts",
  "100. General",
  "100.1. Example general rule text.",
  "This line continues the first rule.",
  "100.1a Example child rule text.",
  "100.1b Example second child rule text.",
  "100.1c Example third child rule text.",
  "100.2. See rule 200.1 and rules 300.1-300.2 and 100.1a-c.",
  "200. General",
  "200.1. Example card rule text.",
  "300. Card Types",
  "300.1. Example card type rule text.",
  "300.2. Example second card type rule text.",
  "400. Zones",
  "400.1. Example zone rule text.",
  "500. Turn Structure",
  "500.1. Example turn rule text.",
  "600. Spells and Abilities",
  "600.1. Example spell rule text.",
  "700. Additional Rules",
  "700.1. Example additional rule text.",
  "800. Multiplayer Rules",
  "800.1. Example multiplayer rule text.",
  "900. Casual Variants",
  "900.1. Example variant rule text.",
  "Glossary",
  "Example term",
].join("\n");

void describe("Comprehensive Rules importer", () => {
  void it("parses headings, rule hierarchy, effective date, and cross-references", () => {
    const parsed = parseRulesDocument(rulesFixture, 10);
    const rule = parsed.rules.find((entry) => entry.number === "100.2");

    assert.equal(parsed.effectiveAt.toISOString(), "2026-09-25T00:00:00.000Z");
    assert.equal(parsed.rules[0]?.number, "100");
    assert.equal(parsed.rules[1]?.parentNumber, "100");
    assert.equal(
      parsed.rules[1]?.text,
      "Example general rule text.\nThis line continues the first rule.",
    );
    assert.equal(parsed.rules[2]?.number, "100.1a");
    assert.equal(parsed.rules[2]?.parentNumber, "100.1");
    assert.deepEqual(rule?.references, ["200.1", "300.1", "300.2", "100.1a", "100.1b", "100.1c"]);
    assert.ok(parsed.rules.some((entry) => entry.number === "900.1"));
  });

  void it("rejects malformed documents before the writer can replace an active snapshot", async () => {
    let writerCalled = false;
    const writer = {
      activateRulesSnapshot(_input: RulesSnapshotInput): Promise<{ id: string; version: string }> {
        writerCalled = true;
        return Promise.resolve({ id: "snapshot", version: "test" });
      },
    };

    await assert.rejects(
      importRulesText(
        "These rules are effective as of September 25, 2026.\nNot a rules body.",
        "source",
        writer,
      ),
      /Rules document body was not found/,
    );
    assert.equal(writerCalled, false);
  });

  void it("rejects a substantial but truncated document before calling the writer", async () => {
    const truncatedFixture = [
      "Magic: The Gathering Comprehensive Rules",
      "These rules are effective as of September 25, 2026.",
      "Contents",
      "Credits",
      "1. Game Concepts",
      "100. General",
      ...Array.from({ length: 1000 }, (_, index) => `100.${index + 1}. Example rule text.`),
      ...[200, 300, 400, 500, 600, 700, 800, 900].flatMap((section) => [
        `${section}. Section`,
        `${section}.1. Example rule text.`,
      ]),
    ].join("\n");
    let writerCalled = false;
    const writer = {
      activateRulesSnapshot(_input: RulesSnapshotInput): Promise<{ id: string; version: string }> {
        writerCalled = true;
        return Promise.resolve({ id: "snapshot", version: "test" });
      },
    };

    await assert.rejects(
      importRulesText(truncatedFixture, "source", writer),
      /glossary terminator was not found/,
    );
    assert.equal(writerCalled, false);
  });

  void it("rejects extracted cross-references to rules missing from the document", () => {
    assert.throws(
      () => parseRulesDocument(rulesFixture.replace("300.1-300.2", "300.1-300.999"), 10),
      /Rule 100.2 references missing rule 300.999/,
    );
  });

  void it("rejects duplicate or incomplete source sections", () => {
    const duplicateRule = rulesFixture.replace("900. Casual Variants", "100. Duplicate");
    assert.throws(() => parseRulesDocument(duplicateRule, 10), /duplicate rule numbers/);
    assert.throws(
      () => parseRulesDocument(rulesFixture.replace("900. Casual Variants", "950. Other"), 10),
      /missing expected sections: 900/,
    );
  });
});
