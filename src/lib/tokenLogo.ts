const ALLOWED_TOKEN_LOGO_HOSTS = new Set([
  "coin-images.coingecko.com",
  "assets.coingecko.com",
  "img-v1.raydium.io",
  "static.jup.ag",
  "raw.githubusercontent.com",
  "cdn.jsdelivr.net",
  "ipfs.io",
  "cf-ipfs.com",
  "gateway.irys.xyz",
  "gateway.lighthouse.storage",
  "arweave.net",
  "metadata.rapidlaunch.io",
  "axiomtrading.sfo3.cdn.digitaloceanspaces.com",
  "media.pump.fun",
  "solana.traxr.pro",
]);

export function sanitizeTokenLogoUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("data:image/")) return raw;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    const hostname = url.hostname.toLowerCase();
    if (
      ALLOWED_TOKEN_LOGO_HOSTS.has(hostname) ||
      hostname === "traxr.pro" ||
      hostname.endsWith(".traxr.pro")
    ) {
      return raw;
    }
  } catch {
    return null;
  }

  return null;
}

export function getTokenLogoDisplaySrc(value: string | null | undefined) {
  const sanitized = sanitizeTokenLogoUrl(value);
  if (!sanitized) return null;
  if (sanitized.startsWith("/") || sanitized.startsWith("data:image/")) {
    return sanitized;
  }
  return `/api/token-logo?src=${encodeURIComponent(sanitized)}`;
}
