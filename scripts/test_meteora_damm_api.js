#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_DIR = path.join(__dirname, "..", "data", "damm-inspect");
const DAMM_BASE = "https://damm-v2.datapi.meteora.ag/pools";
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_SAMPLE_SIZE = 20;
const DEFAULT_DELAY_MS = 120;

function parseArgs(argv) {
  const readValue = (flag) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : null;
  };

  return {
    pages: Number.parseInt(readValue("--pages") || `${DEFAULT_MAX_PAGES}`, 10),
    pageSize: Number.parseInt(
      readValue("--page-size") || `${DEFAULT_PAGE_SIZE}`,
      10,
    ),
    pageStart: Number.parseInt(readValue("--page-start") || "1", 10),
    sampleSize: Number.parseInt(
      readValue("--sample-size") || `${DEFAULT_SAMPLE_SIZE}`,
      10,
    ),
    onlyActive: argv.includes("--only-active"),
    minTvl: Number.parseFloat(readValue("--min-tvl") || "0"),
    minVolume24h: Number.parseFloat(readValue("--min-volume24h") || "0"),
    sortBy: readValue("--sort-by"),
    filterBy: readValue("--filter-by"),
    query: readValue("--query"),
    write:
      argv.includes("--write") ||
      argv.includes("--output") ||
      argv.includes("--save"),
  };
}

