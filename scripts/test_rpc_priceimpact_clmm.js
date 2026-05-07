#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const BN = require("bn.js");
const { PublicKey } = require("@solana/web3.js");
const { simulateClmmSwap } = require("./lib/clmmSimulatorFixed");
const nativeDecoder = require(path.resolve(__dirname, "..", "utils", "index.node"));

loadEnvFile(path.resolve(__dirname, "..", ".env.local"));

const RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const RPC_KEY = process.env.NODEZERO_RPC_KEY || process.env.NODEZERO_API_KEY;
const CLMM_PROGRAM_ID = new PublicKey(
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
);

const DEFAULT_TRADE_USD = 1000;
const DEFAULT_POOL_ID = "3ucNos4NbumPLZNWztqGHNFFgkHeRMBQAVemeeomsUxv";
const SNAPSHOT_PATTERN =
  /^clmm\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const TICKS_PER_ARRAY = 60;
const EMBEDDED_BITMAP_OFFSET = 896;
const EMBEDDED_BITMAP_WORDS = 16;
const BATCH_SIZE = 100;
const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "USD1",
  "PYUSD",
  "USDS",
  "USDE",
  "FDUSD",
  "DAI",
]);
const STABLE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD8nM5G4s46HoPazTA7kGEX",
]);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const opts = {
    poolId: DEFAULT_POOL_ID,
    snapshot: null,
    tradeUsd: DEFAULT_TRADE_USD,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pool" && argv[i + 1]) {
      opts.poolId = argv[++i];
    } else if (arg === "--snapshot" && argv[i + 1]) {
      opts.snapshot = argv[++i];
    } else if (arg === "--trade-usd" && argv[i + 1]) {
      const value = Number.parseFloat(String(argv[++i]));
      if (Number.isFinite(value) && value > 0) opts.tradeUsd = value;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  npm run test:rpc:impact:clmm
  npm run test:rpc:impact:clmm -- --pool <POOL_ID>
  npm run test:rpc:impact:clmm -- --snapshot <FILENAME>
  npm run test:rpc:impact:clmm -- --trade-usd <USD>

Defaults:
  pool:      ${DEFAULT_POOL_ID}
  trade-usd: ${DEFAULT_TRADE_USD}
`);
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") return Number(value);
  return null;
}

function formatNum(value, digits = 6) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: digits })
    : "n/a";
}

function normalizeNativePoolState(poolState) {
  return {
    ...poolState,
    liquidity: BigInt(poolState?.liquidity ?? 0),
    sqrtPriceX64: BigInt(poolState?.sqrtPriceX64 ?? 0),
    tickCurrent: Number(poolState?.tickCurrent ?? 0),
    tickSpacing: Number(poolState?.tickSpacing ?? 0),
    feeGrowthGlobal0X64: BigInt(poolState?.feeGrowthGlobal0X64 ?? 0),
    feeGrowthGlobal1X64: BigInt(poolState?.feeGrowthGlobal1X64 ?? 0),
    protocolFeesToken0: BigInt(poolState?.protocolFeesToken0 ?? 0),
    protocolFeesToken1: BigInt(poolState?.protocolFeesToken1 ?? 0),
  };
}

function normalizeNativeAmmConfig(ammConfig) {
  return {
    ...ammConfig,
    protocolFeeRate: Number(ammConfig?.protocolFeeRate ?? 0),
    tradeFeeRate: Number(ammConfig?.tradeFeeRate ?? 0),
    tickSpacing: Number(ammConfig?.tickSpacing ?? 0),
    fundFeeRate: Number(ammConfig?.fundFeeRate ?? 0),
  };
}

function normalizeNativeTickArrays(tickArrays) {
  if (!Array.isArray(tickArrays)) return [];
  return tickArrays.map((arr) => ({
    pda: arr?.pda || null,
    startTick: Number(arr?.startTick ?? 0),
    ticks: Array.isArray(arr?.ticks)
      ? arr.ticks.map((tick) => ({
          tick: Number(tick?.tick ?? 0),
          liquidityNet: String(tick?.liquidityNet ?? "0"),
          liquidityGross: String(tick?.liquidityGross ?? "0"),
        }))
      : [],
  }));
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
    throw new Error(`No CLMM snapshot files found in ${dataDir}`);
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
      entry?.id === opts.poolId ||
      entry?.poolId === opts.poolId ||
      entry?.address === opts.poolId,
  );
  if (!row) {
    throw new Error(`Pool ${opts.poolId} not found in ${snapshotName}`);
  }
  return { row, snapshotName };
}

function readPubkey(data, offsetRef) {
  const start = offsetRef.value;
  const key = new PublicKey(data.slice(start, start + 32));
  offsetRef.value += 32;
  return key;
}

function readU16LE(data, offsetRef) {
  const value = data.readUInt16LE(offsetRef.value);
  offsetRef.value += 2;
  return value;
}

function readU32LE(data, offsetRef) {
  const value = data.readUInt32LE(offsetRef.value);
  offsetRef.value += 4;
  return value;
}

function readI32LE(data, offsetRef) {
  const value = data.readInt32LE(offsetRef.value);
  offsetRef.value += 4;
  return value;
}

function readU64LE(data, offsetRef) {
  const value = data.readBigUInt64LE(offsetRef.value);
  offsetRef.value += 8;
  return value;
}

function readU128LE(data, offsetRef) {
  const lo = data.readBigUInt64LE(offsetRef.value);
  const hi = data.readBigUInt64LE(offsetRef.value + 8);
  offsetRef.value += 16;
  return lo + (hi << 64n);
}

function decodePoolState(accountData) {
  const data = accountData.slice(8);
  const off = { value: 0 };

  const bump = data[off.value];
  off.value += 1;
  const ammConfigPk = readPubkey(data, off);
  const ownerPk = readPubkey(data, off);
  const tokenMint0 = readPubkey(data, off);
  const tokenMint1 = readPubkey(data, off);
  const tokenVault0 = readPubkey(data, off);
  const tokenVault1 = readPubkey(data, off);
  const observationPk = readPubkey(data, off);
  const mintDecimals0 = data[off.value];
  off.value += 1;
  const mintDecimals1 = data[off.value];
  off.value += 1;
  const tickSpacing = readU16LE(data, off);
  const liquidity = readU128LE(data, off);
  const sqrtPriceX64 = readU128LE(data, off);
  const tickCurrent = readI32LE(data, off);
  off.value += 4;
  const feeGrowthGlobal0X64 = readU128LE(data, off);
  const feeGrowthGlobal1X64 = readU128LE(data, off);
  const protocolFeesToken0 = readU64LE(data, off);
  const protocolFeesToken1 = readU64LE(data, off);

  return {
    bump,
    ammConfigPk,
    ownerPk,
    tokenMint0,
    tokenMint1,
    tokenVault0,
    tokenVault1,
    observationPk,
    mintDecimals0,
    mintDecimals1,
    tickSpacing,
    liquidity,
    sqrtPriceX64,
    tickCurrent,
    feeGrowthGlobal0X64,
    feeGrowthGlobal1X64,
    protocolFeesToken0,
    protocolFeesToken1,
    rawData: data,
  };
}

function decodeAmmConfig(accountData) {
  const data = accountData.slice(8);
  const off = { value: 0 };

  const bump = data[off.value];
  off.value += 1;
  const index = readU16LE(data, off);
  const ownerPk = readPubkey(data, off);
  const protocolFeeRate = readU32LE(data, off);
  const tradeFeeRate = readU32LE(data, off);
  const tickSpacing = readU16LE(data, off);
  const fundFeeRate = readU32LE(data, off);

  return {
    bump,
    index,
    ownerPk,
    protocolFeeRate,
    tradeFeeRate,
    tickSpacing,
    fundFeeRate,
  };
}

function parseTickArrayBytes(accountData) {
  const full = accountData.slice(8);
  const header = 32 + 4;
  const footer = 1 + 8 + 107;
  const body = full.slice(header, full.length - footer);
  const tickSize = Math.floor(body.length / TICKS_PER_ARRAY);
  const ticks = [];

  for (let i = 0; i < TICKS_PER_ARRAY; i += 1) {
    const start = i * tickSize;
    const sl = body.slice(start, start + tickSize);
    const tick = sl.readInt32LE(0);
    const netLo = sl.readBigInt64LE(4);
    const netHi = sl.readBigInt64LE(12);
    const grossLo = sl.readBigUInt64LE(20);
    const grossHi = sl.readBigUInt64LE(28);
    const liquidityNet = netLo + (netHi << 64n);
    const liquidityGross = grossLo + (grossHi << 64n);

    if (liquidityNet !== 0n || liquidityGross !== 0n) {
      ticks.push({
        tick,
        liquidityNet: liquidityNet.toString(),
        liquidityGross: liquidityGross.toString(),
      });
    }
  }

  return ticks;
}

function deriveTickArrayPda(poolPk, startTick) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("tick_array"),
      poolPk.toBuffer(),
      Buffer.from(Int32Array.of(startTick).buffer).swap32(),
    ],
    CLMM_PROGRAM_ID,
  )[0];
}

function deriveBitmapExtPda(poolPk) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_tick_array_bitmap_extension"), poolPk.toBuffer()],
    CLMM_PROGRAM_ID,
  )[0];
}

async function fetchTickArrayViews(connection, entries) {
  const result = [];

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const chunk = entries.slice(i, i + BATCH_SIZE);
    const accounts = await connection.getMultipleAccountsInfo(
      chunk.map(([pda]) => pda),
      "confirmed",
    );

    for (let j = 0; j < accounts.length; j += 1) {
      const acct = accounts[j];
      if (!acct?.data) continue;
      const [pda, startTick] = chunk[j];
      result.push({
        pda: pda.toBase58(),
        startTick,
        ticks: parseTickArrayBytes(acct.data),
      });
    }
  }

  return result;
}

function buildTickPdaList(poolPk, poolState, ammConfig, extAcctData) {
  const span = ammConfig.tickSpacing * TICKS_PER_ARRAY;
  const pdaList = [];
  let found = false;

  if (extAcctData) {
    const ext = extAcctData.slice(8);
    let pos = 32;
    const maxWords = Math.floor(((ext.length - pos) / 8) / 2);

    for (let wi = 0; wi < maxWords; wi += 1) {
      const word = ext.readBigUInt64LE(pos + wi * 8);
      for (let b = 0; b < 64; b += 1) {
        if (((word >> BigInt(b)) & 1n) === 1n) {
          const idx = wi * 64 + b;
          const start = (512 + idx) * span;
          pdaList.push([deriveTickArrayPda(poolPk, start), start]);
        }
      }
    }

    pos += maxWords * 8;
    for (let wi = 0; wi < maxWords; wi += 1) {
      const word = ext.readBigUInt64LE(pos + wi * 8);
      for (let b = 0; b < 64; b += 1) {
        if (((word >> BigInt(b)) & 1n) === 1n) {
          const idx = wi * 64 + b;
          const start = (-1 - idx) * span;
          pdaList.push([deriveTickArrayPda(poolPk, start), start]);
        }
      }
    }

    if (pdaList.length) found = true;
  }

  if (!found) {
    const data = poolState.rawData;
    const bits = [];
    for (let i = 0; i < EMBEDDED_BITMAP_WORDS; i += 1) {
      const off = EMBEDDED_BITMAP_OFFSET + i * 8;
      bits.push(data.readBigUInt64LE(off));
    }
    const center = (EMBEDDED_BITMAP_WORDS * 64) / 2;
    for (let wi = 0; wi < bits.length; wi += 1) {
      const word = bits[wi];
      for (let b = 0; b < 64; b += 1) {
        if (((word >> BigInt(b)) & 1n) === 1n) {
          const bitIndex = wi * 64 + b;
          const start = (bitIndex - center) * span;
          pdaList.push([deriveTickArrayPda(poolPk, start), start]);
        }
      }
    }
  }

  const tickarrayStart = Math.floor(poolState.tickCurrent / span) * span;
  for (let d = -3; d <= 3; d += 1) {
    const start = tickarrayStart + d * span;
    if (!pdaList.some(([, existing]) => existing === start)) {
      pdaList.push([deriveTickArrayPda(poolPk, start), start]);
    }
  }

  pdaList.sort((a, b) => a[1] - b[1]);
  return pdaList;
}

function buildTickMap(tickArrays) {
  const tickMap = new Map();
  for (const arr of tickArrays) {
    for (const tick of arr.ticks || []) {
      tickMap.set(tick.tick, {
        initialized: true,
        liquidityNet: tick.liquidityNet,
      });
    }
  }
  return tickMap;
}

function sqrtPriceX64ToPrice(sqrtPriceX64, decimalsA, decimalsB) {
  const ratio = Number(sqrtPriceX64) / 2 ** 64;
  const scale = 10 ** (decimalsA - decimalsB);
  return ratio * ratio * scale;
}

function looksStable(token) {
  if (!token) return false;
  const symbol = String(token.symbol || "").toUpperCase();
  const address = String(token.address || "");
  return STABLE_SYMBOLS.has(symbol) || STABLE_MINTS.has(address);
}

function deriveTokenUsd(pool, spotPrice) {
  if (looksStable(pool?.mintB) && spotPrice !== null && spotPrice > 0) {
    return { tokenAUsd: spotPrice, tokenBUsd: 1 };
  }
  if (looksStable(pool?.mintA) && spotPrice !== null && spotPrice > 0) {
    return { tokenAUsd: 1, tokenBUsd: 1 / spotPrice };
  }
  const tvlUsd = toNumber(pool?.tvl);
  const reserveA = toNumber(pool?.mintAmountA);
  const reserveB = toNumber(pool?.mintAmountB);
  if (
    tvlUsd !== null &&
    tvlUsd > 0 &&
    reserveA !== null &&
    reserveA > 0 &&
    reserveB !== null &&
    reserveB > 0 &&
    spotPrice !== null &&
    spotPrice > 0
  ) {
    const denominator = reserveA * spotPrice + reserveB;
    if (Number.isFinite(denominator) && denominator > 0) {
      const tokenBUsd = tvlUsd / denominator;
      const tokenAUsd = tokenBUsd * spotPrice;
      if (
        Number.isFinite(tokenAUsd) &&
        Number.isFinite(tokenBUsd) &&
        tokenAUsd > 0 &&
        tokenBUsd > 0
      ) {
        return { tokenAUsd, tokenBUsd };
      }
    }
  }
  return { tokenAUsd: null, tokenBUsd: null };
}

function simulateDirection({
  row,
  poolState,
  ammConfig,
  tickMap,
  tokenInIsToken0,
  inputUi,
  inputRaw,
  liveSpotPrice,
}) {
  const result = simulateClmmSwap({
    amountIn: new BN(String(inputRaw)),
    tokenInIsToken0,
    pool: {
      sqrtPriceX64: new BN(poolState.sqrtPriceX64.toString()),
      liquidity: new BN(poolState.liquidity.toString()),
      tickCurrent: poolState.tickCurrent,
      tickSpacing: ammConfig.tickSpacing,
      feeRate: ammConfig.tradeFeeRate / 1_000_000,
      tickMap,
    },
  });

  const outputDecimals = tokenInIsToken0
    ? Number(row?.mintB?.decimals ?? 0)
    : Number(row?.mintA?.decimals ?? 0);
  const actualOutUi =
    Number(result.amountOut.toString()) / 10 ** outputDecimals;
  const feePct = ammConfig.tradeFeeRate / 1_000_000;
  const effectiveInputUi = inputUi * (1 - feePct);
  const idealOutUi = tokenInIsToken0
    ? effectiveInputUi * liveSpotPrice
    : effectiveInputUi / liveSpotPrice;
  const impactPct =
    idealOutUi > 0
      ? Math.max(0, ((idealOutUi - actualOutUi) / idealOutUi) * 100)
      : null;

  return {
    direction: tokenInIsToken0 ? "tokenA -> tokenB" : "tokenB -> tokenA",
    actualOutUi,
    idealOutUi,
    impactPct,
    crossed: Array.isArray(result.ticksCrossed) ? result.ticksCrossed.length : 0,
    startTick: poolState.tickCurrent,
    endTick:
      result.ticksCrossed && result.ticksCrossed.length
        ? result.ticksCrossed[result.ticksCrossed.length - 1]
        : poolState.tickCurrent,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { row, snapshotName } = loadPoolSnapshot(opts);
  const poolId = row.id || row.poolId || row.address;
  const poolName =
    row.poolName ||
    [row.mintA?.symbol || row.mintA?.name, row.mintB?.symbol || row.mintB?.name]
      .filter(Boolean)
      .join(" / ");

  console.log("=== Native Decoder + Raydium CLMM Price Impact Test ===");
  console.log(`Decoder:        ${path.resolve(__dirname, "..", "utils", "index.node")}`);
  console.log(`Snapshot:       ${snapshotName}`);
  console.log(`Pool ID:        ${poolId}`);
  console.log(`Pair:           ${poolName}`);
  console.log(`Pool type:      clmm`);
  console.log("");

  console.log("1. Decoding CLMM state via native binary...");
  const decoded = nativeDecoder.decodeClmm(poolId);
  const poolState = normalizeNativePoolState(decoded?.poolState || {});
  const ammConfig = normalizeNativeAmmConfig(decoded?.ammConfig || {});
  const tickArrays = normalizeNativeTickArrays(decoded?.tickArrays || []);
  if (!poolState || !tickArrays.length) {
    throw new Error("Native decoder returned incomplete CLMM state");
  }
  console.log(
    `   CLMM pool:   found | tickCurrent=${poolState.tickCurrent} | liquidity=${poolState.liquidity.toString()}`,
  );
  console.log("");

  console.log("2. Building tick map from decoded tick arrays...");
  const tickMap = buildTickMap(tickArrays);

  console.log(`   tick spacing: ${ammConfig.tickSpacing}`);
  console.log(`   arrays:       ${tickArrays.length} loaded`);
  console.log(`   init ticks:   ${tickMap.size}`);
  console.log("");

  console.log("3. Requesting exact JS swap simulations...");
  const snapshotPrice = toNumber(row?.price);
  const liveSpotPrice = sqrtPriceX64ToPrice(
    poolState.sqrtPriceX64,
    Number(row?.mintA?.decimals ?? 0),
    Number(row?.mintB?.decimals ?? 0),
  );
  const { tokenAUsd, tokenBUsd } = deriveTokenUsd(row, liveSpotPrice);
  if (!tokenAUsd || !tokenBUsd) {
    throw new Error("Unable to derive token USD prices from snapshot");
  }

  const inputAUi = opts.tradeUsd / tokenAUsd;
  const inputBUi = opts.tradeUsd / tokenBUsd;
  const inputARaw = BigInt(
    Math.floor(inputAUi * 10 ** Number(row?.mintA?.decimals ?? 0)),
  );
  const inputBRaw = BigInt(
    Math.floor(inputBUi * 10 ** Number(row?.mintB?.decimals ?? 0)),
  );

  const aToB = simulateDirection({
    row,
    poolState,
    ammConfig,
    tickMap,
    tokenInIsToken0: true,
    inputUi: inputAUi,
    inputRaw: inputARaw,
    liveSpotPrice,
  });
  const bToA = simulateDirection({
    row,
    poolState,
    ammConfig,
    tickMap,
    tokenInIsToken0: false,
    inputUi: inputBUi,
    inputRaw: inputBRaw,
    liveSpotPrice,
  });

  const impacts = [aToB.impactPct, bToA.impactPct].filter(
    (value) => value !== null && Number.isFinite(value),
  );
  const worst = impacts.length ? Math.max(...impacts) : null;

  console.log(`   TVL USD:      ${formatNum(toNumber(row?.tvl), 2)}`);
  console.log(
    `   Snapshot px:  ${formatNum(snapshotPrice, 12)} ${row?.mintB?.symbol} per ${row?.mintA?.symbol}`,
  );
  console.log(
    `   Live spot px: ${formatNum(liveSpotPrice, 12)} ${row?.mintB?.symbol} per ${row?.mintA?.symbol}`,
  );
  console.log(`   Token A USD:  ${formatNum(tokenAUsd, 8)}`);
  console.log(`   Token B USD:  ${formatNum(tokenBUsd, 8)}`);
  console.log(`   Trade size:   $${formatNum(opts.tradeUsd, 2)}`);
  console.log(`   Worst exact:  ${worst === null ? "n/a" : `${formatNum(worst, 6)}%`}`);
  console.log("");

  for (const result of [aToB, bToA]) {
    console.log(`   ${result.direction}`);
    console.log(`     actual out:  ${formatNum(result.actualOutUi, 8)}`);
    console.log(`     ideal out:   ${formatNum(result.idealOutUi, 8)}`);
    console.log(
      `     impact:      ${result.impactPct === null ? "n/a" : `${formatNum(result.impactPct, 6)}%`}`,
    );
    console.log(`     crossed:     ${result.crossed} initialized ticks`);
    console.log(`     ticks:       ${result.startTick} -> ${result.endTick}`);
  }
  console.log("");
  console.log("This uses the native CLMM decoder binary directly from Node.js.");
}

main().catch((error) => {
  console.error("");
  console.error("Test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
