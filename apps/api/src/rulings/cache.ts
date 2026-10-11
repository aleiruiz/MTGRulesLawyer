import { createHash } from "node:crypto";
import {
  rulingGenerationResponseSchema,
  type RulingGenerationResponse,
} from "@mtg-rules/contracts";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db/client.js";

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

export function createVerifiedRulingCacheKey(input: {
  snapshotId: string;
  modelName: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function readRulingCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const ttlMs = Number(env.RULING_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_CACHE_TTL_MS) {
    throw new Error("RULING_CACHE_TTL_MS must be between 1000 and 86400000.");
  }
  return ttlMs;
}

export async function getCachedVerifiedRuling(
  key: string,
  client: PrismaClient = prisma,
  now = new Date(),
): Promise<RulingGenerationResponse | null> {
  await client.verifiedRulingCache.deleteMany({ where: { expiresAt: { lte: now } } });
  const entry = await client.verifiedRulingCache.findUnique({ where: { key } });
  if (!entry) return null;
  if (entry.expiresAt <= now) return null;
  const parsed = rulingGenerationResponseSchema.safeParse(entry.answer);
  if (!parsed.success) {
    await client.verifiedRulingCache.deleteMany({ where: { key } });
    return null;
  }
  return parsed.data;
}

export async function cacheVerifiedRuling(
  key: string,
  snapshotId: string,
  answer: RulingGenerationResponse,
  client: PrismaClient = prisma,
  now = new Date(),
): Promise<void> {
  const verified = rulingGenerationResponseSchema.parse(answer);
  const expiresAt = new Date(now.getTime() + readRulingCacheTtlMs());
  await client.verifiedRulingCache.upsert({
    where: { key },
    create: {
      key,
      snapshotId,
      answer: verified,
      createdAt: now,
      expiresAt,
    },
    update: {
      snapshotId,
      answer: verified,
      createdAt: now,
      expiresAt,
    },
  });
}

export interface VerifiedRulingCacheOperations {
  get(key: string): Promise<RulingGenerationResponse | null>;
  set(key: string, snapshotId: string, answer: RulingGenerationResponse): Promise<void>;
}

export async function reuseVerifiedRuling(
  key: string,
  snapshotId: string,
  generate: () => Promise<RulingGenerationResponse>,
  operations: VerifiedRulingCacheOperations = {
    get: (cacheKey) => getCachedVerifiedRuling(cacheKey),
    set: (cacheKey, id, answer) => cacheVerifiedRuling(cacheKey, id, answer),
  },
): Promise<RulingGenerationResponse> {
  const cached = await operations.get(key);
  if (cached) return cached;
  const answer = rulingGenerationResponseSchema.parse(await generate());
  await operations.set(key, snapshotId, answer);
  return answer;
}
