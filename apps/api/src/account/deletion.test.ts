import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { buildApp } from "../app.js";
import {
  AccountDeletionUnavailableError,
  AuthIdentityDeletionError,
  createAccountDeleter,
  createSupabaseAuthIdentityDeleter,
  hasSupabaseSecretKey,
} from "./deletion.js";

void describe("Supabase identity deletion", () => {
  void it("calls the admin endpoint with the server secret and accepts an already-deleted user", async () => {
    const calls: Array<{ url: string; method?: string; apikey: string | null }> = [];
    let status = 200;
    const deleteIdentity = createSupabaseAuthIdentityDeleter({
      url: "https://project.supabase.co/",
      secretKey: "server-secret",
      fetch: (input, init) => {
        calls.push({
          url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          ...(init?.method ? { method: init.method } : {}),
          apikey: new Headers(init?.headers).get("apikey"),
        });
        return Promise.resolve(new Response(null, { status }));
      },
    });
    await deleteIdentity("auth-user/id");
    assert.deepEqual(calls[0], {
      url: "https://project.supabase.co/auth/v1/admin/users/auth-user%2Fid",
      method: "DELETE",
      apikey: "server-secret",
    });
    status = 404;
    await deleteIdentity("auth-user-id");
    status = 500;
    await assert.rejects(deleteIdentity("auth-user-id"), AuthIdentityDeletionError);
  });

  void it("treats empty and placeholder secret keys as not configured", () => {
    assert.equal(hasSupabaseSecretKey(undefined), false);
    assert.equal(hasSupabaseSecretKey(" "), false);
    assert.equal(hasSupabaseSecretKey("replace-me"), false);
    assert.equal(hasSupabaseSecretKey("sb_publishable_example"), false);
    assert.equal(hasSupabaseSecretKey("sb_secret_example"), true);
  });
});

void describe("account deleter", () => {
  void it("refuses before touching data when identity deletion is not configured", async () => {
    let dataDeleted = false;
    const deleteAccount = createAccountDeleter({
      deleteAppUserData: () => {
        dataDeleted = true;
        return Promise.resolve({ supabaseUserId: "auth-user-id" });
      },
      deleteAppUserDataBySupabaseUserId: () => Promise.resolve(),
      deleteAuthIdentity: null,
    });
    await assert.rejects(deleteAccount("app-user-id"), AccountDeletionUnavailableError);
    assert.equal(dataDeleted, false);
  });

  void it("deletes app data, then the sign-in identity, then any record recreated meanwhile", async () => {
    const steps: string[] = [];
    const deleteAccount = createAccountDeleter({
      deleteAppUserData: (id) => {
        steps.push(`data:${id}`);
        return Promise.resolve({ supabaseUserId: "auth-user-id" });
      },
      deleteAppUserDataBySupabaseUserId: (id) => {
        steps.push(`cleanup:${id}`);
        return Promise.resolve();
      },
      deleteAuthIdentity: (id) => {
        steps.push(`identity:${id}`);
        return Promise.resolve();
      },
    });
    await deleteAccount("app-user-id");
    assert.deepEqual(steps, ["data:app-user-id", "identity:auth-user-id", "cleanup:auth-user-id"]);
  });

  void it("still succeeds and reports when the post-identity cleanup keeps failing", async () => {
    let cleanupAttempts = 0;
    let reported = 0;
    const deleteAccount = createAccountDeleter({
      deleteAppUserData: () => Promise.resolve({ supabaseUserId: "auth-user-id" }),
      deleteAppUserDataBySupabaseUserId: () => {
        cleanupAttempts += 1;
        return Promise.reject(new Error("database unavailable"));
      },
      deleteAuthIdentity: () => Promise.resolve(),
      onCleanupError: () => {
        reported += 1;
      },
    });
    await deleteAccount("app-user-id");
    assert.equal(cleanupAttempts, 2);
    assert.equal(reported, 1);
  });
});

const deletedAccounts: string[] = [];
let failure: Error | null = null;
const accountApp = buildApp({
  corsAllowedOrigins: [],
  verifyAccessToken: (token) =>
    Promise.resolve(token === "user-token" ? { subject: "auth-user-id" } : null),
  resolveAppUser: () => Promise.resolve({ id: "app-user-id", role: "USER" }),
  deleteAccount: (id) => {
    if (failure) return Promise.reject(failure);
    deletedAccounts.push(id);
    return Promise.resolve();
  },
});

