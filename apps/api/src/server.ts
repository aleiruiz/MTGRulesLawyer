import "dotenv/config";
import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "./app.js";

const app = buildApp();
const logger: FastifyBaseLogger = app.log;
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  logger.error({ err: error }, "API failed to start");
  process.exitCode = 1;
}
