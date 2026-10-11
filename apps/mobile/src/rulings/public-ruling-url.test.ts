import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPublicRulingUrl } from "./public-ruling-url";

void describe("public ruling URLs", () => {
  void it("creates a stable share URL for a deployed web origin", () => {
    assert.equal(
      buildPublicRulingUrl("00000000-0000-4000-8000-000000000001", "https://rules.example/"),
      "https://rules.example/rulings?id=00000000-0000-4000-8000-000000000001",
    );
  });

  void it("encodes the ruling identifier as a URL query value", () => {
    assert.equal(
      buildPublicRulingUrl("ruling id", "https://rules.example"),
      "https://rules.example/rulings?id=ruling%20id",
    );
  });
});
