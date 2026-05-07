#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function parseArgs(argv) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  const pumpswapIndex = argv.indexOf("--pumpswap");
  const ammIndex = argv.indexOf("--amm");
  return {
    input:
      inputIndex >= 0 && argv[inputIndex + 1]
        ? argv[inputIndex + 1]
        : "pumpfun.search_unrestricted.2char.complete.json",
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : "pumpfun.migrated.live.json",
    pumpswap:
      pumpswapIndex >= 0 && argv[pumpswapIndex + 1]
        ? argv[pumpswapIndex + 1]
        : null,
    amm:
      ammIndex >= 0 && argv[ammIndex + 1] ? argv[ammIndex + 1] : null,
  };
}

function resolvePath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(__dirname, "..", p);
}

function latestFile(prefix) {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort();
  return files.length ? path.join(DATA_DIR, files[files.length - 1]) : null;
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function pickPoolFields(pool, source) {
  if (!pool) return {};
  if (source === "pumpswap") {
    return {
      liquidityUsd: toNumber(pool.tvl),
      priceImpactPct: toNumber(pool.priceImpactPct ?? pool.priceImpact),
      price: toNumber(pool.price),
      volume24hUsd: toNumber(pool.day?.volume),
      volume7dUsd: toNumber(pool.week?.volume),
      feePct: toNumber(pool.feeRate),
    };
  }
  // raydium AMM
  return {
    liquidityUsd: toNumber(pool.tvl),
    priceImpactPct: toNumber(pool.priceImpactPct ?? pool.priceImpact),
    price: toNumber(pool.price),
    volume24hUsd: toNumber(pool.day?.volume),
    volume7dUsd: toNumber(pool.week?.volume),
    feePct: toNumber(pool.feeRate),
  };
}

function buildEntry(row, pool, source) {
  const metrics = pickPoolFields(pool, source);
  return {
    type: "pumpfun",
    source,
    mint: row.mint,
    name: row.name ?? "",
    symbol: row.symbol ?? row.ticker ?? "",
    poolAddress: row.pool_address ?? row.raydium_pool ?? null,
    createdAt: row.created_timestamp ?? null,
    complete: row.complete === true,
    marketCap: toNumber(row.usd_market_cap ?? row.market_cap),
    activity: {
      lastTradeTs: row.last_trade_timestamp ?? null,
      txCount24h: null,
      volume24hUsd: metrics.volume24hUsd ?? null,
      volume7dUsd: metrics.volume7dUsd ?? null,
    },
    liquidityUsd: metrics.liquidityUsd ?? null,
    priceImpactPct: metrics.priceImpactPct ?? null,
    price: metrics.price ?? null,
    feePct: metrics.feePct ?? null,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = resolvePath(opts.input);
  const outputPath = resolvePath(opts.output);
  if (!inputPath) throw new Error("input path missing");

  const complete = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  const rows = Array.isArray(complete) ? complete : [];

  const pumpswapPath = resolvePath(opts.pumpswap) || latestFile("pumpswap.live.full_");
  const ammPath = resolvePath(opts.amm) || latestFile("amm.live.json_");

  const pumpswap = pumpswapPath ? JSON.parse(fs.readFileSync(pumpswapPath, "utf8")) : [];
  const amm = ammPath ? JSON.parse(fs.readFileSync(ammPath, "utf8")) : [];

  const pumpswapMap = new Map(pumpswap.map((p) => [p.id, p]));
  const ammMap = new Map(amm.map((p) => [p.id, p]));

  const out = [];
  let mappedPump = 0;
  let mappedAmm = 0;
  let missing = 0;
  for (const row of rows) {
    const poolAddress = row.pool_address ?? row.raydium_pool;
    if (!poolAddress) continue;
    let source = null;
    let pool = pumpswapMap.get(poolAddress);
    if (pool) {
      source = "pumpswap";
      mappedPump += 1;
    } else {
      pool = ammMap.get(poolAddress);
      if (pool) {
        source = "raydium-amm";
        mappedAmm += 1;
      }
    }
    if (!pool || !source) {
      missing += 1;
      continue;
    }
    out.push(buildEntry(row, pool, source));
  }

  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  console.log(
    `[pumpfun] wrote ${out.length} rows to ${outputPath} (pumpswap=${mappedPump} amm=${mappedAmm} missing=${missing})`,
  );
  console.log({ input: inputPath, pumpswapPath, ammPath });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