function printHelp() {
  console.log(`Usage:
  npm run test:meteora:damm
  npm run test:meteora:damm -- --page-start 1 --pages 5 --page-size 100 --sample-size 30 --sort-by "volume_24h:desc" --filter-by "tvl>1000 && volume_24h>=250" --only-active --min-tvl 1000 --min-volume24h 250 --write

Defaults:
  pages = ${DEFAULT_MAX_PAGES}
  page-size = ${DEFAULT_PAGE_SIZE}
  sample-size = ${DEFAULT_SAMPLE_SIZE}

What it does:
  - queries Meteora DAMM v2 pool API
  - counts total scanned vs active pools
  - prints field inventory from sampled rows
  - prints active sample pools
  - optionally writes a JSON report under data/damm-inspect/
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchDAMMPage(page, limit, opts) {
  const url = new URL(DAMM_BASE);
  url.searchParams.set("page", String(page));
  url.searchParams.set("page_size", String(limit));
  if (opts?.sortBy) url.searchParams.set("sort_by", opts.sortBy);
  if (opts?.filterBy) url.searchParams.set("filter_by", opts.filterBy);
  if (opts?.query) url.searchParams.set("query", opts.query);
  const res = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": "traxr-solana/damm-inspect",
    },
  });

  if (!res.ok) {
    throw new Error(`DAMM API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

function collectFieldPaths(value, prefix = "", target = new Set()) {
  if (Array.isArray(value)) {
    target.add(`${prefix}[]`);
    if (value.length) {
      collectFieldPaths(value[0], `${prefix}[]`, target);
    }
    return target;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const next = prefix ? `${prefix}.${key}` : key;
      target.add(next);
      collectFieldPaths(nested, next, target);
    }
  }
  return target;
}

function summarizePool(pool) {
  const tokenX = pool.token_x ?? pool.tokenX ?? null;
  const tokenY = pool.token_y ?? pool.tokenY ?? null;
  const tokenAUsd = toNumber(pool.token_a_amount_usd ?? pool.token_x_amount_usd);
  const tokenBUsd = toNumber(pool.token_b_amount_usd ?? pool.token_y_amount_usd);
  const volume24h =
    toNumber(pool.volume?.["24h"]) ??
    toNumber(pool.volume_24h) ??
    toNumber(pool.volume24h);
  const feePct =
    toNumber(pool.pool_config?.base_fee_pct) ??
    toNumber(pool.pool_config?.fee_pct) ??
    toNumber(pool.base_fee_pct) ??
    toNumber(pool.base_fee) ??
    toNumber(pool.fee_pct) ??
    toNumber(pool.fee);
  return {
    address: pool.address || pool.pool_address || null,
    name: pool.name || pool.pool_name || null,
    tokenA:
      tokenX?.symbol ||
      pool.token_a_symbol ||
      pool.tokenA?.symbol ||
      pool.tokenA ||
      null,
    tokenB:
      tokenY?.symbol ||
      pool.token_b_symbol ||
      pool.tokenB?.symbol ||
      pool.tokenB ||
      null,
    tvl: toNumber(pool.tvl),
    volume24h,
    reserveUsd: (tokenAUsd || 0) + (tokenBUsd || 0),
    fee: feePct,
    price:
      toNumber(pool.current_price) ??
      toNumber(pool.pool_price) ??
      toNumber(pool.price) ??
      toNumber(pool.current_price),
    poolType: pool.pool_config?.pool_type ?? pool.pool_type,
  };
}

function isActivePool(pool, { minTvl = 0, minVolume24h = 0 } = {}) {
  const tvl = toNumber(pool.tvl) || 0;
  const vol24 =
    toNumber(pool.volume?.["24h"]) ??
    toNumber(pool.volume_24h) ??
    toNumber(pool.volume24h) ??
    0;
  const tokenAAmount =
    toNumber(pool.token_a_amount) ??
    toNumber(pool.token_x_amount) ??
    0;
  const tokenBAmount =
    toNumber(pool.token_b_amount) ??
    toNumber(pool.token_y_amount) ??
    0;
  const tokenAUsd =
    toNumber(pool.token_a_amount_usd) ??
    toNumber(pool.token_x_amount_usd) ??
    0;
  const tokenBUsd =
    toNumber(pool.token_b_amount_usd) ??
    toNumber(pool.token_y_amount_usd) ??
    0;
  const reserveUsd = tokenAUsd + tokenBUsd;

  const hasValue =
    tvl > 0 ||
    vol24 > 0 ||
    tokenAAmount > 0 ||
    tokenBAmount > 0 ||
    reserveUsd > 0;

  if (!hasValue) return false;
  if (tvl < minTvl) return false;
  if (vol24 < minVolume24h) return false;
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const opts = parseArgs(args);
  if (!Number.isFinite(opts.pages) || opts.pages <= 0) {
    throw new Error("--pages must be a positive integer");
  }
  if (!Number.isFinite(opts.pageSize) || opts.pageSize <= 0) {
    throw new Error("--page-size must be a positive integer");
  }
  if (!Number.isFinite(opts.sampleSize) || opts.sampleSize <= 0) {
    throw new Error("--sample-size must be a positive integer");
  }

  console.log("=== Meteora DAMM v2 API Inspect ===");
  console.log(`Base URL:     ${DAMM_BASE}`);
  console.log(`Page start:   ${opts.pageStart}`);
  if (opts.sortBy) console.log(`Sort by:     ${opts.sortBy}`);
  if (opts.filterBy) console.log(`Filter by:   ${opts.filterBy}`);
  if (opts.query) console.log(`Query:       ${opts.query}`);
  console.log(`Pages:        ${opts.pages}`);
  console.log(`Page size:    ${opts.pageSize}`);
  console.log(`Sample size:  ${opts.sampleSize}`);
  console.log(`Only active:  ${opts.onlyActive ? "yes" : "no"}`);
  console.log(`Min TVL:      ${opts.minTvl}`);
  console.log(`Min vol24h:   ${opts.minVolume24h}`);
  console.log("");

  let scanned = 0;
  let active = 0;
  const fieldPaths = new Set();
  const samples = [];
  const activeSamples = [];
  const activeRawSamples = [];
  const missingCounts = new Map();

  for (let offset = 0; offset < opts.pages; offset += 1) {
    const page = opts.pageStart + offset;
    const res = await fetchDAMMPage(page, opts.pageSize, opts);
    const pools = Array.isArray(res.data) ? res.data : [];
    console.log(
      `page=${page + 1} fetched=${pools.length} total=${res.total ?? "n/a"} pages=${res.pages ?? "n/a"}`,
    );

    if (!pools.length) break;

    for (const pool of pools) {
      scanned += 1;
      collectFieldPaths(pool, "", fieldPaths);

      const address = pool.pool_address || pool.address || null;
      if (!address) {
        missingCounts.set(
          "missing pool address",
          (missingCounts.get("missing pool address") || 0) + 1,
        );
      }

      const tvl = toNumber(pool.tvl);
      const vol24 =
        toNumber(pool.volume?.["24h"]) ??
        toNumber(pool.volume_24h) ??
        toNumber(pool.volume24h);
      const price =
        toNumber(pool.current_price) ??
        toNumber(pool.pool_price) ??
        toNumber(pool.price) ??
        toNumber(pool.current_price);
      const fee =
        toNumber(pool.pool_config?.base_fee_pct) ??
        toNumber(pool.pool_config?.fee_pct) ??
        toNumber(pool.base_fee_pct) ??
        toNumber(pool.base_fee) ??
        toNumber(pool.fee_pct) ??
        toNumber(pool.fee);

      if (tvl === null) {
        missingCounts.set("missing tvl", (missingCounts.get("missing tvl") || 0) + 1);
      }
      if (vol24 === null) {
        missingCounts.set(
          "missing volume24h",
          (missingCounts.get("missing volume24h") || 0) + 1,
        );
      }
      if (price === null) {
        missingCounts.set("missing price", (missingCounts.get("missing price") || 0) + 1);
      }
      if (fee === null) {
        missingCounts.set("missing fee", (missingCounts.get("missing fee") || 0) + 1);
      }

      if (samples.length < opts.sampleSize) {
        samples.push(pool);
      }

      if (isActivePool(pool, opts)) {
        active += 1;
        if (activeSamples.length < opts.sampleSize) {
          activeSamples.push(summarizePool(pool));
        }
        if (activeRawSamples.length < opts.sampleSize) {
          activeRawSamples.push(pool);
        }
      }
    }

    if (page + 1 < opts.pages) {
      await sleep(DEFAULT_DELAY_MS);
    }
  }

  const report = {
    scannedAt: new Date().toISOString(),
    source: DAMM_BASE,
    scannedPools: scanned,
    activePools: active,
    activeRatio: scanned === 0 ? 0 : active / scanned,
    fieldPaths: [...fieldPaths].sort(),
    missingCounts: Object.fromEntries([...missingCounts.entries()].sort()),
    samplePools: opts.onlyActive ? [] : samples,
    sampleActivePools: activeSamples,
    sampleActivePoolsRaw: activeRawSamples,
  };

  console.log("");
  console.log("Summary");
  console.log(`- scanned pools: ${report.scannedPools}`);
  console.log(`- active pools: ${report.activePools}`);
  console.log(`- active ratio: ${report.activeRatio.toFixed(4)}`);
  console.log(`- discovered fields: ${report.fieldPaths.length}`);

  if (missingCounts.size) {
    console.log("Missing-field counts:");
    for (const [key, count] of [...missingCounts.entries()].sort()) {
      console.log(`- ${key}: ${count}`);
    }
  }

  console.log("");
  console.log("Active sample pools:");
  for (const sample of activeSamples.slice(0, 10)) {
    console.log(`- ${sample.address} :: ${sample.tokenA}/${sample.tokenB} :: tvl=${sample.tvl} :: vol24=${sample.volume24h} :: fee=${sample.fee} :: price=${sample.price}`);
  }

  if (opts.write) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(
      OUTPUT_DIR,
      `meteora-damm.inspect_${new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z")}.json`,
    );
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log("");
    console.log(`Wrote report: ${outPath}`);
  }
}

main().catch((error) => {
  console.error("");
  console.error("DAMM inspect failed:");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
