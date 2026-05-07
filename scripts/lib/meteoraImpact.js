"use strict";

const BN = require("bn.js");
const Decimal = require("decimal.js");
const { Connection, PublicKey } = require("@solana/web3.js");
const DLMM = require("@meteora-ag/dlmm");

const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const DEFAULT_TRADE_SIZE_USD = 1_000;
const DEFAULT_RPC_TIMEOUT_MS = 15_000;
const DEFAULT_MIN_LIQUIDITY_USD = 1_000;
const DEFAULT_MIN_VOLUME24H_USD = 250;
const DEFAULT_BIN_ARRAY_COUNT = 16;

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value.toString === "function") {
    const parsed = Number.parseFloat(value.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function decimalPow10(exp) {
  return new Decimal(10).pow(exp);
}

function amountToBn(amount, decimals) {
  return new BN(
    new Decimal(amount).mul(decimalPow10(decimals)).floor().toFixed(0),
  );
}

function bnToDecimal(amount, decimals) {
  const asString =
    amount && typeof amount.toString === "function"
      ? amount.toString()
      : String(amount);
  return new Decimal(asString).div(decimalPow10(decimals));
}

function getMeteoraPoolId(pool) {
  return pool?.address || pool?.poolId || pool?.id || null;
}

function deriveMeteoraSnapshotSpotPrice(pool) {
  return toNumber(pool?.raw?.current_price ?? pool?.raw?.price ?? pool?.price);
}

function deriveMeteoraTokenUsd(pool, decimalsX, decimalsY) {
  const tvlUsd = toNumber(
    pool?.raw?.tvl ?? pool?.raw?.liquidity ?? pool?.liquidityUsd ?? pool?.tvl,
  );
  const reserveXUi = toNumber(pool?.raw?.token_x_amount);
  const reserveYUi = toNumber(pool?.raw?.token_y_amount);
  const reserveXRaw = toNumber(pool?.raw?.reserve_x_amount);
  const reserveYRaw = toNumber(pool?.raw?.reserve_y_amount);
  const spotPrice = deriveMeteoraSnapshotSpotPrice(pool);
  if (
    tvlUsd !== null &&
    tvlUsd > 0 &&
    spotPrice !== null &&
    spotPrice > 0
  ) {
    const reserveX =
      reserveXUi !== null && reserveXUi > 0
        ? reserveXUi
        : reserveXRaw !== null && reserveXRaw > 0
          ? reserveXRaw / 10 ** decimalsX
          : null;
    const reserveY =
      reserveYUi !== null && reserveYUi > 0
        ? reserveYUi
        : reserveYRaw !== null && reserveYRaw > 0
          ? reserveYRaw / 10 ** decimalsY
          : null;
    if (
      reserveX === null ||
      reserveX <= 0 ||
      reserveY === null ||
      reserveY <= 0
    ) {
      return { tokenXUsd: null, tokenYUsd: null };
    }
    const denominator = reserveX * spotPrice + reserveY;
    if (Number.isFinite(denominator) && denominator > 0) {
      const tokenYUsd = tvlUsd / denominator;
      const tokenXUsd = tokenYUsd * spotPrice;
      return { tokenXUsd, tokenYUsd };
    }
  }
  return { tokenXUsd: null, tokenYUsd: null };
}

function isViableMeteoraPool(pool, options = {}) {
  const minLiquidityUsd =
    options.minLiquidityUsd ?? DEFAULT_MIN_LIQUIDITY_USD;
  const minVolume24hUsd =
    options.minVolume24hUsd ?? DEFAULT_MIN_VOLUME24H_USD;
  const poolId = getMeteoraPoolId(pool);
  const liquidityUsd = toNumber(pool?.raw?.tvl ?? pool?.raw?.liquidity);
  const volume24hUsd = toNumber(
    pool?.raw?.volume?.["24h"] ??
      pool?.raw?.trade_volume_24h ??
      pool?.raw?.volume?.hour_24,
  );
  const spotPrice = deriveMeteoraSnapshotSpotPrice(pool);
  if (!poolId) return { ok: false, reason: "missing pool id" };
  if (!Number.isFinite(liquidityUsd) || liquidityUsd < minLiquidityUsd) {
    return { ok: false, reason: `liquidity below ${minLiquidityUsd}` };
  }
  if (!Number.isFinite(volume24hUsd) || volume24hUsd < minVolume24hUsd) {
    return { ok: false, reason: `24h volume below ${minVolume24hUsd}` };
  }
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
    return { ok: false, reason: "missing spot price" };
  }
  return { ok: true, reason: null };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function buildMeteoraConnection({
  rpcUrl = DEFAULT_RPC_URL,
  apiKey = process.env.NODEZERO_RPC_KEY,
} = {}) {
  if (!apiKey) throw new Error("Missing NODEZERO_RPC_KEY");
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: {
      "x-api-key": apiKey,
    },
  });
}

