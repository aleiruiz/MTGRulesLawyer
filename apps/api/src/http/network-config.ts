import { BlockList, isIP } from "node:net";

const ipv4MappedRange = new BlockList();
ipv4MappedRange.addSubnet("::ffff:0:0", 96, "ipv6");

/** Expo web preview origins allowed when no CORS list is configured outside production. */
export const LOCAL_DEVELOPMENT_ORIGINS = ["http://localhost:8081", "http://127.0.0.1:8081"];

export class NetworkConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkConfigError";
  }
}

/**
 * Reads CORS_ALLOWED_ORIGINS as exact browser origins. Production requires HTTPS origins and
 * defaults to no cross-origin browser access; native apps send no Origin header and are unaffected.
 */
export function readCorsAllowedOrigins(value: string | undefined, production: boolean): string[] {
  const entries = splitList(value);
  if (entries.length === 0) return production ? [] : [...LOCAL_DEVELOPMENT_ORIGINS];
  return entries.map((entry) => {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new NetworkConfigError(`CORS_ALLOWED_ORIGINS has an invalid origin: ${entry}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new NetworkConfigError(`CORS_ALLOWED_ORIGINS must use http or https: ${entry}`);
    }
    if (url.origin !== entry) {
      throw new NetworkConfigError(
        `CORS_ALLOWED_ORIGINS entries must be bare origins without a path or trailing slash: ${entry}`,
      );
    }
    if (production && url.protocol !== "https:") {
      throw new NetworkConfigError(`Production CORS origins must use https: ${entry}`);
    }
    return entry;
  });
}

/**
 * Reads TRUSTED_PROXY_IPS as specific IP addresses or CIDR ranges; anything else fails startup.
 * Ranges broader than /8 (IPv4) or /16 (IPv6) are rejected so the list cannot trust everyone.
 */
export function readTrustedProxies(value: string | undefined): string[] {
  return splitList(value).map((entry) => {
    const [address = "", prefix, extra] = entry.split("/");
    const version = isIP(address);
    // IPv4-mapped IPv6 addresses (::ffff:a.b.c.d or ::ffff:a00:0) are ranges over the 128-bit
    // address, so they need at least /104 to stay as narrow as an IPv4 /8.
    const mapped = version === 6 && ipv4MappedRange.check(address, "ipv6");
    const minPrefix = version === 4 ? 8 : mapped ? 104 : 16;
    const maxPrefix = version === 4 ? 32 : 128;
    const validPrefix =
      prefix === undefined ||
      (/^\d{1,3}$/.test(prefix) && Number(prefix) >= minPrefix && Number(prefix) <= maxPrefix);
    if (version === 0 || address.includes("%") || extra !== undefined || !validPrefix) {
      throw new NetworkConfigError(
        `TRUSTED_PROXY_IPS entries must be IP addresses or CIDR ranges: ${entry}`,
      );
    }
    return entry;
  });
}

function splitList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
