import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("mtg-rules-api"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const cardLookupResponseSchema = z.object({
  cards: z.array(
    z.object({
      oracleId: z.string(),
      name: z.string(),
      layout: z.string(),
      matchedFace: z.object({
        faceIndex: z.number().int().nonnegative(),
        role: z.enum(["FRONT", "BACK", "OTHER"]),
        name: z.string(),
        manaCost: z.string(),
        typeLine: z.string(),
        oracleText: z.string(),
        power: z.string().nullable(),
        toughness: z.string().nullable(),
        imageUri: z.string().url().nullable(),
      }),
      faces: z.array(
        z.object({
          faceIndex: z.number().int().nonnegative(),
          role: z.enum(["FRONT", "BACK", "OTHER"]),
          name: z.string(),
          manaCost: z.string(),
          typeLine: z.string(),
          oracleText: z.string(),
          power: z.string().nullable(),
          toughness: z.string().nullable(),
          imageUri: z.string().url().nullable(),
        }),
      ),
    }),
  ),
});

export type CardLookupResponse = z.infer<typeof cardLookupResponseSchema>;

function stripUnsafeControlCharacters(value: string): string {
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
      return !isControl || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join("");
}

export const questionInterpretRequestSchema = z.object({
  question: z
    .string()
    .transform(stripUnsafeControlCharacters)
    .pipe(
      z
        .string()
        .min(1)
        .max(4_000)
        .refine((question) => question.trim().length > 0),
    ),
});

export type QuestionInterpretRequest = z.infer<typeof questionInterpretRequestSchema>;

export const questionInterpretResponseSchema = z.object({
  inScope: z.boolean(),
  scopeReason: z.string().max(300),
  cardMentions: z
    .array(
      z.object({
        text: z.string().min(1).max(200),
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        candidates: z.array(cardLookupResponseSchema.shape.cards.element).max(10),
      }),
    )
    .max(10),
  entities: z.array(z.string().min(1).max(200)).max(12),
  events: z.array(z.string().min(1).max(300)).max(12),
  knownFacts: z.array(z.string().min(1).max(500)).max(12),
  missingFacts: z.array(z.string().min(1).max(300)).max(12),
  searchTerms: z.array(z.string().min(1).max(100)).max(10),
});

export type QuestionInterpretResponse = z.infer<typeof questionInterpretResponseSchema>;

export const evidenceSearchRequestSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  cardNames: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
});

export type EvidenceSearchRequest = z.infer<typeof evidenceSearchRequestSchema>;

export const MAX_CONFIRMED_CARDS = 10;

export const confirmedQuestionEvidenceRequestSchema = z.object({
  question: z.string().trim().min(1).max(4_000),
  gameState: z
    .object({
      events: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
      knownFacts: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
      missingFacts: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
      searchTerms: z.array(z.string().trim().min(1).max(100)).max(10).default([]),
    })
    .default({ events: [], knownFacts: [], missingFacts: [], searchTerms: [] }),
  confirmedCards: z
    .array(
      z.object({
        oracleId: z.string().min(1).max(100),
        faceIndex: z.number().int().nonnegative().max(20),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .max(MAX_CONFIRMED_CARDS)
    .default([])
    .refine((cards) => new Set(cards.map((card) => card.oracleId)).size === cards.length),
});

export type ConfirmedQuestionEvidenceRequest = z.input<
  typeof confirmedQuestionEvidenceRequestSchema
>;

export const evidenceSearchResponseSchema = z.object({
  snapshot: z.object({
    id: z.string(),
    version: z.string(),
    activatedAt: z.string().datetime().nullable(),
  }),
  sources: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["COMPREHENSIVE_RULES", "ORACLE_CARDS", "OFFICIAL_RULINGS"]),
      sourceUrl: z.string().url(),
      sourceVersion: z.string().nullable(),
      sourcePublishedAt: z.string().datetime().nullable(),
      checksumSha256: z.string().length(64),
    }),
  ),
  cards: z
    .array(
      z.object({
        id: z.string(),
        oracleId: z.string(),
        name: z.string(),
        layout: z.string(),
        selectedFaceIndex: z.number().int().nonnegative(),
        quantity: z.number().int().min(1).max(99),
        matchedFace: z.object({
          id: z.string(),
          faceIndex: z.number().int().nonnegative(),
          role: z.enum(["FRONT", "BACK", "OTHER"]),
          name: z.string(),
          oracleText: z.string(),
          truncated: z.boolean(),
        }),
        faces: z.array(
          z.object({
            id: z.string(),
            faceIndex: z.number().int().nonnegative(),
            role: z.enum(["FRONT", "BACK", "OTHER"]),
            name: z.string(),
            oracleText: z.string(),
            truncated: z.boolean(),
          }),
        ),
      }),
    )
    .max(MAX_CONFIRMED_CARDS),
  rules: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      text: z.string(),
      parentNumber: z.string().nullable(),
      includedBecause: z.enum(["MATCH", "REFERENCE", "PARENT"]),
      truncated: z.boolean(),
    }),
  ),
  truncated: z.boolean(),
});

export type EvidenceSearchResponse = z.infer<typeof evidenceSearchResponseSchema>;

