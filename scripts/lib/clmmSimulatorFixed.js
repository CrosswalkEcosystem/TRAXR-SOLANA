"use strict";

const BN = require("bn.js");
const { tickToSqrtPriceX64, simulateSwapStep } = require("./clmmMathFixed");

function alignLowerTick(tickIndex, tickSpacing) {
  return Math.floor(tickIndex / tickSpacing) * tickSpacing;
}

function simulateClmmSwap({ amountIn, tokenInIsToken0, pool }) {
  const logs = [];
  let sqrtPrice = new BN(pool.sqrtPriceX64);
  let liquidity = new BN(pool.liquidity);
  let tickIndex = pool.tickCurrent;
  const tickSpacing = pool.tickSpacing;
  const feeRate = new BN(Math.floor(pool.feeRate * 1_000_000));

  let remainingIn = new BN(amountIn);
  let totalOut = new BN(0);
  const ticksCrossed = [];

  const tickMap = pool.tickMap;
  const zeroForOne = tokenInIsToken0;
  const tickStep = zeroForOne ? -tickSpacing : tickSpacing;

  const MIN_TICK = -887272;
  const MAX_TICK = 887272;

  logs.push(`Start tick=${tickIndex}, sqrt=${sqrtPrice.toString()}, feeRate=${feeRate.toString()}`);

  while (remainingIn.gt(new BN(0))) {
    const lowerTick = alignLowerTick(tickIndex, tickSpacing);
    const upperTick = lowerTick + tickSpacing;
    const nextTick = zeroForOne ? lowerTick : upperTick;

    if (nextTick < MIN_TICK || nextTick > MAX_TICK) {
      return {
        amountOut: totalOut,
        finalSqrtPriceX64: sqrtPrice,
        ticksCrossed,
        logs,
      };
    }

    let sqrtPriceTarget = tickToSqrtPriceX64(nextTick);
    if (zeroForOne && sqrtPriceTarget.gte(sqrtPrice)) {
      sqrtPriceTarget = sqrtPrice.sub(new BN(1));
    }
    if (!zeroForOne && sqrtPriceTarget.lte(sqrtPrice)) {
      sqrtPriceTarget = sqrtPrice.add(new BN(1));
    }

    const result = simulateSwapStep({
      amountIn: remainingIn,
      sqrtPrice,
      sqrtPriceTarget,
      liquidity,
      feeRate,
      zeroForOne,
    });

    if (result.usedAmountIn.isZero()) {
      return {
        amountOut: totalOut,
        finalSqrtPriceX64: sqrtPrice,
        ticksCrossed,
        logs,
      };
    }

    remainingIn = remainingIn.sub(result.usedAmountIn);
    totalOut = totalOut.add(result.producedAmountOut);
    const crossedBoundary = result.newSqrtPrice.eq(sqrtPriceTarget);
    sqrtPrice = result.newSqrtPrice;
    if (!crossedBoundary) {
      return {
        amountOut: totalOut,
        finalSqrtPriceX64: sqrtPrice,
        ticksCrossed,
        logs,
      };
    }

    ticksCrossed.push(nextTick);
    tickIndex = zeroForOne ? nextTick - 1 : nextTick;

    const tickData = tickMap.get(nextTick);
    if (tickData?.initialized) {
      const deltaL = new BN(tickData.liquidityNet);
      liquidity = zeroForOne ? liquidity.sub(deltaL) : liquidity.add(deltaL);
    }
  }

  return {
    amountOut: totalOut,
    finalSqrtPriceX64: sqrtPrice,
    ticksCrossed,
    logs,
  };
}

module.exports = {
  simulateClmmSwap,
};
