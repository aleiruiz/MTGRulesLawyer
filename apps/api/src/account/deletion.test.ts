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
      deleteAuthIdentity: null,
    });
    await assert.rejects(deleteAccount("app-user-id"), AccountDeletionUnavailableError);
    assert.equal(dataDeleted, false);
  });

  void it("deletes app data before the sign-in identity", async () => {
    const steps: string[] = [];
    const deleteAccount = createAccountDeleter({
      deleteAppUserData: (id) => {
        steps.push(`data:${id}`);
        return Promise.resolve({ supabaseUserId: "auth-user-id" });
      },
      deleteAuthIdentity: (id) => {
        steps.push(`identity:${id}`);
        return Promise.resolve();
      },
    });
    await deleteAccount("app-user-id");
    assert.deepEqual(steps, ["data:app-user-id", "identity:auth-user-id"]);
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
