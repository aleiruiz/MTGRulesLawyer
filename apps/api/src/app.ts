import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { healthResponseSchema } from "@mtg-rules/contracts";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  void app.register(cors, { origin: true });
  app.get("/health", async (_request, reply) =>
    reply.send(healthResponseSchema.parse({ status: "ok", service: "mtg-rules-api" })),
  );

  return app;
}
