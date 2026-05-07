#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const BN = require("bn.js");
const Decimal = require("decimal.js");
const { Connection, PublicKey } = require("@solana/web3.js");
const { ReadOnlyWallet, Percentage } = require("@orca-so/common-sdk");
const {
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
  UseFallbackTickArray,
} = require("@orca-so/whirlpools-sdk");

const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const DEFAULT_TRADE_USD = 1000;
const DEFAULT_POOL_ID = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
const SNAPSHOT_PATTERN =
  /^orca\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;

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
    tradeUsd: DEFAULT_TRADE_USD,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pool" && argv[i + 1]) {
      opts.poolId = argv[++i];
    } else if (arg === "--snapshot" && argv[i + 1]) {
      opts.snapshot = argv[++i];
    } else if (arg === "--rpc-url" && argv[i + 1]) {
      opts.rpcUrl = argv[++i];
    } else if (arg === "--trade-usd" && argv[i + 1]) {
      const value = Number.parseFloat(String(argv[++i]));
      if (Number.isFinite(value) && value > 0) {
        opts.tradeUsd = value;
      }
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  npm run test:rpc:impact:orca
  npm run test:rpc:impact:orca -- --pool <POOL_ID>
  npm run test:rpc:impact:orca -- --snapshot <FILENAME>
  npm run test:rpc:impact:orca -- --rpc-url <URL>
  npm run test:rpc:impact:orca -- --trade-usd <USD>

Defaults:
  pool:      ${DEFAULT_POOL_ID}
  rpc-url:   ${DEFAULT_RPC_URL}
  trade-usd: ${DEFAULT_TRADE_USD}

This script:
  1. proves rpc-internal auth works
  2. fetches the Orca Whirlpool via the official SDK
  3. requests two exact swap quotes from the SDK
  4. derives price impact vs current spot price

Required env:
  NODEZERO_RPC_KEY
`);
}

function pickLatestOrcaSnapshot(dataDir) {
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
    throw new Error(`No Orca snapshot files found in ${dataDir}`);
  }
  return matches[0].name;
}

function toNumber(value) {
  const n = Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function formatNum(value, digits = 6) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "n/a";
}

function getTokenSymbol(row, side) {
  if (side === "A") {
    return row.tokenA?.symbol || row.tokenASymbol || "TokenA";
  }
  return row.tokenB?.symbol || row.tokenBSymbol || "TokenB";
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
  return new Decimal(amount.toString()).div(decimalPow10(decimals));
}

function computeSpotPrice(row) {
  const price = toNumber(row.price);
  if (price && price > 0) return price;
  const sqrtPrice = toNumber(row.sqrtPrice);
  if (!sqrtPrice || sqrtPrice <= 0) return null;
  return sqrtPrice * sqrtPrice;
}

function deriveTokenUsd(row, spotPrice) {
  const tvlUsd = toNumber(row.tvlUsdc ?? row.tvl);
  const reserveA = toNumber(
    row.tokenBalanceA ?? row.mintAmountA ?? row.reserveA,
  );
  const reserveB = toNumber(
    row.tokenBalanceB ?? row.mintAmountB ?? row.reserveB,
  );
  const decimalsA = Number(
    row.tokenA?.decimals ?? row.decimalsA ?? row.tokenADecimals ?? 6,
  );
  const decimalsB = Number(
    row.tokenB?.decimals ?? row.decimalsB ?? row.tokenBDecimals ?? 6,
  );
  if (
    tvlUsd &&
    tvlUsd > 0 &&
    reserveA &&
    reserveA > 0 &&
    reserveB &&
    reserveB > 0 &&
    spotPrice &&
    spotPrice > 0
  ) {
    const reserveANormalized = reserveA / 10 ** decimalsA;
    const reserveBNormalzed = reserveB / 10 ** decimalsB;
    if (reserveANormalized > 0 && reserveBNormalzed > 0) {
      const denominator = reserveANormalized * spotPrice + reserveBNormalzed;
      if (Number.isFinite(denominator) && denominator > 0) {
        const tokenBUsd = tvlUsd / denominator;
        const tokenAUsd = tokenBUsd * spotPrice;
        return { tokenAUsd, tokenBUsd };
      }
    }
  }
  const priceA = toNumber(row.tokenAUsd);
  const priceB = toNumber(row.tokenBUsd);
  if (priceA && priceA > 0 && (!priceB || priceB <= 0) && spotPrice > 0) {
    return { tokenAUsd: priceA, tokenBUsd: priceA / spotPrice };
  }
  if (priceB && priceB > 0 && (!priceA || priceA <= 0) && spotPrice > 0) {
    return { tokenAUsd: priceB * spotPrice, tokenBUsd: priceB };
  }
  if (priceA && priceA > 0 && priceB && priceB > 0) {
    return { tokenAUsd: priceA, tokenBUsd: priceB };
  }
  if (spotPrice > 0) {
    const symbolA = String(row.tokenA?.symbol || row.tokenASymbol || "").toUpperCase();
    const symbolB = String(row.tokenB?.symbol || row.tokenBSymbol || "").toUpperCase();
    const mintA = String(row.tokenMintA || row.mintA || "");
    const mintB = String(row.tokenMintB || row.mintB || "");
    const isSolA = symbolA === "SOL" || mintA === "So11111111111111111111111111111111111111112";
    const isSolB = symbolB === "SOL" || mintB === "So11111111111111111111111111111111111111112";
    const solUsdGuess = 94;
    if (isSolA) {
      return { tokenAUsd: solUsdGuess, tokenBUsd: solUsdGuess / spotPrice };
    }
    if (isSolB) {
      return { tokenAUsd: solUsdGuess * spotPrice, tokenBUsd: solUsdGuess };
    }
  }
  return {
    tokenAUsd: null,
    tokenBUsd: null,
  };
}

function loadPoolSnapshot(opts) {
  const dataDir = path.resolve(__dirname, "..", "data");
  const snapshotName = opts.snapshot || pickLatestOrcaSnapshot(dataDir);
  const snapshotPath = path.join(dataDir, snapshotName);
  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const row = rows.find(
    (entry) =>
      entry?.id === opts.poolId ||
      entry?.poolId === opts.poolId ||
      entry?.address === opts.poolId,
  );
  if (!row) {
    throw new Error(`Pool ${opts.poolId} not found in ${snapshotName}`);
  }
  return { row, snapshotName };
}

function buildConnection(rpcUrl, apiKey) {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: {
      "x-api-key": apiKey,
    },
  });
}

function buildSdkClient(connection) {
  const wallet = new ReadOnlyWallet(PublicKey.default);
  const ctx = WhirlpoolContext.from(connection, wallet);
  return buildWhirlpoolClient(ctx);
}

function inferTradeInputs(row, tradeUsd, tokenAUsd, tokenBUsd) {
  if (!tokenAUsd || !tokenBUsd) {
    throw new Error("Unable to derive token USD prices from snapshot");
  }
  const decimalsA = Number(
    row.tokenA?.decimals ?? row.decimalsA ?? row.tokenADecimals ?? 6,
  );
  const decimalsB = Number(
    row.tokenB?.decimals ?? row.decimalsB ?? row.tokenBDecimals ?? 6,
  );
  return {
    aToB: {
      mint: new PublicKey(row.tokenMintA || row.mintA),
      amountBn: amountToBn(new Decimal(tradeUsd).div(tokenAUsd), decimalsA),
      decimalsIn: decimalsA,
      decimalsOut: decimalsB,
    },
    bToA: {
      mint: new PublicKey(row.tokenMintB || row.mintB),
      amountBn: amountToBn(new Decimal(tradeUsd).div(tokenBUsd), decimalsB),
      decimalsIn: decimalsB,
      decimalsOut: decimalsA,
    },
  };
}

async function getQuote(pool, inputMint, amountBn, fetcher) {
  return swapQuoteByInputToken(
    pool,
    inputMint,
    amountBn,
    Percentage.fromFraction(1, 1000),
    ORCA_WHIRLPOOL_PROGRAM_ID,
    fetcher,
    undefined,
    UseFallbackTickArray.Always,
  );
}

async function getQuoteSafe(pool, inputMint, amountBn, fetcher) {
  try {
    const quote = await getQuote(pool, inputMint, amountBn, fetcher);
    return { ok: true, quote };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

function summarizeDirection(label, quote, inputDecimals, outputDecimals, spotPrice, invertPrice) {
  const actualOut = bnToDecimal(quote.estimatedAmountOut, outputDecimals);
  const actualIn = bnToDecimal(quote.estimatedAmountIn, inputDecimals);
  const idealOut = invertPrice
    ? actualIn.div(spotPrice)
    : actualIn.mul(spotPrice);
  const impactPct = idealOut.lte(0)
    ? null
    : idealOut.minus(actualOut).abs().div(idealOut).mul(100).toNumber();
  return {
    label,
    actualIn,
    actualOut,
    idealOut,
    impactPct,
    endTick: quote.estimatedEndTickIndex,
    feeAmount: bnToDecimal(quote.estimatedFeeAmount, inputDecimals),
    debug: {
      amount: quote.amount.toString(),
      estimatedAmountIn: quote.estimatedAmountIn.toString(),
      estimatedAmountOut: quote.estimatedAmountOut.toString(),
      estimatedFeeAmount: quote.estimatedFeeAmount.toString(),
      transferInFee:
        quote.transferFee?.deductingFromEstimatedAmountIn?.toString?.() ?? "0",
      transferOutFee:
        quote.transferFee?.deductedFromEstimatedAmountOut?.toString?.() ?? "0",
    },
  };
}

function printDirectionSummary(summary) {
  console.log(`   ${summary.label}`);
  if (!summary.ok) {
    console.log(`     exact:       no`);
    console.log(`     reason:      ${summary.error}`);
    return;
  }
  console.log(`     exact:       yes (official Orca SDK quote)`);
  console.log(`     actual out:  ${formatNum(summary.actualOut.toNumber(), 8)}`);
  console.log(`     ideal out:   ${formatNum(summary.idealOut.toNumber(), 8)}`);
  console.log(`     impact:      ${summary.impactPct != null ? `${formatNum(summary.impactPct, 6)}%` : "n/a"}`);
  console.log(`     end tick:    ${summary.endTick}`);
  console.log(`     fee amount:  ${formatNum(summary.feeAmount.toNumber(), 8)}`);
  console.log(`     raw amount:  ${summary.debug.amount}`);
  console.log(`     raw est in:  ${summary.debug.estimatedAmountIn}`);
  console.log(`     raw est out: ${summary.debug.estimatedAmountOut}`);
  console.log(`     raw fee:     ${summary.debug.estimatedFeeAmount}`);
  console.log(`     xfer in fee: ${summary.debug.transferInFee}`);
  console.log(`     xfer out fee:${summary.debug.transferOutFee}`);
}

async function main() {
  initEnv();
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.NODEZERO_RPC_KEY;
  if (!apiKey) {
    throw new Error("Missing NODEZERO_RPC_KEY in environment");
  }

  const { row, snapshotName } = loadPoolSnapshot(opts);
  const snapshotSpotPrice = computeSpotPrice(row);
  if (!snapshotSpotPrice || snapshotSpotPrice <= 0) {
    throw new Error("Unable to derive Orca spot price from snapshot");
  }
  const { tokenAUsd, tokenBUsd } = deriveTokenUsd(row, snapshotSpotPrice);
  const tradeInputs = inferTradeInputs(row, opts.tradeUsd, tokenAUsd, tokenBUsd);

  console.log("=== NodeZero RPC + Orca Whirlpool Price Impact Test ===");
  console.log(`RPC URL:        ${opts.rpcUrl}`);
  console.log(`Snapshot:       ${snapshotName}`);
  console.log(`Pool ID:        ${opts.poolId}`);
  console.log(`Pair:           ${getTokenSymbol(row, "A")} / ${getTokenSymbol(row, "B")}`);
  console.log(`Pool type:      ${row.poolType || row.type || "whirlpool"}`);
  console.log("");

  const connection = buildConnection(opts.rpcUrl, apiKey);
  const client = buildSdkClient(connection);

  console.log("1. Testing RPC connectivity and Whirlpool account...");
  const version = await connection.getVersion();
  const accountInfo = await connection.getAccountInfo(new PublicKey(opts.poolId), "confirmed");
  console.log(`   RPC version: ${JSON.stringify(version)}`);
  console.log(
    `   Whirlpool:   ${
      accountInfo
        ? `found | owner=${accountInfo.owner.toBase58()} | lamports=${accountInfo.lamports} | dataLen=${accountInfo.data.length}`
        : "missing"
    }`,
  );
  if (!accountInfo) {
    throw new Error(`Whirlpool account ${opts.poolId} not found`);
  }
  console.log("");

  console.log("2. Loading pool with official Orca SDK...");
  const pool = await client.getPool(new PublicKey(opts.poolId));
  const poolData = pool.getData();
  const liveSpotPrice = PriceMath.sqrtPriceX64ToPrice(
    poolData.sqrtPrice,
    tradeInputs.aToB.decimalsIn,
    tradeInputs.aToB.decimalsOut,
  );
  console.log(`   tick spacing: ${poolData.tickSpacing}`);
  console.log(`   current tick: ${poolData.tickCurrentIndex}`);
  console.log(`   liquidity:    ${poolData.liquidity.toString()}`);
  console.log("");

  console.log("3. Requesting exact SDK swap quotes...");
  console.log(`   TVL USD:      ${formatNum(toNumber(row.tvlUsdc ?? row.tvl), 2)}`);
  console.log(`   Snapshot px:  ${formatNum(snapshotSpotPrice, 12)} ${getTokenSymbol(row, "B")} per ${getTokenSymbol(row, "A")}`);
  console.log(`   Live spot px: ${formatNum(liveSpotPrice.toNumber(), 12)} ${getTokenSymbol(row, "B")} per ${getTokenSymbol(row, "A")}`);
  console.log(`   Token A USD:  ${formatNum(tokenAUsd, 8)}`);
  console.log(`   Token B USD:  ${formatNum(tokenBUsd, 8)}`);
  console.log(`   Trade size:   $${formatNum(opts.tradeUsd, 2)}`);

  const [quoteAToBResult, quoteBToAResult] = await Promise.all([
    getQuoteSafe(pool, tradeInputs.aToB.mint, tradeInputs.aToB.amountBn, client.getFetcher()),
    getQuoteSafe(pool, tradeInputs.bToA.mint, tradeInputs.bToA.amountBn, client.getFetcher()),
  ]);

  const summaryAToB = quoteAToBResult.ok
    ? {
        ok: true,
        ...summarizeDirection(
          "tokenA -> tokenB",
          quoteAToBResult.quote,
          tradeInputs.aToB.decimalsIn,
          tradeInputs.aToB.decimalsOut,
          liveSpotPrice,
          false,
        ),
      }
    : {
        ok: false,
        label: "tokenA -> tokenB",
        error: quoteAToBResult.error,
      };
  const summaryBToA = quoteBToAResult.ok
    ? {
        ok: true,
        ...summarizeDirection(
          "tokenB -> tokenA",
          quoteBToAResult.quote,
          tradeInputs.bToA.decimalsIn,
          tradeInputs.bToA.decimalsOut,
          liveSpotPrice,
          true,
        ),
      }
    : {
        ok: false,
        label: "tokenB -> tokenA",
        error: quoteBToAResult.error,
      };
  const impacts = [summaryAToB.impactPct, summaryBToA.impactPct].filter(
    (value) => value != null,
  );
  const worstImpact = impacts.length ? Math.max(...impacts) : null;
  console.log(`   Worst exact:  ${worstImpact != null ? `${formatNum(worstImpact, 6)}%` : "n/a"}`);
  console.log("");
  printDirectionSummary(summaryAToB);
  printDirectionSummary(summaryBToA);
  console.log("");
  console.log("This quote comes from the official Orca Whirlpool SDK over rpc-internal.");
  console.log("If this behaves correctly on thin pools too, we can move it into shared runtime code.");
}

main().catch((error) => {
  console.error("");
  console.error("Test failed:");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
