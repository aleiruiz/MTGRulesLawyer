import type {
  ConfirmedQuestionEvidenceRequest,
  EvidenceSearchResponse,
} from "@mtg-rules/contracts";
import type { ModelRuling } from "./generate.js";
import type { RulingEvaluationCase } from "./evaluation-seed-set.js";

const RULES_URL = "https://magic.wizards.com/en/rules";
const CARDS_URL = "https://scryfall.com/docs/api/bulk-data";

export function makeEvaluationEvidence(
  fixture: RulingEvaluationCase,
  index: number,
): EvidenceSearchResponse {
  return {
    snapshot: {
      id: `evaluation-snapshot-${index}`,
      version: "rules-2026-06-19",
      activatedAt: null,
    },
    sources: [
      {
        id: `rules-source-${index}`,
        kind: "COMPREHENSIVE_RULES",
        sourceUrl: RULES_URL,
        sourceVersion: "2026-06-19",
        sourcePublishedAt: null,
        checksumSha256: "a".repeat(64),
      },
      {
        id: `cards-source-${index}`,
        kind: "ORACLE_CARDS",
        sourceUrl: CARDS_URL,
        sourceVersion: "oracle-fixture",
        sourcePublishedAt: null,
        checksumSha256: "b".repeat(64),
      },
    ],
    cards: fixture.cards.map((card, cardIndex) => ({
      id: `card-${index}-${cardIndex}`,
      oracleId: `oracle-${index}-${cardIndex}`,
      name: card.name,
      layout: "normal",
      selectedFaceIndex: 0,
      quantity: card.quantity ?? 1,
      matchedFace: {
        id: `face-${index}-${cardIndex}`,
        faceIndex: 0,
        role: "OTHER",
        name: card.name,
        oracleText: card.oracleText,
        truncated: false,
      },
      faces: [
        {
          id: `face-${index}-${cardIndex}`,
          faceIndex: 0,
          role: "OTHER",
          name: card.name,
          oracleText: card.oracleText,
          truncated: false,
        },
      ],
    })),
    rules: fixture.rules.map((rule) => ({
      id: `rule-${index}-${rule.number}`,
      number: rule.number,
      text: rule.text,
      parentNumber: rule.number.split(".")[0] ?? null,
      includedBecause: "MATCH",
      truncated: false,
    })),
    truncated: false,
  };
}

export function makeEvaluationRequest(
  fixture: RulingEvaluationCase,
  evidence: EvidenceSearchResponse,
): ConfirmedQuestionEvidenceRequest {
  return {
    question: fixture.question,
    gameState: {
      events: [],
      knownFacts: [],
      missingFacts:
        fixture.expectedOutcome === "needs_information" ? ["the creature and effect involved"] : [],
      searchTerms: [],
    },
    confirmedCards: evidence.cards.map((card) => ({
      oracleId: card.oracleId,
      faceIndex: card.selectedFaceIndex,
      quantity: card.quantity ?? 1,
    })),
  };
}

export function makeRecordedModelOutput(
  fixture: RulingEvaluationCase,
  evidence: EvidenceSearchResponse,
): ModelRuling {
  const ruleIdByNumber = new Map(evidence.rules.map((rule) => [rule.number, rule.id]));
  return {
    neededRuleNumbers: [],
    outcome: fixture.modelOutput.outcome,
    summary: fixture.modelOutput.summary,
    summarySupport: fixture.modelOutput.summarySupport,
    summaryCitationIds: fixture.modelOutput.summaryCitationNumbers.flatMap((number) => {
      const id = ruleIdByNumber.get(number);
      return id ? [id] : [];
    }),
    reasoningSteps: fixture.modelOutput.reasoningSteps.map((step) => ({
      text: step.text,
      support: step.support,
      citationIds: step.citationNumbers.flatMap((number) => {
        const id = ruleIdByNumber.get(number);
        return id ? [id] : [];
      }),
    })),
    assumptions: fixture.modelOutput.assumptions,
    clarificationQuestions: fixture.modelOutput.clarificationQuestions,
  };
}

export function getCitationRuleNumbers(
  verifiedCitations: Array<{ kind: "RULE" | "CARD_FACE" | "CARD_RULING"; label: string }>,
): string[] {
  return verifiedCitations.filter((citation) => citation.kind === "RULE").map(({ label }) => label);
}
