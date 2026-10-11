import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EvidenceSearchResponse } from "@mtg-rules/contracts";
import { createClarificationResponse, verifyRulingOutput } from "./generate.js";

const evidence: EvidenceSearchResponse = {
  snapshot: { id: "snapshot-id", version: "rules-2026-10", activatedAt: null },
  sources: [
    {
      id: "rules-source-id",
      kind: "COMPREHENSIVE_RULES",
      sourceUrl: "https://magic.wizards.com/en/rules",
      sourceVersion: "rules-2026-10",
      sourcePublishedAt: null,
      checksumSha256: "a".repeat(64),
    },
    {
      id: "oracle-source-id",
      kind: "ORACLE_CARDS",
      sourceUrl: "https://scryfall.com/docs/api/bulk-data",
      sourceVersion: "oracle-2026-10",
      sourcePublishedAt: null,
      checksumSha256: "b".repeat(64),
    },
  ],
  cards: [
    {
      id: "card-id",
      oracleId: "oracle-id",
      name: "Fixture Creature",
      layout: "normal",
      selectedFaceIndex: 0,
      quantity: 1,
      matchedFace: {
        id: "face-id",
        faceIndex: 0,
        role: "OTHER",
        name: "Fixture Creature",
        oracleText: "Whenever this creature attacks, draw a card.",
        truncated: false,
      },
      faces: [
        {
          id: "face-id",
          faceIndex: 0,
          role: "OTHER",
          name: "Fixture Creature",
          oracleText: "Whenever this creature attacks, draw a card.",
          truncated: false,
        },
      ],
    },
  ],
  rules: [
    {
      id: "rule-id",
      number: "508.1",
      text: "The active player declares attackers.",
      parentNumber: "508",
      includedBecause: "MATCH",
      truncated: false,
    },
  ],
  truncated: false,
};

void describe("Ruling evidence verification", () => {
  void it("attaches citations only from the supplied snapshot and source records", () => {
    const result = verifyRulingOutput(
      {
        outcome: "resolved",
        summary: "The creature's attack ability triggers when it attacks.",
        summarySupport: "SUPPORTED",
        summaryCitationIds: ["face-id"],
        reasoningSteps: [
          {
            text: "The creature was declared as an attacker.",
            support: "SUPPORTED",
            citationIds: ["rule-id"],
          },
        ],
        assumptions: [],
        clarificationQuestions: [],
      },
      evidence,
      "test-model",
    );

    assert.equal(result.outcome, "resolved");
    assert.equal(result.snapshot.id, "snapshot-id");
    assert.deepEqual(
      result.citations.map(({ id, sourceId }) => [id, sourceId]),
      [
        ["face-id", "oracle-source-id"],
        ["rule-id", "rules-source-id"],
      ],
    );
    assert.deepEqual(result.summaryCitationIds, ["face-id"]);
  });

  void it("falls back to uncertain and drops all citations for an unknown evidence ID", () => {
    const result = verifyRulingOutput(
      {
        outcome: "resolved",
        summary: "A claim unsupported by this snapshot.",
        summarySupport: "SUPPORTED",
        summaryCitationIds: ["made-up-rule-id"],
        reasoningSteps: [
          { text: "Unsupported claim.", support: "SUPPORTED", citationIds: ["rule-id"] },
        ],
        assumptions: [],
        clarificationQuestions: [],
      },
      evidence,
      "test-model",
    );

    assert.equal(result.outcome, "uncertain");
    assert.deepEqual(result.citations, []);
    assert.deepEqual(result.summaryCitationIds, []);
  });

  void it("falls back to uncertain when a resolved result has no source support", () => {
    const result = verifyRulingOutput(
      {
        outcome: "resolved",
        summary: "The game is resolved.",
        summarySupport: "SUPPORTED",
        summaryCitationIds: [],
        reasoningSteps: [],
        assumptions: [],
        clarificationQuestions: [],
      },
      evidence,
      "test-model",
    );
    assert.equal(result.outcome, "uncertain");
    assert.equal(result.citations.length, 0);
  });

  void it("falls back to uncertain when a claim is marked unsupported despite valid citations", () => {
    const result = verifyRulingOutput(
      {
        outcome: "resolved",
        summary: "The evidence does not establish this conclusion.",
        summarySupport: "UNSUPPORTED",
        summaryCitationIds: ["rule-id"],
        reasoningSteps: [
          {
            text: "The cited rule is unrelated.",
            support: "UNSUPPORTED",
            citationIds: ["rule-id"],
          },
        ],
        assumptions: [],
        clarificationQuestions: [],
      },
      evidence,
      "test-model",
    );
    assert.equal(result.outcome, "uncertain");
    assert.deepEqual(result.citations, []);
  });

  void it("returns a clarification without claiming that a rule was resolved", () => {
    const result = createClarificationResponse(evidence, ["which replacement effect applied"]);
    assert.equal(result.outcome, "needs_information");
    assert.deepEqual(result.clarificationQuestions, [
      "Can you clarify which replacement effect applied?",
    ]);
    assert.equal(result.modelName, "not_called");
    assert.equal(result.citations.length, 0);
  });
});
