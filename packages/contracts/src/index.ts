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
