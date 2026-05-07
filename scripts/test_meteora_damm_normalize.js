#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const {
  normalizeMeteoraDammPool,
} = require("./lib/meteoraDammNormalize");

const DAMM_BASE = "https://damm-v2.datapi.meteora.ag/pools";
const OUTPUT_DIR = path.join(__dirname, "..", "data", "damm-inspect");
const DEFAULT_SAMPLE_SIZE = 5;

function parseArgs(argv) {
  const readValue = (flag) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : null;
  };
  return {
    report: readValue("--report"),
    sampleSize: Number.parseInt(
      readValue("--sample-size") || `${DEFAULT_SAMPLE_SIZE}`,
      10,
    ),
    write: argv.includes("--write"),
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/test_meteora_damm_normalize.js
  node scripts/test_meteora_damm_normalize.js --report data/damm-inspect/<file>.json
  node scripts/test_meteora_damm_normalize.js --sample-size 10 --write

What it does:
  - loads full raw DAMM sample pools from a local inspect report when available
  - otherwise fetches a small live DAMM sample
  - normalizes them into TRAXR-compatible DAMM rows
  - prints shape/field coverage preview
`);
}

function latestInspectReport() {
  if (!fs.existsSync(OUTPUT_DIR)) return null;
  const names = fs
    .readdirSync(OUTPUT_DIR)
    .filter((name) => /^meteora-damm\.inspect_.*\.json$/i.test(name))
    .sort();
  if (!names.length) return null;
  return path.join(OUTPUT_DIR, names[names.length - 1]);
}

function loadReportSamples(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) return null;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const samplePools = Array.isArray(report.samplePools) ? report.samplePools : [];
  const sampleActivePoolsRaw = Array.isArray(report.sampleActivePoolsRaw)
    ? report.sampleActivePoolsRaw
    : [];
  const rawPools = [...samplePools, ...sampleActivePoolsRaw].filter(
    (pool) => pool && typeof pool === "object" && (pool.token_x || pool.token_y),
  );
  if (!rawPools.length) return null;
  return {
    report,
    rawPools,
  };
}

async function fetchLiveSamples(sampleSize) {
  const url = new URL(DAMM_BASE);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", String(sampleSize));
  url.searchParams.set("sort_by", "tvl:desc");
  url.searchParams.set("filter_by", "is_blacklisted=false");

  const res = await fetch(url, {
    headers: {
      Accept: "*/*",
      "User-Agent": "traxr-solana/damm-normalize",
    },
  });
  if (!res.ok) {
    throw new Error(`DAMM API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const pools = Array.isArray(json.data) ? json.data : [];
  return {
    report: {
      scannedAt: new Date().toISOString(),
      source: DAMM_BASE,
    },
    rawPools: pools,
  };
}

function summarizeNormalizedRows(rows) {
  const feeCount = rows.filter((row) => row.feePct !== null).length;
  const priceCount = rows.filter((row) => row.price !== null).length;
  const tvlCount = rows.filter((row) => row.tvl !== null).length;
  const volume24hCount = rows.filter((row) => row.day?.volume !== null).length;
  const mintCount = rows.filter((row) => row.mintA && row.mintB).length;
  const updatedAtCount = rows.filter(
    (row) => typeof row.updatedAt === "string" && row.updatedAt,
  ).length;
  return {
    rows: rows.length,
    feePct: feeCount,
    price: priceCount,
    tvl: tvlCount,
    volume24h: volume24hCount,
    mints: mintCount,
    updatedAt: updatedAtCount,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const opts = parseArgs(args);
  if (!Number.isFinite(opts.sampleSize) || opts.sampleSize <= 0) {
    throw new Error("--sample-size must be a positive integer");
  }

  const reportPath = opts.report || latestInspectReport();
  const local = loadReportSamples(reportPath);
  const source = local || (await fetchLiveSamples(opts.sampleSize));
  const pools = source.rawPools.slice(0, opts.sampleSize);
  const updatedAt =
    (source.report && source.report.scannedAt) || new Date().toISOString();
  const rows = pools.map((pool) =>
    normalizeMeteoraDammPool(pool, { updatedAt }),
  );
  const summary = summarizeNormalizedRows(rows);

  console.log("=== Meteora DAMM Normalize Preview ===");
  console.log(`Input source: ${local ? reportPath : `${DAMM_BASE} (live sample)`}`);
  console.log(`Normalized:   ${summary.rows}`);
  console.log(`price:        ${summary.price}/${summary.rows}`);
  console.log(`tvl:          ${summary.tvl}/${summary.rows}`);
  console.log(`volume24h:    ${summary.volume24h}/${summary.rows}`);
  console.log(`feePct:       ${summary.feePct}/${summary.rows}`);
  console.log(`mints:        ${summary.mints}/${summary.rows}`);
  console.log(`updatedAt:    ${summary.updatedAt}/${summary.rows}`);
  console.log("");
  console.log("Sample rows:");
  for (const row of rows.slice(0, 3)) {
    console.log(JSON.stringify(row, null, 2));
  }

  if (opts.write) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(
      OUTPUT_DIR,
      `meteora-damm.normalized-preview_${new Date()
        .toISOString()
        .replace(/[:.]/g, "")
        .replace("Z", "Z")}.json`,
    );
    fs.writeFileSync(
      outPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          inputSource: local ? reportPath : DAMM_BASE,
          summary,
          rows,
        },
        null,
        2,
      ),
    );
    console.log("");
    console.log(`Wrote preview: ${outPath}`);
  }
}

main().catch((error) => {
  console.error("");
  console.error("DAMM normalize preview failed:");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
