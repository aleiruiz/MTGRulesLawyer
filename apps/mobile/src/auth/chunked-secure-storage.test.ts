import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChunkedSecureStorage, type AsyncKeyValueStorage } from "./chunked-secure-storage";

function createMemoryStorage(): AsyncKeyValueStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key) {
      return Promise.resolve(values.get(key) ?? null);
    },
    setItem(key, value) {
      values.set(key, value);
      return Promise.resolve();
    },
    removeItem(key) {
      values.delete(key);
      return Promise.resolve();
    },
  };
}

void describe("chunked secure storage", () => {
  void it("round trips large multibyte session values using bounded secure entries", async () => {
    const backend = createMemoryStorage();
    const storage = createChunkedSecureStorage(backend);
    const session = JSON.stringify({
      access_token: "access-".repeat(600),
      refresh_token: "refresh-".repeat(300),
      user: { identities: [{ identity_data: { display_name: "Jace, the Mind Sculptor 🧠" } }] },
    });

    await storage.setItem("auth-session", session);

    assert.equal(await storage.getItem("auth-session"), session);
    assert.ok(
      [...backend.values.entries()]
        .filter(([key]) => key !== "auth-session")
        .every(([, value]) => Buffer.byteLength(value, "utf8") <= 1_800),
    );
  });

  void it("reads legacy values and removes chunks after a smaller replacement", async () => {
    const backend = createMemoryStorage();
    const storage = createChunkedSecureStorage(backend);
    await backend.setItem("auth-session", "legacy-session");
    assert.equal(await storage.getItem("auth-session"), "legacy-session");

    await storage.setItem("auth-session", "x".repeat(4_000));
    await storage.setItem("auth-session", "small-session");
    assert.equal(await storage.getItem("auth-session"), "small-session");
    assert.equal(
      [...backend.values.keys()].some((key) => key.includes(".chunk.")),
      false,
    );
  });

  void it("removes both the manifest and its chunks", async () => {
    const backend = createMemoryStorage();
    const storage = createChunkedSecureStorage(backend);
    await storage.setItem("auth-session", "x".repeat(4_000));
    await storage.removeItem("auth-session");
    assert.equal(backend.values.size, 0);
  });
});
