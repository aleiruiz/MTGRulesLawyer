import "dotenv/config";
import { buildApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

let app: ReturnType<typeof buildApp> | undefined;
try {
  app = buildApp();
  await app.listen({ port, host });
} catch (error) {
  // buildApp throws on invalid security settings before the Fastify logger exists.
  if (app) app.log.error({ err: error }, "API failed to start");
  else console.error("API failed to start:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
