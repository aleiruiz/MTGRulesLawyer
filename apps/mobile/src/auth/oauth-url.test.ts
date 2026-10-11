import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readOAuthCode } from "./oauth-url";

void describe("OAuth deep-link callback parsing", () => {
  void it("reads the PKCE authorization code from the app callback URL", () => {
    assert.equal(
      readOAuthCode("mtgruleslawyer://auth/callback?code=one-time-code"),
      "one-time-code",
    );
  });

  void it("returns no code when the provider redirects without one", () => {
    assert.equal(readOAuthCode("mtgruleslawyer://auth/callback"), null);
  });

  void it("surfaces provider cancellation or callback errors", () => {
    assert.throws(
      () =>
        readOAuthCode(
          "mtgruleslawyer://auth/callback?error=access_denied&error_description=User%20cancelled",
        ),
      /User cancelled/,
    );
  });
});
