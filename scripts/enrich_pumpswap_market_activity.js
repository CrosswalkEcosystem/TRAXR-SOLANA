#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const PUMP_ACTIVITY_ENDPOINT = "https://swap-api.pump.fun/v1/coins/market-activity/batch";
const DEXSCREENER_PAIR_ENDPOINT = "https://api.dexscreener.com/latest/dex/pairs/solana";
const SOL_MINT = "So11111111111111111111111111111111111111112";

// tuning
const MAX_CONCURRENCY = 3;
const REQUEST_TIMEOUT = 10000;
const DEXSCREENER_MAX_BATCH = 30;

function parseArgs(argv) {
  const snapshotIndex = argv.indexOf("--snapshot");
  const outputIndex = argv.indexOf("--output");
  const chunkIndex = argv.indexOf("--chunk-size");
  const sleepIndex = argv.indexOf("--sleep-ms");
  const cacheIndex = argv.indexOf("--cache");
  const sourceIndex = argv.indexOf("--source");
  const skipFetch = argv.includes("--no-fetch");

  return {
    snapshot: snapshotIndex >= 0 ? argv[snapshotIndex + 1] : null,
    output: outputIndex >= 0 ? argv[outputIndex + 1] : null,
    chunkSize: chunkIndex >= 0 ? Math.max(1, Number(argv[chunkIndex + 1])) : 10,
    sleepMs: sleepIndex >= 0 ? Math.max(0, Number(argv[sleepIndex + 1])) : 1000,
    cache: cacheIndex >= 0
      ? argv[cacheIndex + 1]
      : path.join(DATA_DIR, "pumpswap.market_activity.json"),
    source:
      sourceIndex >= 0 && argv[sourceIndex + 1]
        ? argv[sourceIndex + 1]
        : "dexscreener",
    skipFetch,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const p = Number.parseFloat(value);
    return Number.isFinite(p) ? p : null;
  }
  return null;
}

function normalizeSnapshotPath(snapshotPath) {
  return path.isAbsolute(snapshotPath)
    ? snapshotPath
    : path.join(__dirname, "..", snapshotPath);
}

function ensureOutputPath(output, snapshotPath) {
  if (output) {
    return path.isAbsolute(output)
      ? output
      : path.join(__dirname, "..", output);
  }
  return snapshotPath.replace(/\.json$/i, ".activity.json");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// Pump's market-activity endpoint is still available as a fallback, but it is
// Cloudflare-gated heavily. DexScreener is the default indexed activity source.
async function fetchBatch(payload, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const res = await fetch(PUMP_ACTIVITY_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://pump.fun",
        accept: "*/*",
        "user-agent": "Mozilla/5.0",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) return res.json();

    if (res.status === 429 && attempt < 5) {
      const delay = 500 * 2 ** attempt;
      console.warn(`[pumpswap] 429 retry in ${delay}ms`);
      await sleep(delay);
      return fetchBatch(payload, attempt + 1);
    }

    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);

  } catch (err) {
    clearTimeout(timeout);

    if (attempt < 5) {
      console.warn(`[pumpswap] retry (${err.name})`);
      await sleep(1000 * (attempt + 1));
      return fetchBatch(payload, attempt + 1);
    }

    throw err;
  }
}

async function fetchDexscreenerPairs(poolIds, attempt = 0) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  const url = `${DEXSCREENER_PAIR_ENDPOINT}/${poolIds.join(",")}`;

  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "traxr-solana/1.0",
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (res.ok) {
      const json = await res.json();
      return Array.isArray(json.pairs) ? json.pairs : json.pair ? [json.pair] : [];
    }

    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      const delay = 750 * 2 ** attempt;
      console.warn(`[pumpswap] dexscreener ${res.status} retry in ${delay}ms`);
      await sleep(delay);
      return fetchDexscreenerPairs(poolIds, attempt + 1);
    }

    const text = await res.text().catch(() => "");
    throw new Error(`DexScreener HTTP ${res.status}: ${text.slice(0, 500)}`);
  } catch (err) {
    clearTimeout(timeout);

    if (attempt < 6) {
      const delay = 1000 * (attempt + 1);
      console.warn(`[pumpswap] dexscreener retry (${err.name}) in ${delay}ms`);
      await sleep(delay);
      return fetchDexscreenerPairs(poolIds, attempt + 1);
    }

    throw err;
  }
}

function chooseMarketMint(row) {
  const mintA = row?.mintA?.address || row?.mintA || null;
  const mintB = row?.mintB?.address || row?.mintB || null;

  if (mintA && mintA !== SOL_MINT) return mintA;
  if (mintB && mintB !== SOL_MINT) return mintB;
  return mintA || mintB;
}

