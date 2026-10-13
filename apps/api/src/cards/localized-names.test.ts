import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localizedNamesFromPrinting } from "./localized-names.js";

const spanish = new Set(["es"]);

void describe("localized card names from Scryfall printings", () => {
  void it("reads the printed name of a single-faced card", () => {
    assert.deepEqual(
      localizedNamesFromPrinting(
        {
          lang: "es",
          oracle_id: "elves",
          name: "Llanowar Elves",
          printed_name: "Elfos de Llanowar",
        },
        spanish,
      ),
      [{ oracleId: "elves", faceIndex: 0, language: "es", name: "Elfos de Llanowar" }],
    );
  });

  void it("reads each face of a multi-faced card in Oracle face order", () => {
    assert.deepEqual(
      localizedNamesFromPrinting(
        {
          lang: "es",
          oracle_id: "fire-ice",
          name: "Fire // Ice",
          printed_name: "Fuego // Hielo",
          card_faces: [
            { name: "Fire", printed_name: "Fuego" },
            { name: "Ice", printed_name: "Hielo" },
          ],
        },
        spanish,
      ),
      [
        { oracleId: "fire-ice", faceIndex: 0, language: "es", name: "Fuego" },
        { oracleId: "fire-ice", faceIndex: 1, language: "es", name: "Hielo" },
      ],
    );
  });

  void it("uses face Oracle IDs when the card has none of its own", () => {
    assert.deepEqual(
      localizedNamesFromPrinting(
        {
          lang: "es",
          card_faces: [{ oracle_id: "face-oracle", name: "Front", printed_name: "Frente" }],
        },
        spanish,
      ),
      [{ oracleId: "face-oracle", faceIndex: 0, language: "es", name: "Frente" }],
    );
  });

  void it("skips other languages, English printings and names equal to the English one", () => {
    assert.deepEqual(
      localizedNamesFromPrinting({ lang: "de", oracle_id: "x", printed_name: "Elfen" }, spanish),
      [],
    );
    assert.deepEqual(
      localizedNamesFromPrinting({ lang: "en", oracle_id: "x", name: "Opt" }, spanish),
      [],
    );
    assert.deepEqual(
      localizedNamesFromPrinting(
        { lang: "es", oracle_id: "x", name: "Opt", printed_name: "opt" },
        spanish,
      ),
      [],
    );
    assert.deepEqual(localizedNamesFromPrinting("not a card", spanish), []);
    assert.deepEqual(
      localizedNamesFromPrinting({ lang: "es", printed_name: "Sin Oracle" }, spanish),
      [],
    );
  });
});
