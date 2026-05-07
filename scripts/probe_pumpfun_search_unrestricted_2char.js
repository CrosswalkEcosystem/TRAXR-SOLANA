#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const BASE_URL = "https://frontend-api-v3.pump.fun/coins/search-unrestricted";

function parseArgs(argv) {
  const outputIndex = argv.indexOf("--output");
  const limitIndex = argv.indexOf("--limit");
  const sleepIndex = argv.indexOf("--sleep-ms");
  const charsIndex = argv.indexOf("--chars");
  const checkpointIndex = argv.indexOf("--checkpoint");
  const maxIndex = argv.indexOf("--max-requests");
  const completeOnly = argv.includes("--complete-only");
  const reset = argv.includes("--reset");
  return {
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : completeOnly
          ? "pumpfun.search_unrestricted.2char.complete.json"
          : "pumpfun.search_unrestricted.2char.json",
    limit:
      limitIndex >= 0 && argv[limitIndex + 1]
        ? Math.max(1, Number(argv[limitIndex + 1]))
        : 200,
    sleepMs:
      sleepIndex >= 0 && argv[sleepIndex + 1]
        ? Math.max(0, Number(argv[sleepIndex + 1]))
        : 250,
    chars:
      charsIndex >= 0 && argv[charsIndex + 1]
        ? argv[charsIndex + 1]
        : "abcdefghijklmnopqrstuvwxyz0123456789",
    checkpoint:
      checkpointIndex >= 0 && argv[checkpointIndex + 1]
        ? argv[checkpointIndex + 1]
        : completeOnly
          ? "pumpfun.search_unrestricted.2char.complete.checkpoint.json"
          : "pumpfun.search_unrestricted.2char.checkpoint.json",
    maxRequests:
      maxIndex >= 0 && argv[maxIndex + 1]
        ? Math.max(1, Number(argv[maxIndex + 1]))
        : null,
    completeOnly,
    reset,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url, jwt, attempt = 0) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
  });
  if (res.ok) return res.json();
  if (res.status === 429 && attempt < 8) {
    const text = await res.text().catch(() => "");
    let retryAfterMs = 0;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.retry_after === "number") {
        retryAfterMs = Math.max(0, parsed.retry_after * 1000);
      }
    } catch {
      retryAfterMs = 0;
    }
    const delay = Math.max(retryAfterMs, 1000 * 2 ** attempt);
    console.warn(`[pumpfun] 429 retry in ${delay}ms`);
    await sleep(delay);
    return fetchPage(url, jwt, attempt + 1);
  }
  const text = await res.text().catch(() => "");
  throw new Error(`HTTP ${res.status}: ${text}`);
}

function buildUrl(term, limit, completeOnly) {
  const url = new URL(BASE_URL);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "market_cap");
  url.searchParams.set("order", "DESC");
  url.searchParams.set("includeNsfw", "false");
  url.searchParams.set("searchTerm", term);
  if (completeOnly) url.searchParams.set("complete", "true");
  return url.toString();
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, filePath);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) throw new Error("JWT_SECRET is missing");

  const outPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(DATA_DIR, opts.output);
  const checkpointPath = path.isAbsolute(opts.checkpoint)
    ? opts.checkpoint
    : path.join(DATA_DIR, opts.checkpoint);

  const existing = opts.reset ? null : readJson(outPath);
  const seen = new Set();
  const rows = [];

  if (Array.isArray(existing)) {
    for (const row of existing) {
      const mint = row?.mint || row?.coinMint;
      if (typeof mint === "string") {
        seen.add(mint);
        rows.push(row);
      }
    }
  }

  const chars = opts.chars.split("");
  const combos = [];
  for (const a of chars) {
    for (const b of chars) {
      combos.push(a + b);
    }
  }

  const checkpoint = readJson(checkpointPath) || {};
  const startIndex = Number.isFinite(checkpoint.index) ? checkpoint.index : 0;
  let requests = 0;

  for (let i = startIndex; i < combos.length; i += 1) {
    if (opts.maxRequests && requests >= opts.maxRequests) break;
    const term = combos[i];
    const url = buildUrl(term, opts.limit, opts.completeOnly);
    const data = await fetchPage(url, jwt);
    if (Array.isArray(data)) {
      let added = 0;
      for (const row of data) {
        const mint = row?.mint || row?.coinMint;
        if (typeof mint !== "string") continue;
        if (seen.has(mint)) continue;
        seen.add(mint);
        rows.push(row);
        added += 1;
      }
      if (i % 50 === 0) {
        console.log(`[pumpfun] term=${term} fetched=${data.length} new=${added} total=${rows.length}`);
      }
    }
    requests += 1;
    if (i % 10 === 0) {
      writeJson(checkpointPath, { index: i + 1, total: combos.length });
      writeJson(outPath, rows);
    }
    await sleep(opts.sleepMs);
  }

  writeJson(checkpointPath, { index: combos.length, total: combos.length });
  writeJson(outPath, rows);
  console.log(`[pumpfun] wrote ${rows.length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
