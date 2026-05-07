#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_OUTPUT = "pumpfun.api.advanced.graduated.json";
const BASE_URL = "https://advanced-api-v2.pump.fun/coins/graduated";

function parseArgs(argv) {
  const outputIndex = argv.indexOf("--output");
  const limitIndex = argv.indexOf("--limit");
  const maxPagesIndex = argv.indexOf("--max-pages");
  const sleepIndex = argv.indexOf("--sleep-ms");
  const onlyNew = argv.includes("--only-new");
  return {
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : DEFAULT_OUTPUT,
    limit:
      limitIndex >= 0 && argv[limitIndex + 1]
        ? Math.max(1, Number(argv[limitIndex + 1]))
        : 50,
    maxPages:
      maxPagesIndex >= 0 && argv[maxPagesIndex + 1]
        ? Math.max(1, Number(argv[maxPagesIndex + 1]))
        : 2000,
    sleepMs:
      sleepIndex >= 0 && argv[sleepIndex + 1]
        ? Math.max(0, Number(argv[sleepIndex + 1]))
        : 250,
    onlyNew,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, payload) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, filePath);
}

async function fetchPage(url, jwt, attempt = 0) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
      Origin: "https://pump.fun",
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) throw new Error("JWT_SECRET is missing");

  const outPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(__dirname, "..", opts.output);

  const existing = opts.onlyNew ? readJsonIfExists(outPath) : null;
  const seen = new Set();
  const rows = [];

  if (existing && Array.isArray(existing)) {
    for (const row of existing) {
      const mint = row?.mint || row?.coinMint;
      if (typeof mint === "string") {
        seen.add(mint);
        rows.push(row);
      }
    }
  }

  let lastScore = null;
  for (let page = 0; page < opts.maxPages; page += 1) {
    const url = new URL(BASE_URL);
    url.searchParams.set("limit", String(opts.limit));
    if (lastScore !== null && Number.isFinite(lastScore)) {
      url.searchParams.set("lastScore", String(lastScore));
    }
    const data = await fetchPage(url.toString(), jwt);
    if (!data || typeof data !== "object") {
      throw new Error("Unexpected response: expected object");
    }
    const coins = Array.isArray(data.coins) ? data.coins : [];
    let added = 0;
    for (const row of coins) {
      const mint = row?.mint || row?.coinMint;
      if (typeof mint !== "string") continue;
      if (seen.has(mint)) continue;
      seen.add(mint);
      rows.push(row);
      added += 1;
    }

    if (page % 10 === 0) {
      console.log(
        `[pumpfun] page=${page} fetched=${coins.length} new=${added} total=${rows.length}`,
      );
    }

    const pagination = data.pagination || {};
    if (!pagination || !pagination.hasMore) {
      console.log("[pumpfun] hasMore=false, stopping");
      break;
    }

    if (typeof pagination.lastScore === "number") {
      lastScore = pagination.lastScore;
    } else if (typeof pagination.lastScore === "string") {
      lastScore = Number(pagination.lastScore);
    } else {
      console.log("[pumpfun] missing lastScore, stopping");
      break;
    }

    if (!coins.length) {
      console.log("[pumpfun] empty page, stopping");
      break;
    }

    await sleep(opts.sleepMs);
  }

  writeJson(outPath, rows);
  console.log(`[pumpfun] wrote ${rows.length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
