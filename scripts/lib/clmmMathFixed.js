"use strict";

const BN = require("bn.js");
const Decimal = require("decimal.js");

const Q64 = new BN(2).pow(new BN(64));
const FEE_DENOMINATOR = new BN(1_000_000);
const DEBUG_STEPS = process.env.DEBUG_CLMM_STEPS === "1";

function tickToSqrtPriceX64(tickIndex) {
  const MIN_TICK = -887272;
  const MAX_TICK = 887272;

  if (tickIndex < MIN_TICK || tickIndex > MAX_TICK) {
    throw new Error(`tickIndex ${tickIndex} out of safe range`);
  }

  const base = new Decimal("1.0001");
  const power = new Decimal(tickIndex).div(2);
  const sqrt = base.pow(power);
  const scaled = sqrt.mul(new Decimal(2).pow(64));
  return new BN(scaled.toFixed(0));
}

function bnMax(a, b) {
  return a.gte(b) ? a : b;
}

function bnMin(a, b) {
  return a.lte(b) ? a : b;
}

function simulateSwapStep({
  amountIn,
  sqrtPrice,
  sqrtPriceTarget,
  liquidity,
  feeRate,
  zeroForOne,
}) {
  const feeMultiplier = FEE_DENOMINATOR.sub(feeRate);
  const amountInAfterFee = amountIn.mul(feeMultiplier).div(FEE_DENOMINATOR);

  if (DEBUG_STEPS) {
    console.log("\n🔬 simulateSwapStep()");
    console.log("zeroForOne:", zeroForOne);
    console.log("amountIn:", amountIn.toString());
    console.log("amountInAfterFee:", amountInAfterFee.toString());
    console.log("sqrtPrice:", sqrtPrice.toString());
    console.log("sqrtPriceTarget:", sqrtPriceTarget.toString());
    console.log("liquidity:", liquidity.toString());
  }

  if (liquidity.isZero() || amountInAfterFee.isZero()) {
    return {
      usedAmountIn: new BN(0),
      producedAmountOut: new BN(0),
      newSqrtPrice: sqrtPrice,
    };
  }

  if (zeroForOne) {
    const deltaSqrt = sqrtPrice.sub(sqrtPriceTarget);
    const maxDx = liquidity.mul(deltaSqrt).mul(Q64).div(sqrtPrice.mul(sqrtPriceTarget));

    if (DEBUG_STEPS) {
      console.log("deltaSqrt:", deltaSqrt.toString());
      console.log("maxDx (BN):", maxDx.toString());
    }

    if (maxDx.isZero()) {
      return {
        usedAmountIn: new BN(0),
        producedAmountOut: new BN(0),
        newSqrtPrice: sqrtPrice,
      };
    }

    if (amountInAfterFee.gte(maxDx)) {
      const amountOut = liquidity.mul(deltaSqrt).div(Q64);
      return {
        usedAmountIn: maxDx,
        producedAmountOut: amountOut,
        newSqrtPrice: sqrtPriceTarget,
      };
    }

    const numerator = liquidity.mul(sqrtPrice).mul(Q64);
    const denominator = liquidity.mul(Q64).add(amountInAfterFee.mul(sqrtPrice));
    const nextSqrt = numerator.div(denominator);
    const boundedNext = bnMax(bnMin(nextSqrt, sqrtPrice), sqrtPriceTarget);
    const amountOut = liquidity.mul(sqrtPrice.sub(boundedNext)).div(Q64);
    return {
      usedAmountIn: amountInAfterFee,
      producedAmountOut: amountOut,
      newSqrtPrice: boundedNext,
    };
  }

  const deltaSqrt = sqrtPriceTarget.sub(sqrtPrice);
  const maxDy = liquidity.mul(deltaSqrt).div(Q64);

  if (DEBUG_STEPS) {
    console.log("deltaSqrt:", deltaSqrt.toString());
    console.log("maxDy (BN):", maxDy.toString());
  }

  if (maxDy.isZero()) {
    return {
      usedAmountIn: new BN(0),
      producedAmountOut: new BN(0),
      newSqrtPrice: sqrtPrice,
    };
  }

  if (amountInAfterFee.gte(maxDy)) {
    const amountOut = liquidity.mul(deltaSqrt).mul(Q64).div(sqrtPriceTarget.mul(sqrtPrice));
    return {
      usedAmountIn: maxDy,
      producedAmountOut: amountOut,
      newSqrtPrice: sqrtPriceTarget,
    };
  }

  const nextSqrt = sqrtPrice.add(amountInAfterFee.mul(Q64).div(liquidity));
  const boundedNext = bnMin(bnMax(nextSqrt, sqrtPrice), sqrtPriceTarget);
  const amountOut = liquidity
    .mul(boundedNext.sub(sqrtPrice))
    .mul(Q64)
    .div(boundedNext.mul(sqrtPrice));
  return {
    usedAmountIn: amountInAfterFee,
    producedAmountOut: amountOut,
    newSqrtPrice: boundedNext,
  };
}

module.exports = {
  Q64,
  tickToSqrtPriceX64,
  simulateSwapStep,
};
