import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { UserRole } from "@prisma/client";
import { buildApp } from "../app.js";
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
    assert.deepEqual(await verify("signed.token.value"), { subject: "auth-user-id" });
    assert.equal(requestUrl, "https://project.supabase.co/auth/v1/user");
    assert.equal(authorization, "Bearer signed.token.value");
    activeProvider = "apple";
    assert.deepEqual(await verify("another-signed.token.value"), { subject: "auth-user-id" });
  });

  void it("rejects invalid tokens and fails closed when Supabase is unavailable", async () => {
    const invalid = createSupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "public-placeholder",
      fetch: () => Promise.resolve(new Response(null, { status: 401 })),
    });
    assert.equal(await invalid("forged.token"), null);
    assert.equal(await invalid("expired.token"), null);

    const unavailable = createSupabaseAccessTokenVerifier({
      url: "https://project.supabase.co",
      publishableKey: "public-placeholder",
      fetch: () => Promise.resolve(new Response(null, { status: 503 })),
    });
    await assert.rejects(unavailable("token"), AuthVerificationUnavailableError);
  });
});

const authApp = buildApp({
  verifyAccessToken: (token) =>
    Promise.resolve(token === "valid-user" || token === "valid-admin" ? { subject: token } : null),
  resolveAppUser: (subject) =>
    Promise.resolve({
      id: subject,
      role: subject === "valid-admin" && adminRole ? "ADMIN" : "USER",
    } satisfies { id: string; role: UserRole }),
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
