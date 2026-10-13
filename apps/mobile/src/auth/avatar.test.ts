import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Session } from "@supabase/supabase-js";
import { avatarUrl } from "./avatar";

const withMetadata = (user_metadata: Record<string, unknown>) =>
  ({ user: { user_metadata } }) as unknown as Session;

void describe("avatarUrl", () => {
  void it("reads the provider's picture and ignores anything that is not https", () => {
    assert.equal(avatarUrl(null), null);
    assert.equal(
      avatarUrl(withMetadata({ avatar_url: "https://avatars.githubusercontent.com/u/1" })),
      "https://avatars.githubusercontent.com/u/1",
    );
    assert.equal(
      avatarUrl(withMetadata({ picture: "https://lh3.googleusercontent.com/a/x" })),
      "https://lh3.googleusercontent.com/a/x",
    );
    assert.equal(avatarUrl(withMetadata({ avatar_url: "javascript:alert(1)" })), null);
    assert.equal(avatarUrl(withMetadata({})), null);
  });
});