export const rulingGenerationResponseSchema = z.object({
  outcome: z.enum(["resolved", "conditional", "needs_information", "uncertain"]),
  summary: z.string().min(1).max(1_200),
  reasoningSteps: z
    .array(
      z.object({
        text: z.string().min(1).max(800),
        citationIds: z.array(z.string()).max(8),
      }),
    )
    .max(12),
  summaryCitationIds: z.array(z.string()).max(8),
  assumptions: z.array(z.string().min(1).max(300)).max(12),
  clarificationQuestions: z.array(z.string().min(1).max(300)).max(6),
  citations: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["RULE", "CARD_FACE"]),
        label: z.string(),
        excerpt: z.string().max(2_000),
        sourceId: z.string(),
        sourceUrl: z.string().url(),
      }),
    )
    .max(64),
  snapshot: evidenceSearchResponseSchema.shape.snapshot,
  sources: evidenceSearchResponseSchema.shape.sources,
  modelName: z.string().max(100),
  promptVersion: z.string().max(100),
});

export type RulingGenerationResponse = z.infer<typeof rulingGenerationResponseSchema>;

export const persistedRulingResponseSchema = z.object({
  rulingId: z.string().uuid(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  question: z.string().max(4_000),
  confirmedCards: z
    .array(
      z.object({
        oracleId: z.string(),
        faceIndex: z.number().int().nonnegative(),
        quantity: z.number().int().positive(),
      }),
    )
    .max(MAX_CONFIRMED_CARDS),
  ruling: rulingGenerationResponseSchema,
});

export type PersistedRulingResponse = z.infer<typeof persistedRulingResponseSchema>;

export const challengeSubmissionRequestSchema = z.object({
  explanation: z.string().trim().min(10).max(4_000),
  proposedOutcome: rulingGenerationResponseSchema.shape.outcome.optional(),
});

export const challengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  rulingId: z.string().uuid(),
  question: z.string().max(4_000),
  explanation: z.string().max(4_000),
  proposedOutcome: rulingGenerationResponseSchema.shape.outcome.nullable(),
  status: z.enum(["open", "needs_information", "approved", "rejected"]),
  latestInformationRequest: z
    .object({ reason: z.string().max(2_000), createdAt: z.string().datetime() })
    .nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const myChallengesResponseSchema = z.object({
  challenges: z.array(challengeResponseSchema).max(50),
});

export type ChallengeSubmissionRequest = z.infer<typeof challengeSubmissionRequestSchema>;
export type ChallengeResponse = z.infer<typeof challengeResponseSchema>;
export type MyChallengesResponse = z.infer<typeof myChallengesResponseSchema>;

export const reviewQueueResponseSchema = z.object({
  challenges: z
    .array(
      z.object({
        challengeId: z.string().uuid(),
        rulingId: z.string().uuid(),
        question: z.string().max(4_000),
        challenge: challengeResponseSchema,
        originalRuling: z.object({
          version: z.number().int().positive(),
          outcome: rulingGenerationResponseSchema.shape.outcome,
          summary: z.string().max(4_000),
          reasoningSteps: z.array(z.object({ text: z.string().max(2_000) })).max(30),
          assumptions: z.array(z.string().max(1_000)).max(30),
          gameState: confirmedQuestionEvidenceRequestSchema.shape.gameState,
          confirmedCards: z
            .array(
              z.object({
                oracleId: z.string(),
                cardName: z.string(),
                faceIndex: z.number().int().nonnegative().nullable(),
                faceName: z.string().nullable(),
                quantity: z.number().int().positive(),
                oracleText: z.string().max(4_000).nullable(),
              }),
            )
            .max(MAX_CONFIRMED_CARDS),
          snapshot: z.object({
            version: z.string(),
            activatedAt: z.string().datetime().nullable(),
          }),
          citations: z
            .array(
              z.object({
                label: z.string().max(500),
                excerpt: z.string().max(2_000),
                sourceUrl: z.string().url(),
              }),
            )
            .max(64),
        }),
      }),
    )
    .max(100),
});

export const requestChallengeInformationSchema = z.object({
  reason: z.string().trim().min(10).max(2_000),
});

export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>;
export type RequestChallengeInformation = z.infer<typeof requestChallengeInformationSchema>;

export const sourceStatusResponseSchema = z.object({
  activeSnapshot: z
    .object({ id: z.string(), version: z.string(), activatedAt: z.string().datetime().nullable() })
    .nullable(),
  staleAfterHours: z.number().int().positive(),
  sources: z.array(
    z.object({
      kind: z.enum(["COMPREHENSIVE_RULES", "ORACLE_CARDS"]),
      sourceUrl: z.string().url(),
      sourceVersion: z.string().nullable(),
      checksumSha256: z.string().length(64).nullable(),
      importedAt: z.string().datetime().nullable(),
      checkedAt: z.string().datetime().nullable(),
      lastStatus: z.enum(["RUNNING", "UNCHANGED", "IMPORTED", "FAILED"]).nullable(),
      lastError: z.string().max(500).nullable(),
      stale: z.boolean(),
    }),
  ),
});

export type SourceStatusResponse = z.infer<typeof sourceStatusResponseSchema>;
