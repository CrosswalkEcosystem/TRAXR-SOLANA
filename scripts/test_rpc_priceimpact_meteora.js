#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const BN = require("bn.js");
const Decimal = require("decimal.js");
const { Connection, PublicKey } = require("@solana/web3.js");
const DLMM = require("@meteora-ag/dlmm");

const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const DEFAULT_TRADE_USD = 1000;
const DEFAULT_POOL_ID = "BGm1tav58oGcsQJehL9WXBFXF7D27vZsKefj4xJKD5Y";
const DEFAULT_BIN_ARRAY_COUNT = 16;
const SNAPSHOT_PATTERN =
  /^meteora\.dlmm\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;

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
    binArrayCount: DEFAULT_BIN_ARRAY_COUNT,
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
      if (Number.isFinite(value) && value > 0) opts.tradeUsd = value;
    } else if (arg === "--bin-array-count" && argv[i + 1]) {
      const value = Number.parseInt(String(argv[++i]), 10);
      if (Number.isInteger(value) && value > 0) opts.binArrayCount = value;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  npm run test:rpc:impact:meteora
  npm run test:rpc:impact:meteora -- --pool <POOL_ID>
  npm run test:rpc:impact:meteora -- --snapshot <FILENAME>
  npm run test:rpc:impact:meteora -- --rpc-url <URL>
  npm run test:rpc:impact:meteora -- --trade-usd <USD>

Defaults:
  pool:      ${DEFAULT_POOL_ID}
  rpc-url:   ${DEFAULT_RPC_URL}
  trade-usd: ${DEFAULT_TRADE_USD}
  bin-array-count: ${DEFAULT_BIN_ARRAY_COUNT}

Required env:
  NODEZERO_RPC_KEY
`);
}

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

function formatNum(value, digits = 6) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "n/a";
}

function pickLatestSnapshot(dataDir) {
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
    throw new Error(`No Meteora snapshot files found in ${dataDir}`);
  }
  return matches[0].name;
}

function loadPoolSnapshot(opts) {
  const dataDir = path.resolve(__dirname, "..", "data");
  const snapshotName = opts.snapshot || pickLatestSnapshot(dataDir);
  const snapshotPath = path.join(dataDir, snapshotName);
  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const row = rows.find(
    (entry) =>
      entry?.address === opts.poolId ||
      entry?.poolId === opts.poolId ||
      entry?.id === opts.poolId,
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

function deriveSnapshotSpotPrice(row) {
  return toNumber(row.raw?.current_price ?? row.raw?.price ?? row.price);
}

function deriveTokenUsd(row, spotPrice, decimalsX, decimalsY) {
  const tvlUsd = toNumber(
    row.raw?.tvl ?? row.raw?.liquidity ?? row.liquidityUsd ?? row.tvl,
  );
  const reserveXUi = toNumber(row.raw?.token_x_amount);
  const reserveYUi = toNumber(row.raw?.token_y_amount);
  const reserveXRaw = toNumber(row.raw?.reserve_x_amount);
  const reserveYRaw = toNumber(row.raw?.reserve_y_amount);
  if (
    tvlUsd &&
    tvlUsd > 0 &&
    spotPrice &&
    spotPrice > 0
  ) {
    const reserveX =
      reserveXUi && reserveXUi > 0
        ? reserveXUi
        : reserveXRaw && reserveXRaw > 0
          ? reserveXRaw / 10 ** decimalsX
          : null;
    const reserveY =
      reserveYUi && reserveYUi > 0
        ? reserveYUi
        : reserveYRaw && reserveYRaw > 0
          ? reserveYRaw / 10 ** decimalsY
          : null;
    if (!reserveX || !reserveY) {
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

function deriveDirectionInputs(tradeUsd, tokenXUsd, tokenYUsd, decimalsX, decimalsY) {
  if (!tokenXUsd || !tokenYUsd) {
    throw new Error("Unable to derive token USD prices from snapshot");
  }
  const inX = new Decimal(tradeUsd).div(tokenXUsd);
  const inY = new Decimal(tradeUsd).div(tokenYUsd);
  return {
    xToY: {
      inputUi: inX,
      inputRaw: amountToBn(inX, decimalsX),
    },
    yToX: {
      inputUi: inY,
      inputRaw: amountToBn(inY, decimalsY),
    },
  };
}

function computeImpactFromSpot(actualOutUi, idealOutUi) {
  if (!idealOutUi || idealOutUi.lte(0)) return null;
  return idealOutUi.minus(actualOutUi).div(idealOutUi).mul(100).toNumber();
}

async function main() {
  initEnv();
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.NODEZERO_RPC_KEY;
  if (!apiKey) {
    throw new Error("NODEZERO_RPC_KEY is required");
  }

  const { row, snapshotName } = loadPoolSnapshot(opts);
  const connection = buildConnection(opts.rpcUrl, apiKey);

  console.log("=== NodeZero RPC + Meteora DLMM Price Impact Test ===");
  console.log(`RPC URL:        ${opts.rpcUrl}`);
  console.log(`Snapshot:       ${snapshotName}`);
  console.log(`Pool ID:        ${opts.poolId}`);
  console.log(`Pair:           ${row.raw?.name || `${row.mintA} / ${row.mintB}`}`);
  console.log(`Pool type:      ${row.poolType || row.source || "dlmm"}`);
  console.log("");

  console.log("1. Testing RPC connectivity and DLMM pair account...");
  const version = await connection.getVersion();
  const accountInfo = await connection.getAccountInfo(new PublicKey(opts.poolId));
  console.log(`   RPC version: ${JSON.stringify(version)}`);
  console.log(
    `   DLMM pair:   ${accountInfo ? `found | owner=${accountInfo.owner.toBase58()} | lamports=${accountInfo.lamports} | dataLen=${accountInfo.data.length}` : "missing"}`,
  );
  if (!accountInfo) {
    throw new Error(`DLMM pair account ${opts.poolId} not found`);
  }
  console.log("");

  console.log("2. Loading pool with official Meteora SDK...");
  const dlmmPool = await DLMM.create(connection, new PublicKey(opts.poolId));
  const tokenXMint = dlmmPool.tokenX.publicKey.toBase58();
  const tokenYMint = dlmmPool.tokenY.publicKey.toBase58();
  const decimalsX = Number(dlmmPool.tokenX.mint.decimals);
  const decimalsY = Number(dlmmPool.tokenY.mint.decimals);
  console.log(`   token X:      ${tokenXMint} (decimals=${decimalsX})`);
  console.log(`   token Y:      ${tokenYMint} (decimals=${decimalsY})`);
  console.log(`   active bin:   ${dlmmPool.lbPair.activeId}`);
  console.log(`   bin step:     ${dlmmPool.lbPair.binStep}`);
  console.log("");

  console.log("3. Requesting exact SDK swap quotes...");
  const snapshotSpot = deriveSnapshotSpotPrice(row);
  const { tokenXUsd, tokenYUsd } = deriveTokenUsd(
    row,
    snapshotSpot,
    decimalsX,
    decimalsY,
  );
  const inputs = deriveDirectionInputs(
    opts.tradeUsd,
    tokenXUsd,
    tokenYUsd,
    decimalsX,
    decimalsY,
  );

  const yToXArrays = await dlmmPool.getBinArrayForSwap(true, opts.binArrayCount);
  const xToYArrays = await dlmmPool.getBinArrayForSwap(false, opts.binArrayCount);

  let yToXQuote = null;
  let xToYQuote = null;
  let yToXError = null;
  let xToYError = null;

  try {
    yToXQuote = await dlmmPool.swapQuote(
      inputs.yToX.inputRaw,
      true,
      new BN(1),
      yToXArrays,
    );
  } catch (error) {
    yToXError = error;
  }

  try {
    xToYQuote = await dlmmPool.swapQuote(
      inputs.xToY.inputRaw,
      false,
      new BN(1),
      xToYArrays,
    );
  } catch (error) {
    xToYError = error;
  }

  if (!xToYQuote && !yToXQuote) {
    throw new Error(
      `Both quote directions failed. xToY=${xToYError ? xToYError.message || String(xToYError) : "n/a"} | yToX=${yToXError ? yToXError.message || String(yToXError) : "n/a"}`,
    );
  }

  const actualOutXtoY = xToYQuote ? bnToDecimal(xToYQuote.outAmount, decimalsY) : null;
  const actualOutYtoX = yToXQuote ? bnToDecimal(yToXQuote.outAmount, decimalsX) : null;
  const idealOutXtoY =
    snapshotSpot && snapshotSpot > 0
      ? inputs.xToY.inputUi.mul(snapshotSpot)
      : null;
  const idealOutYtoX =
    snapshotSpot && snapshotSpot > 0
      ? inputs.yToX.inputUi.div(snapshotSpot)
      : null;
  const impactXtoY =
    xToYQuote && idealOutXtoY ? computeImpactFromSpot(actualOutXtoY, idealOutXtoY) : null;
  const impactYtoX =
    yToXQuote && idealOutYtoX ? computeImpactFromSpot(actualOutYtoX, idealOutYtoX) : null;

  const rawSdkImpactXtoY = xToYQuote ? toNumber(xToYQuote.priceImpact) : null;
  const rawSdkImpactYtoX = yToXQuote ? toNumber(yToXQuote.priceImpact) : null;
  const worstImpact = [impactXtoY, impactYtoX]
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .reduce((max, v) => Math.max(max, v), null);

  console.log(`   TVL USD:      ${formatNum(toNumber(row.raw?.liquidity), 2)}`);
  console.log(`   Spot price:   ${formatNum(snapshotSpot, 12)} ${row.raw?.name?.split("-")[1] || "tokenY"} per ${row.raw?.name?.split("-")[0] || "tokenX"}`);
  console.log(`   Token X USD:  ${formatNum(tokenXUsd, 8)}`);
  console.log(`   Token Y USD:  ${formatNum(tokenYUsd, 8)}`);
  console.log(`   Trade size:   $${formatNum(opts.tradeUsd, 2)}`);
  console.log(`   Bin arrays:   ${opts.binArrayCount} per direction`);
  console.log(`   Worst est.:   ${formatNum(worstImpact, 6)}%`);
  console.log("");

  console.log(`   tokenX -> tokenY`);
  if (xToYQuote) {
    console.log(`     actual out:          ${formatNum(actualOutXtoY.toNumber(), 8)}`);
    console.log(`     ideal out(snapshot): ${idealOutXtoY ? formatNum(idealOutXtoY.toNumber(), 8) : "n/a"}`);
    console.log(`     impact vs snapshot:  ${formatNum(impactXtoY, 6)}%`);
    console.log(`     sdk impact(raw):     ${formatNum(rawSdkImpactXtoY, 12)}`);
    console.log(`     fee:                 ${xToYQuote.fee.toString()}`);
    console.log(`     protocol fee:        ${xToYQuote.protocolFee.toString()}`);
    console.log(`     min out:             ${xToYQuote.minOutAmount.toString()}`);
    console.log(`     end price(raw):      ${xToYQuote.endPrice.toString()}`);
    console.log(`     bin arrays:          ${xToYQuote.binArraysPubkey.length}`);
  } else {
    console.log(`     failed:              ${xToYError ? xToYError.message || String(xToYError) : "unknown"}`);
    console.log(`     bin arrays fetched:  ${xToYArrays.length}`);
  }
  console.log("");

  console.log(`   tokenY -> tokenX`);
  if (yToXQuote) {
    console.log(`     actual out:          ${formatNum(actualOutYtoX.toNumber(), 8)}`);
    console.log(`     ideal out(snapshot): ${idealOutYtoX ? formatNum(idealOutYtoX.toNumber(), 8) : "n/a"}`);
    console.log(`     impact vs snapshot:  ${formatNum(impactYtoX, 6)}%`);
    console.log(`     sdk impact(raw):     ${formatNum(rawSdkImpactYtoX, 12)}`);
    console.log(`     fee:                 ${yToXQuote.fee.toString()}`);
    console.log(`     protocol fee:        ${yToXQuote.protocolFee.toString()}`);
    console.log(`     min out:             ${yToXQuote.minOutAmount.toString()}`);
    console.log(`     end price(raw):      ${yToXQuote.endPrice.toString()}`);
    console.log(`     bin arrays:          ${yToXQuote.binArraysPubkey.length}`);
  } else {
    console.log(`     failed:              ${yToXError ? yToXError.message || String(yToXError) : "unknown"}`);
    console.log(`     bin arrays fetched:  ${yToXArrays.length}`);
  }
  console.log("");

  console.log("This quote comes from the official Meteora DLMM SDK over rpc-internal.");
  console.log("The spot comparison above is against snapshot price for sanity-checking only.");
}

main().catch((error) => {
  console.error("\nTest failed:");
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
