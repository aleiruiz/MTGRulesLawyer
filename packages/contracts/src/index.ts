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
