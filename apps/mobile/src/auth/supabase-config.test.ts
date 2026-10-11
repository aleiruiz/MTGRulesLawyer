import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasSupabaseClientConfig,
  SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY,
  SUPABASE_PLACEHOLDER_URL,
} from "./supabase-config";

void describe("Supabase client configuration", () => {
  void it("keeps sample placeholders from enabling OAuth requests", () => {
    assert.equal(
      hasSupabaseClientConfig(SUPABASE_PLACEHOLDER_URL, SUPABASE_PLACEHOLDER_PUBLISHABLE_KEY),
      false,
    );
  });

  void it("enables OAuth when a project URL and publishable key are supplied", () => {
    assert.equal(
      hasSupabaseClientConfig("https://rules-lawyer.supabase.co", "sb_publishable_local-test"),
      true,
    );
  });
});
