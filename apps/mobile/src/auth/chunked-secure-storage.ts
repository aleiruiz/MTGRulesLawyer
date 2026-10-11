export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const MANIFEST_PREFIX = "secure-chunks:v1:";
const DEFAULT_CHUNK_LENGTH = 1_800;
const MAX_CHUNKS = 64;

function splitEncodedValue(encoded: string, chunkLength: number): string[] {
  if (encoded.length === 0) return [""];
  const chunks: string[] = [];
  let start = 0;

  while (start < encoded.length) {
    let end = Math.min(start + chunkLength, encoded.length);
    while (end < encoded.length && encoded[end - 1] === "%") end -= 1;
    if (end > start + 1 && encoded[end - 2] === "%") end -= 2;
    if (end <= start) throw new Error("Secure storage chunk length is too small");
    chunks.push(encoded.slice(start, end));
    start = end;
  }

  return chunks;
}

/** Stores oversized values as URL-encoded, ASCII chunks in the secure backend. */
export function createChunkedSecureStorage(
  storage: AsyncKeyValueStorage,
  chunkLength = DEFAULT_CHUNK_LENGTH,
): AsyncKeyValueStorage {
  if (!Number.isInteger(chunkLength) || chunkLength < 8) {
    throw new Error("Secure storage chunk length must be an integer of at least 8");
  }

  const chunkKey = (key: string, index: number) => `${key}.chunk.${index}`;

  return {
    async getItem(key) {
      const stored = await storage.getItem(key);
      if (stored === null || !stored.startsWith(MANIFEST_PREFIX)) return stored;

      const count = Number(stored.slice(MANIFEST_PREFIX.length));
      if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) return null;

      const chunks = await Promise.all(
        Array.from({ length: count }, (_, index) => storage.getItem(chunkKey(key, index))),
      );
      if (chunks.some((chunk) => chunk === null)) return null;

      try {
        return decodeURIComponent(chunks.join(""));
      } catch {
        return null;
      }
    },

    async setItem(key, value) {
      const encoded = encodeURIComponent(value);
      const chunks = splitEncodedValue(encoded, chunkLength);
      if (chunks.length > MAX_CHUNKS) {
        throw new Error("Secure storage value exceeds the supported size");
      }

      const previous = await storage.getItem(key);
      let oldCount = 0;
      if (previous?.startsWith(MANIFEST_PREFIX)) {
        const parsed = Number(previous.slice(MANIFEST_PREFIX.length));
        if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_CHUNKS) oldCount = parsed;
      }

      if (encoded.length <= chunkLength) {
        await storage.setItem(key, value);
        await Promise.all(
          Array.from({ length: oldCount }, (_, index) => storage.removeItem(chunkKey(key, index))),
        );
        return;
      }

      try {
        await Promise.all(
          chunks.map((chunk, index) => storage.setItem(chunkKey(key, index), chunk)),
        );
        await storage.setItem(key, `${MANIFEST_PREFIX}${chunks.length}`);
      } catch (error) {
        await Promise.all(chunks.map((_, index) => storage.removeItem(chunkKey(key, index))));
        throw error;
      }

      await Promise.all(
        Array.from({ length: Math.max(0, oldCount - chunks.length) }, (_, offset) =>
          storage.removeItem(chunkKey(key, chunks.length + offset)),
        ),
      );
    },

    async removeItem(key) {
      const stored = await storage.getItem(key);
      let count = 0;
      if (stored?.startsWith(MANIFEST_PREFIX)) {
        const parsed = Number(stored.slice(MANIFEST_PREFIX.length));
        if (Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_CHUNKS) count = parsed;
      }
      await Promise.all([
        storage.removeItem(key),
        ...Array.from({ length: count }, (_, index) => storage.removeItem(chunkKey(key, index))),
      ]);
    },
  };
}
