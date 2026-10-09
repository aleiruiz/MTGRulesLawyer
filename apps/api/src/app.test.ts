import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "./app.js";

const app = buildApp();

void after(async () => {
  await app.close();
});

void describe("GET /health", () => {
  void it("returns the typed service health response", async () => {
    const response: LightMyRequestResponse = await app.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok", service: "mtg-rules-api" });
  });
});
