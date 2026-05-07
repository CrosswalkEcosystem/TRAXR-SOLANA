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
  return {
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : "pumpfun.search_unrestricted.json",
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
  if (res.status === 429 && attempt < 6) {
    const delay = 500 * 2 ** attempt;
    console.warn(`[pumpfun] 429 retry in ${delay}ms`);
    await sleep(delay);
    return fetchPage(url, jwt, attempt + 1);
  }
  const text = await res.text().catch(() => "");
  throw new Error(`HTTP ${res.status}: ${text}`);
}

function buildUrl(term, limit) {
  const url = new URL(BASE_URL);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "market_cap");
  url.searchParams.set("order", "DESC");
  url.searchParams.set("includeNsfw", "false");
  url.searchParams.set("searchTerm", term);
  return url.toString();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) throw new Error("JWT_SECRET is missing");

  const seen = new Set();
  const rows = [];

  for (const ch of opts.chars) {
    const url = buildUrl(ch, opts.limit);
    const data = await fetchPage(url, jwt);
    if (!Array.isArray(data)) {
      console.log(`[pumpfun] ${ch} -> non-array`);
      continue;
    }
    let added = 0;
    for (const row of data) {
      const mint = row?.mint || row?.coinMint;
      if (typeof mint !== "string") continue;
      if (seen.has(mint)) continue;
      seen.add(mint);
      rows.push(row);
      added += 1;
    }
    console.log(`[pumpfun] term=${ch} fetched=${data.length} new=${added} total=${rows.length}`);
    await sleep(opts.sleepMs);
  }

  const outPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(DATA_DIR, opts.output);
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`[pumpfun] wrote ${rows.length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
