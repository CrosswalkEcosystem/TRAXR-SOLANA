#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const IMPACT_TRADE_SIZE_USD = 1000;
const DEFAULT_POOL_ID = "7BbZ9gu8ks5yAwRNx7oMc4otpZVunvyJqCS4rywpD7L6";
const SNAPSHOT_PATTERN =
  /^amm\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function initEnv() {
  const root = path.resolve(__dirname, "..");
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, ".env"));
}

function parseArgs(argv) {
  const opts = {
    poolId: DEFAULT_POOL_ID,
    snapshot: null,
    rpcUrl: DEFAULT_RPC_URL,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pool" && argv[i + 1]) {
      opts.poolId = argv[++i];
    } else if (arg === "--snapshot" && argv[i + 1]) {
      opts.snapshot = argv[++i];
    } else if (arg === "--rpc-url" && argv[i + 1]) {
      opts.rpcUrl = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  npm run test:rpc:impact
  npm run test:rpc:impact -- --pool <POOL_ID>
  npm run test:rpc:impact -- --snapshot <FILENAME>
  npm run test:rpc:impact -- --rpc-url <URL>

Defaults:
  pool:     ${DEFAULT_POOL_ID}
  rpc-url:  ${DEFAULT_RPC_URL}

Required env:
  NODEZERO_RPC_KEY
`);
}

function pickLatestAmmSnapshot(dataDir) {
  const matches = fs
    .readdirSync(dataDir)
    .map((name) => {
      const match = name.match(SNAPSHOT_PATTERN);
      if (!match) return null;
      return { name, ts: match[1] };
    })
    .filter(Boolean)
    .sort((a, b) => b.ts.localeCompare(a.ts));

  if (!matches.length) {
    throw new Error(`No AMM snapshot files found in ${dataDir}`);
  }
  return matches[0].name;
}

function toNumber(value) {
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function estimateConstantProductPriceImpactPct({
  reserveA,
  reserveB,
  priceBPerA,
  tvlUsd,
  feePct,
}) {
  if (
    reserveA === null ||
    reserveB === null ||
    priceBPerA === null ||
    tvlUsd === null ||
    reserveA <= 0 ||
    reserveB <= 0 ||
    priceBPerA <= 0 ||
    tvlUsd <= 0
  ) {
    return null;
  }

  const denominator = reserveA * priceBPerA + reserveB;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;

  const priceBUsd = tvlUsd / denominator;
  const priceAUsd = priceBPerA * priceBUsd;
  if (
    !Number.isFinite(priceAUsd) ||
    !Number.isFinite(priceBUsd) ||
    priceAUsd <= 0 ||
    priceBUsd <= 0
  ) {
    return null;
  }

  const feeFraction = Math.max(0, Math.min(0.99, (feePct ?? 0) / 100));

  const simulate = (
    reserveIn,
    reserveOut,
    spotOutPerIn,
    inputTokenUsd,
    direction,
  ) => {
    if (inputTokenUsd <= 0 || spotOutPerIn <= 0) return null;
    const grossIn = IMPACT_TRADE_SIZE_USD / inputTokenUsd;
    if (!Number.isFinite(grossIn) || grossIn <= 0) return null;
    const effectiveIn = grossIn * (1 - feeFraction);
    if (effectiveIn <= 0) return null;
    const idealOut = effectiveIn * spotOutPerIn;
    const actualOut = (reserveOut * effectiveIn) / (reserveIn + effectiveIn);
    if (
      !Number.isFinite(idealOut) ||
      !Number.isFinite(actualOut) ||
      idealOut <= 0 ||
      actualOut <= 0
    ) {
      return null;
    }

    return {
      direction,
      grossIn,
      effectiveIn,
      idealOut,
      actualOut,
      impactPct: Math.max(0, ((idealOut - actualOut) / idealOut) * 100),
      inputTokenUsd,
      spotOutPerIn,
    };
  };

  const aToB = simulate(
    reserveA,
    reserveB,
    priceBPerA,
    priceAUsd,
    "tokenA -> tokenB",
  );
  const bToA = simulate(
    reserveB,
    reserveA,
    1 / priceBPerA,
    priceBUsd,
    "tokenB -> tokenA",
  );

  const details = [aToB, bToA].filter(Boolean);
  if (!details.length) return null;

  const worst = details.reduce((max, item) =>
    item.impactPct > max.impactPct ? item : max,
  );

  return {
    impactPct: worst.impactPct,
    priceAUsd,
    priceBUsd,
    details,
  };
}

async function rpcCall(rpcUrl, apiKey, method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response (${response.status}): ${text}`);
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}: ${JSON.stringify(data)}`,
    );
  }

  if (data.error) {
    throw new Error(
      `RPC ${data.error.code}: ${data.error.message || "unknown error"}`,
    );
  }

  return data.result;
}

function formatNum(value, digits = 6) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "n/a";
}

async function main() {
  initEnv();
  const opts = parseArgs(process.argv.slice(2));

  const apiKey = process.env.NODEZERO_RPC_KEY;
  if (!apiKey) {
    console.error("Missing NODEZERO_RPC_KEY in .env.local or environment.");
    process.exit(1);
  }

  const dataDir = path.resolve(__dirname, "..", "data");
  const snapshotFile = opts.snapshot || pickLatestAmmSnapshot(dataDir);
  const snapshotPath = path.join(dataDir, snapshotFile);
  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const pool = rows.find((row) => row && row.id === opts.poolId);

  if (!pool) {
    console.error(`Pool ${opts.poolId} not found in ${snapshotFile}`);
    process.exit(1);
  }

  console.log("=== NodeZero RPC + Price Impact Test ===");
  console.log(`RPC URL:        ${opts.rpcUrl}`);
  console.log(`Snapshot:       ${snapshotFile}`);
  console.log(`Pool ID:        ${pool.id}`);
  console.log(
    `Pair:           ${pool?.mintA?.symbol || "?"} / ${pool?.mintB?.symbol || "?"}`,
  );
  console.log(`Pool type:      ${pool?.type || pool?.poolType || "unknown"}`);
  console.log("");

  console.log("1. Testing RPC connectivity...");
  const version = await rpcCall(opts.rpcUrl, apiKey, "getVersion", []);
  const accountInfo = await rpcCall(opts.rpcUrl, apiKey, "getAccountInfo", [
    pool.id,
    { encoding: "base64", commitment: "confirmed" },
  ]);
  console.log(`   RPC version: ${JSON.stringify(version)}`);
  console.log(
    `   Account:     ${accountInfo?.value ? "found" : "missing"} | owner=${accountInfo?.value?.owner || "n/a"} | lamports=${accountInfo?.value?.lamports ?? "n/a"}`,
  );
  console.log("");

  console.log("2. Computing snapshot-based AMM price impact...");
  const result = estimateConstantProductPriceImpactPct({
    reserveA: toNumber(pool.mintAmountA),
    reserveB: toNumber(pool.mintAmountB),
    priceBPerA: toNumber(pool.price),
    tvlUsd: toNumber(pool.tvl),
    feePct: toNumber(pool.feeRate) === null ? null : toNumber(pool.feeRate) * 100,
  });

  if (!result) {
    console.error("   Could not compute price impact from snapshot fields.");
    process.exit(2);
  }

  console.log(`   TVL USD:      ${formatNum(toNumber(pool.tvl), 2)}`);
  console.log(`   Reserve A:    ${formatNum(toNumber(pool.mintAmountA), 6)}`);
  console.log(`   Reserve B:    ${formatNum(toNumber(pool.mintAmountB), 6)}`);
  console.log(`   Spot price:   ${formatNum(toNumber(pool.price), 12)} tokenB per tokenA`);
  console.log(`   Token A USD:  ${formatNum(result.priceAUsd, 8)}`);
  console.log(`   Token B USD:  ${formatNum(result.priceBUsd, 8)}`);
  console.log(`   Trade size:   $${IMPACT_TRADE_SIZE_USD.toLocaleString("en-US")}`);
  console.log(`   Worst impact: ${formatNum(result.impactPct, 4)}%`);
  console.log("");

  for (const detail of result.details) {
    console.log(`   ${detail.direction}`);
    console.log(`     gross in:    ${formatNum(detail.grossIn, 8)}`);
    console.log(`     effective:   ${formatNum(detail.effectiveIn, 8)}`);
    console.log(`     ideal out:   ${formatNum(detail.idealOut, 8)}`);
    console.log(`     actual out:  ${formatNum(detail.actualOut, 8)}`);
    console.log(`     impact:      ${formatNum(detail.impactPct, 4)}%`);
  }

  console.log("");
  console.log("This test proves rpc-internal auth works and shows one real AMM impact calculation.");
  console.log(
    "For CLMM / Orca / Meteora, the next step is RPC depth-state simulation via ticks / bins.",
  );
}

main().catch((err) => {
  console.error("");
  console.error("Test failed:");
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