// 🔥 PARALLEL WORKER POOL
async function processChunks(chunks, opts) {
  let results = {};
  let index = 0;

  async function worker(id) {
    while (index < chunks.length) {
      const current = index++;
      const chunk = chunks[current];

      const payload = {
        addresses: chunk,
        intervals: ["24h"],
        metrics: ["numTxs", "volumeUSD"],
      };

      const data = await fetchBatch(payload);
      results = { ...results, ...data };

      if (current % 200 === 0) {
        console.log(`[worker ${id}] progress ${current}/${chunks.length}`);
      }

      await sleep(opts.sleepMs);
    }
  }

  const workers = [];
  for (let i = 0; i < MAX_CONCURRENCY; i++) {
    workers.push(worker(i));
  }

  await Promise.all(workers);
  return results;
}

function dexPairToActivity(pair) {
  const h24Txns = pair?.txns?.h24 || {};
  const buys = toNumber(h24Txns.buys) || 0;
  const sells = toNumber(h24Txns.sells) || 0;
  return {
    "24h": {
      volumeUSD: toNumber(pair?.volume?.h24),
      numTxs: buys + sells,
      numBuys: buys,
      numSells: sells,
      priceChangePercent: toNumber(pair?.priceChange?.h24),
    },
  };
}

async function processDexscreener(rows, opts) {
  const poolIds = Array.from(
    new Set(rows.map((row) => row?.id || row?.poolId || row?.address).filter(Boolean)),
  );
  const chunks = [];

  for (let i = 0; i < poolIds.length; i += DEXSCREENER_MAX_BATCH) {
    chunks.push(poolIds.slice(i, i + DEXSCREENER_MAX_BATCH));
  }

  console.log(`[pumpswap] source=dexscreener pools=${poolIds.length} chunks=${chunks.length}`);

  const resultsByPool = {};
  for (let i = 0; i < chunks.length; i += 1) {
    const pairs = await fetchDexscreenerPairs(chunks[i]);
    for (const pair of pairs) {
      if (!pair?.pairAddress || pair.chainId !== "solana" || pair.dexId !== "pumpswap") {
        continue;
      }
      resultsByPool[pair.pairAddress] = dexPairToActivity(pair);
    }
    if (i % 100 === 0) {
      console.log(`[pumpswap] dexscreener progress ${i}/${chunks.length}`);
    }
    await sleep(opts.sleepMs);
  }

  return resultsByPool;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.snapshot) throw new Error("--snapshot required");

  const snapshotPath = normalizeSnapshotPath(opts.snapshot);
  const outPath = ensureOutputPath(opts.output, snapshotPath);
  const rows = readJson(snapshotPath);

  const uniqueMints = new Set();

  for (const row of rows) {
    const mint = chooseMarketMint(row);
    if (mint) uniqueMints.add(mint);
  }

  let activityResults = {};

  if (!opts.skipFetch) {
    if (opts.source === "dexscreener") {
      activityResults = await processDexscreener(rows, opts);
    } else if (opts.source === "pump") {
      const mints = Array.from(uniqueMints);
      const chunks = [];

      for (let i = 0; i < mints.length; i += opts.chunkSize) {
        chunks.push(mints.slice(i, i + opts.chunkSize));
      }

      console.log(`[pumpswap] source=pump mints=${mints.length} chunks=${chunks.length}`);

      activityResults = await processChunks(chunks, opts);
    } else {
      throw new Error(`Unsupported --source: ${opts.source}`);
    }

    fs.writeFileSync(opts.cache, JSON.stringify({
      source: opts.source,
      results: activityResults,
      fetchedAt: new Date().toISOString()
    }, null, 2));

    console.log("[pumpswap] cache saved");
  } else {
    const cached = readJson(opts.cache);
    activityResults = cached.results || {};
  }

  let updated = 0;

  for (const row of rows) {
    const mint = chooseMarketMint(row);
    const key = opts.source === "dexscreener"
      ? row?.id || row?.poolId || row?.address
      : mint;
    if (!key) continue;

    const entry = activityResults[key]?.["24h"];
    if (!entry) continue;

    row.day = row.day || {};
    row.day.volume = toNumber(entry.volumeUSD);
    row.day.txCount = toNumber(entry.numTxs);

    updated++;
  }

  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));

  console.log(`[pumpswap] updated=${updated}`);
  console.log(`[pumpswap] wrote ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
