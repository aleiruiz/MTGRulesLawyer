import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { UserRole } from "@prisma/client";
import { buildApp } from "../app.js";
import { readAdminAuthMaxAgeSeconds } from "./admin-assurance.js";
import { createAuthenticationPreHandler, requireResourceOwner } from "./authorization.js";
import {
  AuthVerificationUnavailableError,
  createSupabaseAccessTokenVerifier,
} from "./supabase-auth.js";

void describe("Supabase access token verification", () => {
  void it("uses the verified stable Supabase user ID", async () => {
    let requestUrl = "";
    let authorization = "";
    let activeProvider = "google";
    const verify = createSupabaseAccessTokenVerifier({
      url: "https://project.supabase.co/",
      publishableKey: "public-placeholder",
      fetch: (input, init) => {
        requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Promise.resolve(
          Response.json({ id: "auth-user-id", app_metadata: { provider: activeProvider } }),
        );
      },
    });
    const noClaims = { subject: "auth-user-id", assuranceLevel: null, authenticatedAt: null };
    assert.deepEqual(await verify("signed.token.value"), noClaims);
    assert.equal(requestUrl, "https://project.supabase.co/auth/v1/user");
    assert.equal(authorization, "Bearer signed.token.value");
    activeProvider = "apple";
    assert.deepEqual(await verify("another-signed.token.value"), noClaims);
  });

  void it("reads assurance level and latest authentication time from the verified token", async () => {
    const verify = createSupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "public-placeholder",
      fetch: () => Promise.resolve(Response.json({ id: "auth-user-id" })),
    });
    const token = fakeAccessToken({
      sub: "auth-user-id",
      aal: "aal2",
      amr: [
        { method: "oauth", timestamp: 1_700_000_000 },
        { method: "totp", timestamp: 1_700_000_600 },
      ],
    });
    assert.deepEqual(await verify(token), {
      subject: "auth-user-id",
      assuranceLevel: "aal2",
      authenticatedAt: 1_700_000_600,
    });
    assert.equal(
      await verify(fakeAccessToken({ sub: "someone-else", aal: "aal2", amr: [] })),
      null,
    );
  });

  void it("rejects invalid tokens and fails closed when Supabase is unavailable", async () => {
    const invalid = createSupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "public-placeholder",
      fetch: () => Promise.resolve(new Response(null, { status: 401 })),
    });
    assert.equal(await invalid("forged.token"), null);
    assert.equal(await invalid("expired.token"), null);
    const deletedUser = createSupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "public-placeholder",
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    });
    assert.equal(await deletedUser("token-of-deleted-user"), null);

    const unavailable = createSupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "public-placeholder",
      fetch: () => Promise.resolve(new Response(null, { status: 503 })),
    });
    await assert.rejects(unavailable("token"), AuthVerificationUnavailableError);
  });
});

void describe("admin sign-in age setting", () => {
  void it("defaults to one hour and rejects invalid values", () => {
    assert.equal(readAdminAuthMaxAgeSeconds(undefined), 3_600);
    assert.equal(readAdminAuthMaxAgeSeconds("900"), 900);
    for (const invalid of ["0", "30", "not-a-number", "86401", "1.5"]) {
      assert.throws(() => readAdminAuthMaxAgeSeconds(invalid), invalid);
    }
  });
});

function fakeAccessToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(claims)}.signature`;
}

const nowMs = Date.UTC(2026, 9, 11, 12);
const nowSeconds = nowMs / 1000;
const adminSessions: Record<string, { assuranceLevel: string; authenticatedAt: number }> = {
  "valid-admin": { assuranceLevel: "aal2", authenticatedAt: nowSeconds - 60 },
  "aal1-admin": { assuranceLevel: "aal1", authenticatedAt: nowSeconds - 60 },
  "stale-admin": { assuranceLevel: "aal2", authenticatedAt: nowSeconds - 3_601 },
};
const authApp = buildApp({
  verifyAccessToken: (token) => {
    const adminSession = adminSessions[token];
    if (adminSession) return Promise.resolve({ subject: token, ...adminSession });
    return Promise.resolve(token === "valid-user" ? { subject: token } : null);
  },
  resolveAppUser: (subject) =>
    Promise.resolve({
      id: subject,
      role: subject.endsWith("-admin") && adminRole ? "ADMIN" : "USER",
    } satisfies { id: string; role: UserRole }),
  adminAuthMaxAgeSeconds: 3_600,
  now: () => nowMs,
});
let adminRole = true;
authApp.get("/api/admin/test", () => ({ allowed: true }));
authApp.get("/api/admin", () => ({ allowed: true }));
authApp.get("/api/auth", () => ({ allowed: true }));
authApp.get(
  "/api/private/test",
  {
    preHandler: createAuthenticationPreHandler(
      (token) =>
        Promise.resolve(
          token === "valid-user" || token === "valid-admin" ? { subject: token } : null,
        ),
      (subject) => Promise.resolve({ id: subject, role: "USER" }),
    ),
  },
  async (request, reply) =>
    requireResourceOwner(request, reply, "valid-user") ? { allowed: true } : reply,
);

void describe("API authorization", () => {
  void after(async () => authApp.close());

  void it("denies forged tokens and identifies authenticated users", async () => {
    const forged = await authApp.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: "Bearer forged" },
    });
    assert.equal(forged.statusCode, 401);
    const me = await authApp.inject({
      method: "GET",
      url: "/api/auth/me",
      headers: { authorization: "Bearer valid-user" },
    });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json(), { userId: "valid-user", role: "USER" });
  });

  void it("protects admin and auth routes reached through percent-encoded paths", async () => {
    for (const url of ["/api/%61dmin/test", "/%61pi/admin/test", "/api/admin/%74est"]) {
      const anonymous = await authApp.inject({ method: "GET", url });
      assert.equal(anonymous.statusCode, 401, url);
      const staleAdmin = await authApp.inject({
        method: "GET",
        url,
        headers: { authorization: "Bearer stale-admin" },
      });
      assert.deepEqual(staleAdmin.json(), { error: "ADMIN_REAUTHENTICATION_REQUIRED" }, url);
    }
    const encodedAuth = await authApp.inject({ method: "GET", url: "/api/%61uth/me" });
    assert.equal(encodedAuth.statusCode, 401);
  });

  void it("checks admin role from the database-backed resolver on every request", async () => {
    const headers = { authorization: "Bearer valid-admin" };
    assert.equal(
      (await authApp.inject({ method: "GET", url: "/api/admin/test", headers })).statusCode,
      200,
    );
    adminRole = false;
    assert.equal(
      (await authApp.inject({ method: "GET", url: "/api/admin/test", headers })).statusCode,
      403,
    );
    assert.equal(
      (await authApp.inject({ method: "GET", url: "/api/admin", headers })).statusCode,
      403,
    );
    adminRole = true;
  });

  void it("requires a second factor and a recent sign-in for admin requests", async () => {
    const withoutMfa = await authApp.inject({
      method: "GET",
      url: "/api/admin/test",
      headers: { authorization: "Bearer aal1-admin" },
    });
    assert.equal(withoutMfa.statusCode, 403);
    assert.deepEqual(withoutMfa.json(), { error: "ADMIN_MFA_REQUIRED" });

    const stale = await authApp.inject({
      method: "GET",
      url: "/api/admin/test",
      headers: { authorization: "Bearer stale-admin" },
    });
    assert.equal(stale.statusCode, 403);
    assert.deepEqual(stale.json(), { error: "ADMIN_REAUTHENTICATION_REQUIRED" });

    const nonAdmin = await authApp.inject({
      method: "GET",
      url: "/api/admin/test",
      headers: { authorization: "Bearer valid-user" },
    });
    assert.deepEqual(nonAdmin.json(), { error: "ADMIN_REQUIRED" });
  });

  void it("protects the exact auth namespace root", async () => {
    const response = await authApp.inject({ method: "GET", url: "/api/auth" });
    assert.equal(response.statusCode, 401);
  });

  void it("restricts private resources to their owner", async () => {
    const owner = await authApp.inject({
      method: "GET",
      url: "/api/private/test",
      headers: { authorization: "Bearer valid-user" },
    });
    const other = await authApp.inject({
      method: "GET",
      url: "/api/private/test",
      headers: { authorization: "Bearer valid-admin" },
    });
    assert.equal(owner.statusCode, 200);
    assert.equal(other.statusCode, 404);
  });
});
