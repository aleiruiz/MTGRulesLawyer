import type { UserRole } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  DEFAULT_ADMIN_AUTH_MAX_AGE_SECONDS,
  evaluateAdminAssurance,
  type SessionAssurance,
} from "./admin-assurance.js";
import type { AccessTokenVerifier } from "./supabase-auth.js";
import { AuthVerificationUnavailableError } from "./supabase-auth.js";

export interface AuthenticatedAppUser {
  id: string;
  role: UserRole;
}

declare module "fastify" {
  interface FastifyRequest {
    appUser: AuthenticatedAppUser | null;
    authSession: SessionAssurance | null;
  }
}

export type AppUserResolver = (subject: string) => Promise<AuthenticatedAppUser>;

export interface AdminAssuranceOptions {
  /** Maximum age of the latest sign-in or second-factor check for admin operations. */
  adminAuthMaxAgeSeconds?: number;
  now?: () => number;
}

export function registerAuthentication(
  app: FastifyInstance,
  verifier: AccessTokenVerifier,
  resolveUser: AppUserResolver,
  options: AdminAssuranceOptions = {},
): void {
  app.decorateRequest("appUser", null);
  app.decorateRequest("authSession", null);
  const authenticate = createAuthenticationPreHandler(verifier, resolveUser);
  const maxAgeSeconds = options.adminAuthMaxAgeSeconds ?? DEFAULT_ADMIN_AUTH_MAX_AGE_SECONDS;
  const now = options.now ?? Date.now;
  app.addHook("preHandler", async (request, reply) => {
    // Match on the routed pattern, not the raw URL: the router decodes %XX before matching, so a
    // raw-URL check would miss requests such as /api/%61dmin/challenges.
    const path = request.routeOptions.url ?? "";
    if (isNamespacePath(path, "/api/auth")) return authenticate(request, reply);
    if (!isNamespacePath(path, "/api/admin")) return;
    await authenticate(request, reply);
    if (reply.sent) return;
    if (request.appUser?.role !== "ADMIN") return reply.code(403).send({ error: "ADMIN_REQUIRED" });
    const assurance = evaluateAdminAssurance(request.authSession, now(), maxAgeSeconds);
    if (assurance === "allowed") return;
    request.log.warn(
      { event: "admin.assurance.denied", reason: assurance },
      "Admin request needs a stronger or more recent sign-in",
    );
    return reply.code(403).send({
      error:
        assurance === "mfa_required" ? "ADMIN_MFA_REQUIRED" : "ADMIN_REAUTHENTICATION_REQUIRED",
    });
  });
}

/** Attach this preHandler to every signed-in route, then use requireResourceOwner per loaded row. */
export function createAuthenticationPreHandler(
  verifier: AccessTokenVerifier,
  resolveUser: AppUserResolver,
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      reply.code(401).send({ error: "AUTHENTICATION_REQUIRED" });
      return;
    }
    try {
      const identity = await verifier(token);
      if (!identity) {
        reply.code(401).send({ error: "INVALID_ACCESS_TOKEN" });
        return;
      }
      request.authSession = {
        assuranceLevel: identity.assuranceLevel ?? null,
        authenticatedAt: identity.authenticatedAt ?? null,
      };
      request.appUser = await resolveUser(identity.subject);
    } catch (error) {
      if (error instanceof AuthVerificationUnavailableError) {
        reply.code(503).send({ error: "AUTHENTICATION_UNAVAILABLE" });
        return;
      }
      request.log.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "User identity lookup failed",
      );
      reply.code(503).send({ error: "AUTHENTICATION_UNAVAILABLE" });
    }
  };
}

function isNamespacePath(path: string, namespace: string): boolean {
  return path === namespace || path.startsWith(`${namespace}/`);
}

export function requireAuthenticatedUser(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthenticatedAppUser | null {
  if (!request.appUser) {
    void reply.code(401).send({ error: "AUTHENTICATION_REQUIRED" });
    return null;
  }
  return request.appUser;
}

/** Use this guard in every private resource handler after loading its owner from the database. */
export function requireResourceOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  ownerId: string,
): boolean {
  const user = requireAuthenticatedUser(request, reply);
  if (!user) return false;
  if (user.id !== ownerId) {
    void reply.code(404).send({ error: "RESOURCE_NOT_FOUND" });
    return false;
  }
  return true;
}

function readBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/i.exec(value);
  return match?.[1] ?? null;
}
