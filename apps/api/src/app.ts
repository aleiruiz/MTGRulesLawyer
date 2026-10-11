import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import {
  cardLookupResponseSchema,
  healthResponseSchema,
  type CardLookupResponse,
} from "@mtg-rules/contracts";
import { lookupCardsByExactFaceName } from "./cards/lookup.js";

export interface BuildAppOptions {
  lookupCardsByExactFaceName?: (name: string) => Promise<CardLookupResponse>;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: true });
  const lookupCards = options.lookupCardsByExactFaceName ?? lookupCardsByExactFaceName;

  void app.register(cors, { origin: true });
  app.get("/health", async (_request, reply) =>
    reply.send(healthResponseSchema.parse({ status: "ok", service: "mtg-rules-api" })),
  );
  app.get<{ Querystring: { name?: string | string[] } }>(
    "/api/cards/lookup",
    async (request, reply) => {
      const queryName = request.query.name;
      const name = typeof queryName === "string" ? queryName.trim() : "";
      if (!name || name.length > 200) {
        return reply.code(400).send({ error: "Provide a card face name up to 200 characters." });
      }
      return reply.send(cardLookupResponseSchema.parse(await lookupCards(name)));
    },
  );

  return app;
}
