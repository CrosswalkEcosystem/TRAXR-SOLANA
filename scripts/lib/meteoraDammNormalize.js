"use strict";

const DEFAULT_TRADE_SIZE_USD = 1_000;

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeToken(token) {
  if (!token || typeof token !== "object") return null;
  return {
    address: token.address || null,
    symbol: token.symbol || null,
    name: token.name || null,
    decimals: toNumber(token.decimals),
    logo: token.logo || token.logoURI || token.imageUrl || null,
  };
}

function deriveFeePct(pool) {
  return (
    toNumber(pool?.pool_config?.base_fee_pct) ??
    toNumber(pool?.pool_config?.fee_pct) ??
    toNumber(pool?.base_fee_pct) ??
    toNumber(pool?.base_fee) ??
    toNumber(pool?.fee_pct) ??
    toNumber(pool?.fee)
  );
}

function deriveVolume24h(pool) {
  return (
    toNumber(pool?.volume?.["24h"]) ??
    toNumber(pool?.volume_24h) ??
    toNumber(pool?.volume24h)
  );
}

function deriveVolume7d(pool) {
  return (
    toNumber(pool?.volume?.["7d"]) ??
    toNumber(pool?.volume_7d) ??
    toNumber(pool?.volume7d)
  );
}

function deriveUpdatedAt(pool, fallbackUpdatedAt) {
  const candidates = [
    pool?.updatedAt,
    pool?.updated_at,
    pool?.last_updated_at,
    fallbackUpdatedAt,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return new Date().toISOString();
}

function deriveTokenUsd(pool) {
  const priceX = toNumber(pool?.token_x?.price);
  const priceY = toNumber(pool?.token_y?.price);
  if (priceX && priceY) {
    return { tokenXUsd: priceX, tokenYUsd: priceY };
  }

  const tvlUsd = toNumber(pool?.tvl);
  const reserveX = toNumber(pool?.token_x_amount);
  const reserveY = toNumber(pool?.token_y_amount);
  const spotPrice =
    toNumber(pool?.current_price) ??
    toNumber(pool?.pool_price) ??
    toNumber(pool?.price);
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
    const denominator = reserveX * spotPrice + reserveY;
    if (Number.isFinite(denominator) && denominator > 0) {
      const tokenYUsd = tvlUsd / denominator;
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
  if (!Number.isFinite(effectiveIn) || effectiveIn <= 0) return null;
  const idealOut = effectiveIn * spotOutPerIn;
  if (!Number.isFinite(idealOut) || idealOut <= 0) return null;
  const actualOut = (reserveOut * effectiveIn) / (reserveIn + effectiveIn);
  if (!Number.isFinite(actualOut) || actualOut <= 0) return null;
  return Math.max(0, ((idealOut - actualOut) / idealOut) * 100);
}

function deriveBoundedLiquidity(pool, spotPrice) {
  const reserveX = toNumber(pool?.token_x_amount);
  const reserveY = toNumber(pool?.token_y_amount);
  const minPrice = toNumber(pool?.pool_config?.min_price);
  const maxPrice = toNumber(pool?.pool_config?.max_price);
  if (
    reserveX === null ||
    reserveY === null ||
    reserveX < 0 ||
    reserveY < 0 ||
    spotPrice === null ||
    spotPrice <= 0 ||
    minPrice === null ||
    maxPrice === null ||
    minPrice <= 0 ||
    maxPrice <= 0 ||
    minPrice >= maxPrice
  ) {
    return null;
  }

  const sqrtPrice = Math.sqrt(spotPrice);
  const sqrtMin = Math.sqrt(minPrice);
  const sqrtMax = Math.sqrt(maxPrice);
  if (
    !Number.isFinite(sqrtPrice) ||
    !Number.isFinite(sqrtMin) ||
    !Number.isFinite(sqrtMax) ||
    sqrtPrice <= 0 ||
    sqrtMin <= 0 ||
    sqrtMax <= 0 ||
    sqrtPrice < sqrtMin ||
    sqrtPrice > sqrtMax
  ) {
    return null;
  }

  const candidates = [];
  const denomX = 1 / sqrtPrice - 1 / sqrtMax;
  if (reserveX > 0 && Number.isFinite(denomX) && denomX > 0) {
    candidates.push(reserveX / denomX);
  }
  const denomY = sqrtPrice - sqrtMin;
  if (reserveY > 0 && Number.isFinite(denomY) && denomY > 0) {
    candidates.push(reserveY / denomY);
  }
  const valid = candidates.filter((value) => Number.isFinite(value) && value > 0);
  if (!valid.length) return null;

  const liquidity =
    valid.reduce((sum, value) => sum + value, 0) / valid.length;
  if (!Number.isFinite(liquidity) || liquidity <= 0) return null;

  return {
    liquidity,
    sqrtPrice,
    sqrtMin,
    sqrtMax,
  };
}

function estimateBoundedPriceRangeImpact({
  pool,
  tradeUsd,
  feePct,
  spotPrice,
  tokenXUsd,
  tokenYUsd,
}) {
  const bounded = deriveBoundedLiquidity(pool, spotPrice);
  if (!bounded) return null;

  const feeFraction = Math.max(0, Math.min(0.99, (feePct ?? 0) / 100));
  const impacts = [];

  const simulateXToY = () => {
    if (!tokenXUsd || tokenXUsd <= 0) return null;
    const grossIn = tradeUsd / tokenXUsd;
    const effectiveIn = grossIn * (1 - feeFraction);
    if (!Number.isFinite(effectiveIn) || effectiveIn <= 0) return null;

    const nextInvSqrt = 1 / bounded.sqrtPrice + effectiveIn / bounded.liquidity;
    if (!Number.isFinite(nextInvSqrt) || nextInvSqrt <= 0) return null;
    const nextSqrt = Math.max(1 / nextInvSqrt, bounded.sqrtMin);
    const actualOut = bounded.liquidity * (bounded.sqrtPrice - nextSqrt);
    const idealOut = effectiveIn * spotPrice;
    if (!Number.isFinite(actualOut) || !Number.isFinite(idealOut) || idealOut <= 0) {
      return null;
    }
    return Math.max(0, ((idealOut - actualOut) / idealOut) * 100);
  };

  const simulateYToX = () => {
    if (!tokenYUsd || tokenYUsd <= 0) return null;
    const grossIn = tradeUsd / tokenYUsd;
    const effectiveIn = grossIn * (1 - feeFraction);
    if (!Number.isFinite(effectiveIn) || effectiveIn <= 0) return null;

    const nextSqrt = Math.min(
      bounded.sqrtPrice + effectiveIn / bounded.liquidity,
      bounded.sqrtMax,
    );
    const actualOut =
      bounded.liquidity * (1 / bounded.sqrtPrice - 1 / nextSqrt);
    const idealOut = effectiveIn / spotPrice;
    if (!Number.isFinite(actualOut) || !Number.isFinite(idealOut) || idealOut <= 0) {
      return null;
    }
    return Math.max(0, ((idealOut - actualOut) / idealOut) * 100);
  };

  const xToY = simulateXToY();
  const yToX = simulateYToX();
  if (xToY !== null) impacts.push(xToY);
  if (yToX !== null) impacts.push(yToX);
  if (!impacts.length) return null;
  return Math.max(...impacts);
}

function estimateDammPriceImpact(pool, options = {}) {
  const tradeUsd = options.tradeSizeUsd ?? DEFAULT_TRADE_SIZE_USD;
  const feePct = deriveFeePct(pool);
  const spotPrice =
    toNumber(pool?.current_price) ??
    toNumber(pool?.pool_price) ??
    toNumber(pool?.price);
  const reserveX = toNumber(pool?.token_x_amount);
  const reserveY = toNumber(pool?.token_y_amount);
  const isConcentrated = pool?.pool_config?.concentrated_liquidity === true;
  const { tokenXUsd, tokenYUsd } = deriveTokenUsd(pool);

  if (isConcentrated) {
    const impact = estimateBoundedPriceRangeImpact({
      pool,
      tradeUsd,
      feePct,
      spotPrice,
      tokenXUsd,
      tokenYUsd,
    });
    return {
      value: impact,
      method: impact === null ? "unavailable_concentrated" : "estimated_bounded_cpmm",
    };
  }

  const impactXtoY = estimateConstantProductImpact({
    reserveIn: reserveX,
    reserveOut: reserveY,
    spotOutPerIn: spotPrice,
    inputTokenUsd: tokenXUsd,
    tradeUsd,
    feePct,
  });
  const impactYtoX = estimateConstantProductImpact({
    reserveIn: reserveY,
    reserveOut: reserveX,
    spotOutPerIn: spotPrice ? 1 / spotPrice : null,
    inputTokenUsd: tokenYUsd,
    tradeUsd,
    feePct,
  });
  const impacts = [impactXtoY, impactYtoX].filter(
    (value) => value !== null && Number.isFinite(value),
  );
  return {
    value: impacts.length ? Math.max(...impacts) : null,
    method: impacts.length ? "estimated_constant_product" : "unavailable",
  };
}

function normalizeMeteoraDammPool(pool, options = {}) {
  const tokenA = normalizeToken(pool?.token_x);
  const tokenB = normalizeToken(pool?.token_y);
  const address = pool?.address || pool?.pool_address || null;
  const priceImpact = estimateDammPriceImpact(pool, options);

  return {
    source: "meteora-damm",
    program: "meteora",
    poolType: "damm",
    address,
    name: pool?.name || pool?.pool_name || null,
    mintA: tokenA?.address || null,
    mintB: tokenB?.address || null,
    tokenA,
    tokenB,
    mintA_name: tokenA?.name || null,
    mintA_symbol: tokenA?.symbol || null,
    mintB_name: tokenB?.name || null,
    mintB_symbol: tokenB?.symbol || null,
    price:
      toNumber(pool?.current_price) ??
      toNumber(pool?.pool_price) ??
      toNumber(pool?.price),
    tvl: toNumber(pool?.tvl),
    day: {
      volume: deriveVolume24h(pool),
    },
    week: {
      volume: deriveVolume7d(pool),
    },
    feePct: deriveFeePct(pool),
    priceImpactPct: priceImpact.value,
    priceImpactMethod: priceImpact.method,
    priceImpactTradeUsd: options.tradeSizeUsd ?? DEFAULT_TRADE_SIZE_USD,
    volatilityPct: null,
    updatedAt: deriveUpdatedAt(pool, options.updatedAt),
    raw: pool,
  };
}

module.exports = {
  DEFAULT_TRADE_SIZE_USD,
  estimateDammPriceImpact,
  normalizeMeteoraDammPool,
  toNumber,
};