void describe("DELETE /api/me", () => {
  void after(async () => accountApp.close());

  void it("requires a valid sign-in and deletes only the caller's account", async () => {
    const anonymous = await accountApp.inject({ method: "DELETE", url: "/api/me" });
    assert.equal(anonymous.statusCode, 401);
    const forged = await accountApp.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { authorization: "Bearer forged" },
    });
    assert.equal(forged.statusCode, 401);
    assert.deepEqual(deletedAccounts, []);

    const deleted = await accountApp.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { authorization: "Bearer user-token" },
    });
    assert.equal(deleted.statusCode, 204);
    assert.deepEqual(deletedAccounts, ["app-user-id"]);
  });

  void it("reports an unconfigured server and a failed identity deletion distinctly", async () => {
    const headers = { authorization: "Bearer user-token" };
    failure = new AccountDeletionUnavailableError();
    const unavailable = await accountApp.inject({ method: "DELETE", url: "/api/me", headers });
    assert.equal(unavailable.statusCode, 503);
    assert.deepEqual(unavailable.json(), { error: "ACCOUNT_DELETION_UNAVAILABLE" });

    failure = new AuthIdentityDeletionError();
    const partial = await accountApp.inject({ method: "DELETE", url: "/api/me", headers });
    assert.equal(partial.statusCode, 502);
    assert.deepEqual(partial.json(), { error: "ACCOUNT_IDENTITY_DELETION_FAILED" });
    failure = null;
  });
});

const hardeningNow = Date.UTC(2026, 9, 12, 12);
const hardeningSessions: Record<string, { assuranceLevel: string; authenticatedAt: number }> = {
  "player-token": { assuranceLevel: "aal1", authenticatedAt: hardeningNow / 1000 },
  "aal1-admin-token": { assuranceLevel: "aal1", authenticatedAt: hardeningNow / 1000 },
  "fresh-admin-token": { assuranceLevel: "aal2", authenticatedAt: hardeningNow / 1000 - 60 },
};
const hardeningDeleted: string[] = [];
const hardeningApp = buildApp({
  corsAllowedOrigins: [],
  adminAuthMaxAgeSeconds: 3_600,
  now: () => hardeningNow,
  verifyAccessToken: (token) => {
    const session = hardeningSessions[token];
    return Promise.resolve(session ? { subject: token, ...session } : null);
  },
  resolveAppUser: (subject) =>
    Promise.resolve({ id: subject, role: subject.includes("admin") ? "ADMIN" : "USER" }),
  deleteAccount: (id) => {
    hardeningDeleted.push(id);
    return Promise.resolve();
  },
});

void describe("DELETE /api/me hardening", () => {
  void after(async () => hardeningApp.close());

  void it("requires a fresh second factor before deleting an admin account", async () => {
    const stale = await hardeningApp.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { authorization: "Bearer aal1-admin-token" },
    });
    assert.equal(stale.statusCode, 403);
    assert.deepEqual(stale.json(), { error: "ADMIN_MFA_REQUIRED" });
    assert.deepEqual(hardeningDeleted, []);

    const fresh = await hardeningApp.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { authorization: "Bearer fresh-admin-token" },
    });
    assert.equal(fresh.statusCode, 204);
    assert.deepEqual(hardeningDeleted, ["fresh-admin-token"]);
  });

  void it("limits each account to three deletion attempts per hour", async () => {
    const headers = { authorization: "Bearer player-token" };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await hardeningApp.inject({ method: "DELETE", url: "/api/me", headers });
      assert.equal(response.statusCode, 204);
    }
    const limited = await hardeningApp.inject({ method: "DELETE", url: "/api/me", headers });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers["retry-after"], "3600");
    assert.deepEqual(limited.json(), {
      error: "ACCOUNT_DELETION_RATE_LIMITED",
      retryAfterSeconds: 3_600,
    });
  });
});

void describe("DELETE /api/me limit after a recreated app record", () => {
  let recreated = 0;
  const recreatingApp = buildApp({
    corsAllowedOrigins: [],
    verifyAccessToken: (token) =>
      Promise.resolve(token === "player-token" ? { subject: "supabase-player" } : null),
    // A failed identity deletion leaves the token valid, so each retry gets a new app record.
    resolveAppUser: () => Promise.resolve({ id: `app-user-${(recreated += 1)}`, role: "USER" }),
    deleteAccount: () => Promise.reject(new AuthIdentityDeletionError()),
  });
  void after(async () => recreatingApp.close());

  void it("keys the limit on the Supabase user, not the app record", async () => {
    const headers = { authorization: "Bearer player-token" };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await recreatingApp.inject({ method: "DELETE", url: "/api/me", headers });
      assert.equal(response.statusCode, 502);
    }
    const limited = await recreatingApp.inject({ method: "DELETE", url: "/api/me", headers });
    assert.equal(limited.statusCode, 429);
  });
});
