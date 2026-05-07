#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_OUTPUT = "pumpfun.api.full.json";
const DEFAULT_URL = "https://frontend-api-v3.pump.fun/coins";

function parseArgs(argv) {
  const outputIndex = argv.indexOf("--output");
  const urlIndex = argv.indexOf("--url");
  const limitIndex = argv.indexOf("--limit");
  const maxPagesIndex = argv.indexOf("--max-pages");
  const sleepIndex = argv.indexOf("--sleep-ms");
  const stopIndex = argv.indexOf("--stop-after-empty");
  const queryIndex = argv.indexOf("--query");
  const offsetStepIndex = argv.indexOf("--offset-step");
  const onlyNew = argv.includes("--only-new");
  return {
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : DEFAULT_OUTPUT,
    url:
      urlIndex >= 0 && argv[urlIndex + 1]
        ? argv[urlIndex + 1]
        : DEFAULT_URL,
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
    stopAfterEmpty:
      stopIndex >= 0 && argv[stopIndex + 1]
        ? Math.max(1, Number(argv[stopIndex + 1]))
        : 5,
    query:
      queryIndex >= 0 && argv[queryIndex + 1] ? argv[queryIndex + 1] : "",
    offsetStep:
      offsetStepIndex >= 0 && argv[offsetStepIndex + 1]
        ? Math.max(1, Number(argv[offsetStepIndex + 1]))
        : null,
    onlyNew,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(base, offset, limit, extraQuery) {
  const url = new URL(base);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  if (extraQuery) {
    const extra = new URLSearchParams(extraQuery);
    for (const [key, value] of extra.entries()) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
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

  const baseOutPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(__dirname, "..", opts.output);
  const existing = opts.onlyNew ? readJsonIfExists(baseOutPath) : null;
  const seen = new Set();
  const rows = [];

  if (existing && Array.isArray(existing)) {
    for (const row of existing) {
      if (row && typeof row.mint === "string") {
        seen.add(row.mint);
        rows.push(row);
      }
    }
  }

  const step = opts.offsetStep ?? opts.limit;
  let offset = 0;
  let emptyStreak = 0;

  for (let page = 0; page < opts.maxPages; page += 1) {
    const url = buildUrl(opts.url, offset, opts.limit, opts.query);
    const data = await fetchPage(url, jwt);
    if (!Array.isArray(data)) {
      throw new Error("Unexpected response: expected array");
    }

    let added = 0;
    for (const row of data) {
      if (!row || typeof row.mint !== "string") continue;
      if (seen.has(row.mint)) continue;
      seen.add(row.mint);
      rows.push(row);
      added += 1;
    }

    if (page % 10 === 0) {
      console.log(
        `[pumpfun] page=${page} offset=${offset} fetched=${data.length} new=${added} total=${rows.length}`,
      );
    }

    if (added === 0) emptyStreak += 1;
    else emptyStreak = 0;

    if (emptyStreak >= opts.stopAfterEmpty) {
      console.log(`[pumpfun] stopping after ${emptyStreak} empty pages`);
      break;
    }

    if (data.length < opts.limit) {
      console.log("[pumpfun] short page, stopping");
      break;
    }

    offset += step;
    await sleep(opts.sleepMs);
  }

  writeJson(baseOutPath, rows);
  console.log(`[pumpfun] wrote ${rows.length} rows to ${baseOutPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
