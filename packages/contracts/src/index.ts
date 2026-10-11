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
  cards: z.array(
    z.object({
      id: z.string(),
      oracleId: z.string(),
      name: z.string(),
      layout: z.string(),
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
  ),
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
