import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { buildApp } from "../app.js";
import {
  LOCAL_DEVELOPMENT_ORIGINS,
  NetworkConfigError,
  readCorsAllowedOrigins,
  readTrustedProxies,
} from "./network-config.js";

void describe("CORS origin settings", () => {
  void it("defaults to the local Expo web preview in development and to none in production", () => {
    assert.deepEqual(readCorsAllowedOrigins(undefined, false), LOCAL_DEVELOPMENT_ORIGINS);
    assert.deepEqual(readCorsAllowedOrigins(" ", true), []);
  });

  void it("accepts exact origins and rejects paths, wildcards and plain HTTP in production", () => {
    assert.deepEqual(
      readCorsAllowedOrigins("https://rules.example, https://www.rules.example", true),
      ["https://rules.example", "https://www.rules.example"],
    );
    assert.deepEqual(readCorsAllowedOrigins("http://localhost:8081", false), [
      "http://localhost:8081",
    ]);
    for (const invalid of ["*", "https://rules.example/", "https://rules.example/app", "ftp://x"]) {
      assert.throws(() => readCorsAllowedOrigins(invalid, false), NetworkConfigError);
    }
    assert.throws(() => readCorsAllowedOrigins("http://rules.example", true), NetworkConfigError);
  });
});

void describe("trusted proxy settings", () => {
  void it("accepts specific addresses and CIDR ranges only", () => {
    assert.deepEqual(readTrustedProxies(undefined), []);
    assert.deepEqual(readTrustedProxies("10.0.0.5, 10.0.0.0/24, ::1, fd00::/8"), [
      "10.0.0.5",
      "10.0.0.0/24",
      "::1",
      "fd00::/8",
    ]);
    for (const invalid of ["*", "true", "loopback", "10.0.0.0/0", "10.0.0.0/33", "10.0.0.0/8/1"]) {
      assert.throws(() => readTrustedProxies(invalid), NetworkConfigError);
    }
  });
});

const corsApp = buildApp({ corsAllowedOrigins: ["https://rules.example"] });
const closedApp = buildApp({ corsAllowedOrigins: [] });

void describe("CORS responses", () => {
  void after(async () => {
    await corsApp.close();
    await closedApp.close();
  });

  void it("allows only configured browser origins", async () => {
    const allowed = await corsApp.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://rules.example" },
    });
    assert.equal(allowed.headers["access-control-allow-origin"], "https://rules.example");

    const other = await corsApp.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.example" },
    });
    assert.equal(other.headers["access-control-allow-origin"], undefined);

    const preflight = await corsApp.inject({
      method: "OPTIONS",
      url: "/api/questions/interpret",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });
    assert.equal(preflight.headers["access-control-allow-origin"], undefined);
  });

  void it("serves native clients without an Origin header when no origin is allowed", async () => {
    const native = await closedApp.inject({ method: "GET", url: "/health" });
    assert.equal(native.statusCode, 200);
    const browser = await closedApp.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "http://localhost:8081" },
    });
    assert.equal(browser.headers["access-control-allow-origin"], undefined);
  });
});