async function quoteMeteoraImpact(pool, connection, options = {}) {
  const rpcTimeoutMs = options.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const tradeSizeUsd = options.tradeSizeUsd ?? DEFAULT_TRADE_SIZE_USD;
  const binArrayCount = options.binArrayCount ?? DEFAULT_BIN_ARRAY_COUNT;
  const poolId = getMeteoraPoolId(pool);
  if (!poolId) return { value: null, reason: "missing pool id" };

  try {
    const dlmmPool = await withTimeout(
      DLMM.create(connection, new PublicKey(poolId)),
      rpcTimeoutMs,
    );
    const spotPrice = deriveMeteoraSnapshotSpotPrice(pool);
    const decimalsX = Number(dlmmPool.tokenX.mint.decimals);
    const decimalsY = Number(dlmmPool.tokenY.mint.decimals);
    const { tokenXUsd, tokenYUsd } = deriveMeteoraTokenUsd(
      pool,
      decimalsX,
      decimalsY,
    );
    if (!tokenXUsd || !tokenYUsd) {
      return { value: null, reason: "unable to derive token USD prices" };
    }

    const xToYInRaw = amountToBn(
      new Decimal(tradeSizeUsd).div(tokenXUsd),
      decimalsX,
    );
    const yToXInRaw = amountToBn(
      new Decimal(tradeSizeUsd).div(tokenYUsd),
      decimalsY,
    );

    const [xToYArrays, yToXArrays] = await Promise.all([
      withTimeout(dlmmPool.getBinArrayForSwap(true, binArrayCount), rpcTimeoutMs),
      withTimeout(dlmmPool.getBinArrayForSwap(false, binArrayCount), rpcTimeoutMs),
    ]);

    const [xToYQuote, yToXQuote] = await Promise.allSettled([
      withTimeout(
        dlmmPool.swapQuote(xToYInRaw, true, new BN(1), xToYArrays),
        rpcTimeoutMs,
      ),
      withTimeout(
        dlmmPool.swapQuote(yToXInRaw, false, new BN(1), yToXArrays),
        rpcTimeoutMs,
      ),
    ]);

    const impacts = [];
    const reasons = [];

    if (xToYQuote.status === "fulfilled") {
      const actualIn = bnToDecimal(
        xToYQuote.value.consumedInAmount ?? xToYInRaw,
        decimalsX,
      );
      const actualOut = bnToDecimal(
        xToYQuote.value.outAmount ?? xToYQuote.value.estimatedAmountOut,
        decimalsY,
      );
      const idealOut = actualIn.mul(spotPrice);
      if (idealOut.gt(0)) {
        impacts.push(
          idealOut.minus(actualOut).abs().div(idealOut).mul(100).toNumber(),
        );
      }
    } else {
      reasons.push(
        xToYQuote.reason instanceof Error
          ? xToYQuote.reason.message
          : String(xToYQuote.reason),
      );
    }

    if (yToXQuote.status === "fulfilled") {
      const actualIn = bnToDecimal(
        yToXQuote.value.consumedInAmount ?? yToXInRaw,
        decimalsY,
      );
      const actualOut = bnToDecimal(
        yToXQuote.value.outAmount ?? yToXQuote.value.estimatedAmountOut,
        decimalsX,
      );
      const idealOut = actualIn.div(spotPrice);
      if (idealOut.gt(0)) {
        impacts.push(
          idealOut.minus(actualOut).abs().div(idealOut).mul(100).toNumber(),
        );
      }
    } else {
      reasons.push(
        yToXQuote.reason instanceof Error
          ? yToXQuote.reason.message
          : String(yToXQuote.reason),
      );
    }

    return {
      value: impacts.length ? Math.max(...impacts) : null,
      reason: impacts.length ? null : reasons[0] ?? "no exact quote",
    };
  } catch (error) {
    return {
      value: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  DEFAULT_BIN_ARRAY_COUNT,
  DEFAULT_MIN_LIQUIDITY_USD,
  DEFAULT_MIN_VOLUME24H_USD,
  DEFAULT_RPC_TIMEOUT_MS,
  DEFAULT_TRADE_SIZE_USD,
  buildMeteoraConnection,
  deriveMeteoraSnapshotSpotPrice,
  deriveMeteoraTokenUsd,
  getMeteoraPoolId,
  isViableMeteoraPool,
  quoteMeteoraImpact,
  toNumber,
};
