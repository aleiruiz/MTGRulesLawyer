import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { CardLookupResponse, SourceStatusResponse } from "@mtg-rules/contracts";
import type { LightMyRequestResponse } from "fastify";
import { buildApp } from "./app.js";

const app = buildApp({
  getSourceStatus: (): Promise<SourceStatusResponse> =>
    Promise.resolve({
      activeSnapshot: { id: "snapshot-id", version: "rules-test", activatedAt: null },
      staleAfterHours: 72,
      sources: [
        {
          kind: "COMPREHENSIVE_RULES",
          sourceUrl: "https://magic.wizards.com/en/rules",
          sourceVersion: "rules-test",
          checksumSha256: "a".repeat(64),
          importedAt: "2026-10-10T00:00:00.000Z",
          checkedAt: "2026-10-10T00:00:00.000Z",
          lastStatus: "UNCHANGED",
          lastError: null,
          stale: false,
        },
      ],
    }),
  lookupCardsByExactFaceName: (name): Promise<CardLookupResponse> =>
    Promise.resolve(
      name.toLowerCase() === "awakened skyclave"
        ? {
            cards: [
              {
                oracleId: "oracle-id",
                name: "Skyclave Cleric // Skyclave Basilica",
                layout: "modal_dfc",
                matchedFace: {
                  faceIndex: 1,
                  role: "BACK",
                  name: "Skyclave Basilica",
                  manaCost: "",
                  typeLine: "Land",
                  oracleText: "Skyclave Basilica enters the battlefield tapped.",
                  power: null,
                  toughness: null,
                  imageUri: "https://cards.scryfall.io/normal/front/example.jpg",
                },
                faces: [
                  {
                    faceIndex: 0,
                    role: "FRONT",
                    name: "Skyclave Cleric",
                    manaCost: "{2}{W}",
                    typeLine: "Creature — Kor Cleric",
                    oracleText: "When Skyclave Cleric enters, you gain 2 life.",
                    power: "1",
                    toughness: "3",
                    imageUri: "https://cards.scryfall.io/normal/front/example.jpg",
                  },
                  {
                    faceIndex: 1,
                    role: "BACK",
                    name: "Skyclave Basilica",
                    manaCost: "",
                    typeLine: "Land",
                    oracleText: "Skyclave Basilica enters the battlefield tapped.",
                    power: null,
                    toughness: null,
                    imageUri: "https://cards.scryfall.io/normal/back/example.jpg",
                  },
                ],
              },
            ],
          }
        : { cards: [] },
    ),
});

void describe("GET /api/sources/status", () => {
  void it("returns active snapshot metadata and source freshness", async () => {
    const response = await app.inject({ method: "GET", url: "/api/sources/status" });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json<SourceStatusResponse>().sources[0]?.lastStatus, "UNCHANGED");
  });
});

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

void describe("GET /api/cards/lookup", () => {
  void it("matches alternate card faces by exact face name", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/cards/lookup?name=Awakened%20Skyclave",
    });

    assert.equal(response.statusCode, 200);
    const body = response.json<CardLookupResponse>();
    assert.equal(body.cards[0]?.matchedFace.name, "Skyclave Basilica");
    assert.equal(body.cards[0]?.faces.length, 2);
  });

  void it("requires a bounded exact name", async () => {
    const response = await app.inject({ method: "GET", url: "/api/cards/lookup" });
    assert.equal(response.statusCode, 400);
  });

  void it("rejects repeated name query parameters", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/cards/lookup?name=Front&name=Back",
    });
    assert.equal(response.statusCode, 400);
  });
});
