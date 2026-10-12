import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../db/client.js";

/** Replaces a deleted player's challenge text; reviewers keep the decision trail without it. */
export const DELETED_CHALLENGE_EXPLANATION = "[Removed when the player deleted their account.]";

export class AccountDeletionUnavailableError extends Error {
  constructor() {
    super("Account deletion is not configured on this server.");
    this.name = "AccountDeletionUnavailableError";
  }
}

export class AuthIdentityDeletionError extends Error {
  constructor() {
    super("The sign-in identity could not be deleted.");
    this.name = "AuthIdentityDeletionError";
  }
}

/**
 * Removes everything the app stores for an account, in one transaction:
 * - challenges nobody has reviewed yet are deleted;
 * - reviewed challenges keep their audit trail but lose the player's text, proposed outcome and
 *   evaluation consent, and their user link is cleared;
 * - review events the account made as an admin keep the decision but lose the reviewer link;
 * - usage windows are deleted with the account.
 * Questions and rulings are not linked to accounts. Returns the Supabase user ID to delete next,
 * or null when the account has no app record.
 */
export async function deleteAppUserData(
  appUserId: string,
  client: PrismaClient = defaultPrisma,
): Promise<{ supabaseUserId: string } | null> {
  return client.$transaction(async (tx) => {
    // Same per-user lock as challenge submission, so no new challenge slips in mid-deletion.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${appUserId}, 0))::text`;
    const user = await tx.appUser.findUnique({
      where: { id: appUserId },
      select: { supabaseUserId: true },
    });
    if (!user) return null;
    // Admin decisions update the challenge row before adding their review event. Waiting for those
    // row locks means the next statement sees any review that committed meanwhile, so a reviewed
    // challenge is anonymized instead of failing the delete on its review-event foreign key.
    await tx.$queryRaw`SELECT "id" FROM "Challenge" WHERE "userId" = ${appUserId}::uuid FOR UPDATE`;
    await tx.challenge.deleteMany({ where: { userId: appUserId, reviewEvents: { none: {} } } });
    // Withdrawn consent also removes reviewed fixtures from future evaluation exports.
    await tx.reviewEvent.updateMany({
      where: { challenge: { userId: appUserId } },
      data: { includeInEvaluation: false, evaluationFixture: Prisma.DbNull },
    });
    await tx.challenge.updateMany({
      where: { userId: appUserId },
      data: {
        explanation: DELETED_CHALLENGE_EXPLANATION,
        proposedOutcome: null,
        evaluationConsent: false,
      },
    });
    await tx.appUser.delete({ where: { id: appUserId } });
    return { supabaseUserId: user.supabaseUserId };
  });
}

export type AuthIdentityDeleter = (supabaseUserId: string) => Promise<void>;

/** Deletes the Supabase Auth user with the server-only secret key; a missing user counts as done. */
export function createSupabaseAuthIdentityDeleter(options: {
  url: string;
  secretKey: string;
  fetch?: typeof fetch;
}): AuthIdentityDeleter {
  const baseUrl = options.url.replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;
  return async (supabaseUserId) => {
    let response: Response;
    try {
      response = await fetcher(
        `${baseUrl}/auth/v1/admin/users/${encodeURIComponent(supabaseUserId)}`,
        {
          method: "DELETE",
          headers: { apikey: options.secretKey, authorization: `Bearer ${options.secretKey}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new AuthIdentityDeletionError();
    }
    if (response.ok || response.status === 404) return;
    throw new AuthIdentityDeletionError();
  };
}

/** True when a real server-only Supabase secret key is configured (not empty or a placeholder). */
export function hasSupabaseSecretKey(value: string | undefined): value is string {
  const key = value?.trim() ?? "";
  // A publishable key cannot delete users; accepting it would wipe app data and then fail.
  return key.length > 0 && key !== "replace-me" && !key.startsWith("sb_publishable_");
}

/** Deletes the app record (if any) for a Supabase user ID; see deleteAppUserData. */
export async function deleteAppUserDataBySupabaseUserId(
  supabaseUserId: string,
  client: PrismaClient = defaultPrisma,
): Promise<void> {
  const user = await client.appUser.findUnique({
    where: { supabaseUserId },
    select: { id: true },
  });
  if (user) await deleteAppUserData(user.id, client);
}

/**
 * Deletes app data first, then the sign-in identity, so a failed second step can be retried.
 * A request still carrying the old token can recreate an empty app record while the identity
 * call runs, so the record is cleaned up once more after the identity is gone.
 */
export function createAccountDeleter(options: {
  deleteAppUserData: (appUserId: string) => Promise<{ supabaseUserId: string } | null>;
  deleteAppUserDataBySupabaseUserId: (supabaseUserId: string) => Promise<void>;
  deleteAuthIdentity: AuthIdentityDeleter | null;
}): (appUserId: string) => Promise<void> {
  return async (appUserId) => {
    if (!options.deleteAuthIdentity) throw new AccountDeletionUnavailableError();
    const deleted = await options.deleteAppUserData(appUserId);
    if (!deleted) return;
    await options.deleteAuthIdentity(deleted.supabaseUserId);
    await options.deleteAppUserDataBySupabaseUserId(deleted.supabaseUserId);
  };
}
