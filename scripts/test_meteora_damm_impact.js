#!/usr/bin/env node
"use strict";

const Decimal = require("decimal.js");

const DAMM_BASE = "https://damm-v2.datapi.meteora.ag/pools";
const DEFAULT_TRADE_USD = 1_000;

function parseArgs(argv) {
  const readValue = (flag) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : null;
  };
  return {
    pool: readValue("--pool"),
    tradeUsd: Number.parseFloat(readValue("--trade-usd") || `${DEFAULT_TRADE_USD}`),
  };
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function fetchPoolUrl({ pool }) {
  const url = new URL(DAMM_BASE);
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", "1");
  if (pool) {
    url.searchParams.set("filter_by", `pool_address=${pool}`);
  } else {
    url.searchParams.set("sort_by", "tvl:desc");
    url.searchParams.set("filter_by", "is_blacklisted=false");
  }
  return url;
}

async function fetchPool(poolId) {
  const url = fetchPoolUrl({ pool: poolId });
  const res = await fetch(url.toString(), {
    headers: {
      Accept: "*/*",
      "User-Agent": "traxr-solana/damm-impact",
    },
  });
  if (!res.ok) {
    throw new Error(`DAMM API ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  const pool = Array.isArray(json.data) ? json.data[0] : null;
  if (!pool) {
    throw new Error(poolId ? `Pool not found: ${poolId}` : "No pools returned");
  }
  return pool;
}

function deriveTokenUsd(pool) {
  const priceX = toNumber(pool.token_x?.price);
  const priceY = toNumber(pool.token_y?.price);
  if (priceX && priceY) {
    return { tokenXUsd: priceX, tokenYUsd: priceY };
  }

  const tvlUsd = toNumber(pool.tvl);
  const reserveX = toNumber(pool.token_x_amount);
  const reserveY = toNumber(pool.token_y_amount);
  const spotPrice = toNumber(pool.current_price ?? pool.pool_price);
  if (
    tvlUsd !== null &&
    tvlUsd > 0 &&
    reserveX !== null &&
    reserveX > 0 &&
    reserveY !== null &&
    reserveY > 0 &&
    spotPrice !== null &&
    spotPrice > 0
  ) {
    const denom = reserveX * spotPrice + reserveY;
    if (Number.isFinite(denom) && denom > 0) {
      const tokenYUsd = tvlUsd / denom;
      const tokenXUsd = tokenYUsd * spotPrice;
      return { tokenXUsd, tokenYUsd };
    }
  }

  return { tokenXUsd: null, tokenYUsd: null };
}

function estimateConstantProductImpact({
  reserveIn,
  reserveOut,
  spotOutPerIn,
  inputTokenUsd,
  tradeUsd,
  feePct,
}) {
  if (
    reserveIn === null ||
    reserveOut === null ||
    spotOutPerIn === null ||
    inputTokenUsd === null
  ) {
    return null;
  }
  if (
    reserveIn <= 0 ||
    reserveOut <= 0 ||
    spotOutPerIn <= 0 ||
    inputTokenUsd <= 0
  ) {
    return null;
  }
  const feeFraction = Math.max(0, Math.min(0.99, (feePct ?? 0) / 100));
  const grossIn = tradeUsd / inputTokenUsd;
  if (!Number.isFinite(grossIn) || grossIn <= 0) return null;
  const effectiveIn = grossIn * (1 - feeFraction);
  if (effectiveIn <= 0) return null;
  const idealOut = effectiveIn * spotOutPerIn;
  if (!Number.isFinite(idealOut) || idealOut <= 0) return null;
  const actualOut = (reserveOut * effectiveIn) / (reserveIn + effectiveIn);
  if (!Number.isFinite(actualOut) || actualOut <= 0) return null;
  return Math.max(0, ((idealOut - actualOut) / idealOut) * 100);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(opts.tradeUsd) || opts.tradeUsd <= 0) {
    throw new Error("--trade-usd must be a positive number");
  }

  const pool = await fetchPool(opts.pool);
  const spotPrice = toNumber(pool.current_price ?? pool.pool_price);
  const reserveX = toNumber(pool.token_x_amount);
  const reserveY = toNumber(pool.token_y_amount);
  const isConcentrated = pool.pool_config?.concentrated_liquidity === true;
  const feePct =
    toNumber(pool.pool_config?.base_fee_pct) ??
    toNumber(pool.base_fee_pct) ??
    toNumber(pool.base_fee) ??
    toNumber(pool.fee_pct) ??
    toNumber(pool.fee);

  const { tokenXUsd, tokenYUsd } = deriveTokenUsd(pool);
  const impactXtoY = isConcentrated
    ? null
    : estimateConstantProductImpact({
        reserveIn: reserveX,
        reserveOut: reserveY,
        spotOutPerIn: spotPrice,
        inputTokenUsd: tokenXUsd,
        tradeUsd: opts.tradeUsd,
        feePct,
      });
  const impactYtoX = isConcentrated
    ? null
    : estimateConstantProductImpact({
        reserveIn: reserveY,
        reserveOut: reserveX,
        spotOutPerIn: spotPrice ? 1 / spotPrice : null,
        inputTokenUsd: tokenYUsd,
        tradeUsd: opts.tradeUsd,
        feePct,
      });

  const impacts = [impactXtoY, impactYtoX].filter(
    (value) => value !== null && Number.isFinite(value),
  );
  const worst = impacts.length ? Math.max(...impacts) : null;

  console.log("=== Meteora DAMM v2 Local Impact Test ===");
  console.log(`Pool:         ${pool.address || pool.pool_address}`);
  console.log(`Name:         ${pool.name || pool.pool_name}`);
  console.log(`Token X:      ${pool.token_x?.symbol || pool.token_x_symbol}`);
  console.log(`Token Y:      ${pool.token_y?.symbol || pool.token_y_symbol}`);
  console.log(`TVL:          ${pool.tvl}`);
  console.log(`Volume 24h:   ${pool.volume?.["24h"] ?? pool.volume_24h ?? pool.volume24h}`);
  console.log(`Fee pct:      ${feePct}`);
  console.log(`Spot price:   ${spotPrice}`);
  console.log(`Reserves:     X=${reserveX} | Y=${reserveY}`);
  console.log(`Token USD:    X=${tokenXUsd} | Y=${tokenYUsd}`);
  console.log(`Trade size:   $${opts.tradeUsd}`);
  console.log(`Concentrated: ${isConcentrated ? "yes" : "no"}`);
  if (isConcentrated) {
    console.log("");
    console.log("Impact model: not computed (pool is concentrated; constant-product estimate would be wrong).");
    return;
  }
  console.log("");
  console.log(`Impact X->Y:  ${impactXtoY === null ? "n/a" : impactXtoY.toFixed(6) + "%"}`);
  console.log(`Impact Y->X:  ${impactYtoX === null ? "n/a" : impactYtoX.toFixed(6) + "%"}`);
  console.log(`Worst impact: ${worst === null ? "n/a" : worst.toFixed(6) + "%"}`);
}

main().catch((error) => {
  console.error("");
  console.error("DAMM impact test failed:");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
