import { NextRequest } from "next/server";
import { sanitizeTokenLogoUrl } from "@/lib/tokenLogo";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 512;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_IMAGE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

const logoCache = new Map<
  string,
  {
    body: Uint8Array;
    contentType: string;
    expiresAt: number;
  }
>();

function pruneExpiredCache(now: number) {
  for (const [key, entry] of logoCache.entries()) {
    if (entry.expiresAt <= now) {
      logoCache.delete(key);
    }
  }
}

function enforceCacheBound() {
  while (logoCache.size > CACHE_MAX_ENTRIES) {
    const oldestKey = logoCache.keys().next().value;
    if (!oldestKey) break;
    logoCache.delete(oldestKey);
  }
}

function imageHeaders(contentType: string) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
  };
}

function getCachedLogo(url: string) {
  const now = Date.now();
  pruneExpiredCache(now);
  const cached = logoCache.get(url);
  if (!cached || cached.expiresAt <= now) {
    if (cached) logoCache.delete(url);
    return null;
  }
  return cached;
}

function normalizeContentType(value: string | null) {
  return (value || "").split(";")[0].trim().toLowerCase();
}

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const srcParam = request.nextUrl.searchParams.get("src");
  const sourceUrl = sanitizeTokenLogoUrl(srcParam);
  if (
    !sourceUrl ||
    sourceUrl.startsWith("/") ||
    sourceUrl.startsWith("data:image/")
  ) {
    return new Response("Invalid logo source", { status: 400 });
  }

  const cached = getCachedLogo(sourceUrl);
  if (cached) {
    return new Response(cached.body.slice(), {
      status: 200,
      headers: imageHeaders(cached.contentType),
    });
  }

  let upstream: Response;
  try {
    upstream = await fetch(sourceUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent": "TRAXR-SOLANA/token-logo-proxy",
      },
      cache: "force-cache",
    });
  } catch {
    return new Response("Upstream logo fetch failed", { status: 502 });
  }

  if (!upstream.ok) {
    return new Response("Logo unavailable", { status: upstream.status });
  }

  const finalUrl = sanitizeTokenLogoUrl(upstream.url);
  if (!finalUrl) {
    return new Response("Upstream redirect blocked", { status: 400 });
  }

  const contentType = normalizeContentType(upstream.headers.get("content-type"));
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    return new Response("Unsupported logo content type", { status: 415 });
  }

  const contentLength = Number.parseInt(
    upstream.headers.get("content-length") || "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
    return new Response("Logo too large", { status: 413 });
  }

  const body = new Uint8Array(await upstream.arrayBuffer());
  if (body.byteLength > MAX_IMAGE_BYTES) {
    return new Response("Logo too large", { status: 413 });
  }

  logoCache.set(finalUrl, {
    body,
    contentType,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  enforceCacheBound();

  return new Response(body.slice(), {
    status: 200,
    headers: imageHeaders(contentType),
  });
}
