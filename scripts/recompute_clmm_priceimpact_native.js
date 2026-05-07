#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const BN = require("bn.js");
const nativeDecoder = require(path.resolve(__dirname, "..", "utils", "index.node"));
const { simulateClmmSwap } = require("./lib/clmmSimulatorFixed");

const DATA_DIR = path.join(__dirname, "..", "data");
const SNAPSHOT_RE =
  /^clmm\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const DEFAULT_TRADE_USD = 1_000;
const OUTPUT_DEFAULT = "clmm.test-test01.json";
const TICKS_PER_ARRAY = 60;
const DEFAULT_LIQUIDITY_MULTIPLIER = 1.0;
const DEFAULT_POOLSTATE_BATCH_SIZE = 100;
const DEFAULT_TICK_ARRAY_WINDOW = 3;
const DEFAULT_TICK_ARRAY_LIMIT = 12;
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
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "Es9vMFrzaCERmJfrF4H2FYD8nM5G4s46HoPazTA7kGEX", // USDT
]);

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
  const snapshotIndex = argv.indexOf("--snapshot");
  const outputIndex = argv.indexOf("--output");
  const poolIndex = argv.indexOf("--pool");
  const retryIndex = argv.indexOf("--retry-from");
  const retryOnlyFailed = argv.includes("--retry-only-failed");
  const offsetIndex = argv.indexOf("--offset");
  const noBatchTicks = argv.includes("--no-batch-ticks");
  const tradeIndex = argv.indexOf("--trade-usd");
  const poolLimitIndex = argv.indexOf("--limit");
  const minLiqUsdIndex = argv.indexOf("--min-liquidity-usd");
  const minLiqMultIndex = argv.indexOf("--min-liquidity-multiplier");
  const concurrencyIndex = argv.indexOf("--concurrency");
  const batchSizeIndex = argv.indexOf("--state-batch-size");
  const windowIndex = argv.indexOf("--tick-array-window");
  const tickLimitIndex = argv.indexOf("--tick-array-limit");
  const debugIndex = argv.indexOf("--debug-out");
  return {
    write: argv.includes("--write"),
    latest: argv.includes("--latest") || snapshotIndex === -1,
    snapshot:
      snapshotIndex >= 0 && argv[snapshotIndex + 1]
        ? argv[snapshotIndex + 1]
        : null,
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : OUTPUT_DEFAULT,
    poolId:
      poolIndex >= 0 && argv[poolIndex + 1]
        ? argv[poolIndex + 1]
        : null,
    retryFrom:
      retryIndex >= 0 && argv[retryIndex + 1]
        ? argv[retryIndex + 1]
        : null,
    retryOnlyFailed,
    tradeUsd:
      tradeIndex >= 0 && argv[tradeIndex + 1]
        ? Number(argv[tradeIndex + 1])
        : DEFAULT_TRADE_USD,
    limit:
      poolLimitIndex >= 0 && argv[poolLimitIndex + 1]
        ? Number(argv[poolLimitIndex + 1])
        : null,
    offset:
      offsetIndex >= 0 && argv[offsetIndex + 1]
        ? Math.max(0, Number(argv[offsetIndex + 1]))
        : 0,
    batchTicks: !noBatchTicks,
    minLiquidityUsd:
      minLiqUsdIndex >= 0 && argv[minLiqUsdIndex + 1]
        ? Number(argv[minLiqUsdIndex + 1])
        : null,
    minLiquidityMultiplier:
      minLiqMultIndex >= 0 && argv[minLiqMultIndex + 1]
        ? Number(argv[minLiqMultIndex + 1])
        : DEFAULT_LIQUIDITY_MULTIPLIER,
    concurrency:
      concurrencyIndex >= 0 && argv[concurrencyIndex + 1]
        ? Math.max(1, Number(argv[concurrencyIndex + 1]))
        : 1,
    stateBatchSize:
      batchSizeIndex >= 0 && argv[batchSizeIndex + 1]
        ? Math.max(1, Number(argv[batchSizeIndex + 1]))
        : DEFAULT_POOLSTATE_BATCH_SIZE,
    tickArrayWindow:
      windowIndex >= 0 && argv[windowIndex + 1]
        ? Math.max(1, Number(argv[windowIndex + 1]))
        : DEFAULT_TICK_ARRAY_WINDOW,
    tickArrayLimit:
      tickLimitIndex >= 0 && argv[tickLimitIndex + 1]
        ? Math.max(1, Number(argv[tickLimitIndex + 1]))
        : DEFAULT_TICK_ARRAY_LIMIT,
    debugOut:
      debugIndex >= 0 && argv[debugIndex + 1]
        ? argv[debugIndex + 1]
        : null,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/recompute_clmm_priceimpact_native.js --latest --output ${OUTPUT_DEFAULT} --write
  node scripts/recompute_clmm_priceimpact_native.js --snapshot clmm.live.json_<timestamp>.json --output ${OUTPUT_DEFAULT} --write
  node scripts/recompute_clmm_priceimpact_native.js --pool <POOL_ID> --snapshot clmm.live.json_<timestamp>.json
  node scripts/recompute_clmm_priceimpact_native.js --limit 20
  node scripts/recompute_clmm_priceimpact_native.js --offset 200 --limit 200
  node scripts/recompute_clmm_priceimpact_native.js --retry-from <previous_output.json>
  node scripts/recompute_clmm_priceimpact_native.js --retry-from <previous_output.json> --retry-only-failed
  node scripts/recompute_clmm_priceimpact_native.js --retry-from <previous_output.json> --debug-out clmm.debug.json
  node scripts/recompute_clmm_priceimpact_native.js --no-batch-ticks

Defaults:
  latest snapshot
  output = ${OUTPUT_DEFAULT}
  trade-usd = ${DEFAULT_TRADE_USD}
  min-liquidity-multiplier = ${DEFAULT_LIQUIDITY_MULTIPLIER}
  concurrency = 1
  state-batch-size = ${DEFAULT_POOLSTATE_BATCH_SIZE}
  tick-array-window = ${DEFAULT_TICK_ARRAY_WINDOW}
  tick-array-limit = ${DEFAULT_TICK_ARRAY_LIMIT}

Required env for NodeZero RPC path:
  NODEZERO_RPC_URL
  NODEZERO_RPC_KEY
`);
}

function listSnapshots() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => SNAPSHOT_RE.test(name))
    .map((name) => {
      const match = name.match(SNAPSHOT_RE);
      return {
        name,
        fullPath: path.join(DATA_DIR, name),
        stamp: match ? match[1] : "",
      };
    })
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

function pickSnapshot(opts) {
  const snapshots = listSnapshots();
  if (!snapshots.length) {
    throw new Error(`No CLMM snapshot files found in ${DATA_DIR}`);
  }
  if (opts.snapshot) {
    const found = snapshots.find((file) => file.name === opts.snapshot);
    if (!found) throw new Error(`Snapshot not found: ${opts.snapshot}`);
    return found;
  }
  return snapshots[0];
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

function formatPct(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(6)}%`
    : "n/a";
}

function getLiquidityUsd(row) {
  const direct = toNumber(row?.liquidity_usd);
  if (direct !== null) return direct;
  const legacy = toNumber(row?.liquidityUsd);
  if (legacy !== null) return legacy;
  return null;
}

function getPoolId(row) {
  return row?.id || row?.poolId || row?.pool_id || row?.address || null;
}

function hydrateRow(row) {
  if (!row || typeof row !== "object") return row;
  let payload = row.payload_json;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }
  if (!payload || typeof payload !== "object") return row;
  const merged = { ...row };
  merged.payload_json = payload;
  if (!merged.id && payload.id) merged.id = payload.id;
  if (!merged.poolId && payload.id) merged.poolId = payload.id;
  if (!merged.mintA && payload.mintA) merged.mintA = payload.mintA;
  if (!merged.mintB && payload.mintB) merged.mintB = payload.mintB;
  return merged;
}

function normalizeNativePoolState(poolState) {
  return {
    ...poolState,
    liquidity: BigInt(poolState?.liquidity ?? 0),
    sqrtPriceX64: BigInt(poolState?.sqrtPriceX64 ?? 0),
    tickCurrent: Number(poolState?.tickCurrent ?? 0),
    tickSpacing: Number(poolState?.tickSpacing ?? 0),
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
    exists: arr?.exists !== undefined ? Boolean(arr.exists) : true,
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

function extractRequestedArrays(out) {
  if (!out) return [];
  if (Array.isArray(out)) return out;
  if (Array.isArray(out.requested)) return out.requested;
  return [];
}

function mergeTickArrays(arraysA, arraysB) {
  const merged = new Map();
  for (const arr of [...arraysA, ...arraysB]) {
    const start = Number(arr.startTick);
    if (!merged.has(start)) {
      merged.set(start, arr);
      continue;
    }
    const prev = merged.get(start);
    if (prev.exists === false && arr.exists !== false) {
      merged.set(start, arr);
    } else if ((prev.ticks?.length || 0) === 0 && (arr.ticks?.length || 0) > 0) {
      merged.set(start, arr);
    }
  }
  return Array.from(merged.values());
}

function chooseNearestStarts(info, limit, currentWindow) {
  const span = Number(info.tickSpacing) * TICKS_PER_ARRAY;
  const currentStart = Number(info.currentStart);
  const selected = new Set();
  for (let d = -currentWindow; d <= currentWindow; d += 1) {
    selected.add(currentStart + d * span);
  }
  const starts = Array.isArray(info.starts) ? info.starts : [];
  const nearest = [...starts].sort(
    (a, b) => Math.abs(a - currentStart) - Math.abs(b - currentStart),
  );
  for (const start of nearest.slice(0, limit)) {
    selected.add(start);
  }
  return [...selected].sort((a, b) => a - b);
}

function buildBatchTickCache(selected, stateCache, limit, currentWindow, debug) {
  if (
    typeof nativeDecoder.getInitializedTickArrayStartsBatch !== "function" ||
    typeof nativeDecoder.decodeTickArraysBatchMulti !== "function"
  ) {
    return null;
  }
  const poolIds = selected.map((row) => getPoolId(row)).filter(Boolean);
  if (!poolIds.length) return null;
  const startsInfoList = nativeDecoder.getInitializedTickArrayStartsBatch(poolIds);
  const startsInfoByPool = new Map();
  for (const info of startsInfoList || []) {
    if (info?.pool) startsInfoByPool.set(info.pool, info);
  }

  const requests = [];
  const metaByPool = new Map();
  for (const poolId of poolIds) {
    const info =
      startsInfoByPool.get(poolId) ||
      (() => {
        const cached = stateCache?.get(poolId);
        if (!cached?.poolState) return null;
        const tickSpacing = Number(cached.poolState.tickSpacing ?? cached.ammConfig?.tickSpacing ?? 0);
        if (!tickSpacing) return null;
        const span = tickSpacing * TICKS_PER_ARRAY;
        const tickCurrent = Number(cached.poolState.tickCurrent ?? 0);
        const currentStart = Math.floor(tickCurrent / span) * span;
        return {
          pool: poolId,
          tickCurrent,
          tickSpacing,
          currentStart,
          source: "none",
          starts: [],
        };
      })();

    if (!info) continue;
    const startTicks = chooseNearestStarts(info, limit, currentWindow);
    requests.push({ pool: poolId, startTicks });
    metaByPool.set(poolId, {
      currentStart: info.currentStart ?? null,
      bitmapSource: info.source ?? null,
      initializedStartsCount: Array.isArray(info.starts) ? info.starts.length : 0,
      initializedStartsSample: debug && Array.isArray(info.starts) ? info.starts.slice(0, 20) : null,
    });
  }

  const results = nativeDecoder.decodeTickArraysBatchMulti(requests);
  const tickCache = new Map();
  for (const result of results || []) {
    const poolId = result?.pool;
    if (!poolId) continue;
    const arrays = Array.isArray(result.arrays) ? result.arrays : [];
    const tickArrays = normalizeNativeTickArrays(arrays);
    const tickMap = buildTickMap(tickArrays);
    const arraysRequested = arrays.length;
    const arraysExists = arrays.filter((arr) => arr.exists !== false).length;
    const meta = metaByPool.get(poolId) || {};
    tickCache.set(poolId, {
      tickArrays,
      tickMap,
      currentStart: meta.currentStart ?? null,
      arraysSource: "batch",
      arraysRequested,
      arraysExists,
      bitmapSource: meta.bitmapSource ?? null,
      initializedStartsCount: meta.initializedStartsCount ?? null,
      initializedStartsSample: meta.initializedStartsSample ?? null,
    });
  }
  return tickCache;
}

function fetchTickArraysForPool(poolId, poolState, limit, currentWindow) {
  let source = "nearest";
  const nearest = nativeDecoder.decodeTickArraysNearest(poolId, limit, currentWindow);
  let arrays = extractRequestedArrays(nearest);

  if (!arrays.some((a) => a.exists)) {
    source = "forSwap";
    const dirA = nativeDecoder.decodeTickArraysForSwap(poolId, true, limit, currentWindow);
    const dirB = nativeDecoder.decodeTickArraysForSwap(poolId, false, limit, currentWindow);
    arrays = mergeTickArrays(
      extractRequestedArrays(dirA),
      extractRequestedArrays(dirB),
    );
    if (!arrays.some((a) => a.exists)) {
      source = "nearest+forSwap";
      arrays = mergeTickArrays(arrays, extractRequestedArrays(nearest));
    }
  }

  const tickArrays = normalizeNativeTickArrays(arrays);
  const tickMap = buildTickMap(tickArrays);
  const currentStart = nearest?.currentStart ?? null;
  const arraysRequested = arrays.length;
  const arraysExists = arrays.filter((arr) => arr.exists !== false).length;
  return { tickArrays, tickMap, currentStart, source, arraysRequested, arraysExists };
}

function getTickArraySpan(tickSpacing) {
  return Number(tickSpacing) * TICKS_PER_ARRAY;
}

function getCurrentArrayStart(tickCurrent, tickSpacing) {
  const span = getTickArraySpan(tickSpacing);
  return Math.floor(Number(tickCurrent) / span) * span;
}

function evaluateDecodedCoverage(poolState, ammConfig, tickArrays, tickMap) {
  if (!poolState?.liquidity || BigInt(poolState.liquidity) <= 0n) {
    return { error: "zero active liquidity" };
  }
  if (!Array.isArray(tickArrays) || tickArrays.length === 0) {
    return { warning: "no decoded tick arrays" };
  }

  const currentArrayStart = getCurrentArrayStart(
    poolState.tickCurrent,
    ammConfig.tickSpacing,
  );
  const starts = new Set(
    tickArrays.filter((arr) => arr.exists !== false).map((arr) => Number(arr.startTick)),
  );

  if (starts.size === 0) {
    return { warning: "no decoded tick arrays" };
  }

  if (!starts.has(currentArrayStart)) {
    return { warning: `missing current tick array ${currentArrayStart}` };
  }

  return {};
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

function deriveTokenUsd(row, spotPrice) {
  if (looksStable(row?.mintB) && spotPrice !== null && spotPrice > 0) {
    return { tokenAUsd: spotPrice, tokenBUsd: 1 };
  }
  if (looksStable(row?.mintA) && spotPrice !== null && spotPrice > 0) {
    return { tokenAUsd: 1, tokenBUsd: 1 / spotPrice };
  }
  const payload = row?.payload_json;
  const tvlUsd = toNumber(payload?.tvl ?? row?.tvl ?? row?.liquidity_usd);
  const reserveA = toNumber(payload?.mintAmountA ?? row?.mintAmountA);
  const reserveB = toNumber(payload?.mintAmountB ?? row?.mintAmountB);
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

function computeClmmImpact(row, tradeUsd, stateCache, tickCache, options = {}) {
  const hydrated = hydrateRow(row);
  const poolId = getPoolId(hydrated);
  if (!poolId) throw new Error("missing pool id");
  let decodedState;
  let decodedConfig;
  if (stateCache && stateCache.has(poolId)) {
    const cached = stateCache.get(poolId);
    if (!cached?.exists) {
      throw new Error("pool state not found");
    }
    decodedState = cached.poolState;
    decodedConfig = cached.ammConfig;
  } else {
    decodedState = nativeDecoder.decodePoolState(poolId);
    decodedConfig = nativeDecoder.decodeAmmConfig(poolId);
  }
  const poolState = normalizeNativePoolState(decodedState || {});
  const ammConfig = normalizeNativeAmmConfig(decodedConfig || {});

  const window = Number.isFinite(stateCache?.tickArrayWindow)
    ? stateCache.tickArrayWindow
    : DEFAULT_TICK_ARRAY_WINDOW;
  const limit = Number.isFinite(stateCache?.tickArrayLimit)
    ? stateCache.tickArrayLimit
    : DEFAULT_TICK_ARRAY_LIMIT;

  let tickArrays;
  let tickMap;
  let currentStart;
  let source;
  let arraysRequested;
  let arraysExists;
  let bitmapSource = null;
  let initializedStartsCount = null;
  let initializedStartsSample = null;

  const cachedTicks = tickCache?.get(poolId);
  if (cachedTicks) {
    ({
      tickArrays,
      tickMap,
      currentStart,
      arraysSource: source,
      arraysRequested,
      arraysExists,
      bitmapSource,
      initializedStartsCount,
      initializedStartsSample,
    } = cachedTicks);
  } else {
    ({
      tickArrays,
      tickMap,
      currentStart,
      source,
      arraysRequested,
      arraysExists,
    } = fetchTickArraysForPool(poolId, poolState, limit, window));
  }
  if (!tickArrays.length) {
    throw new Error("no decoded tick arrays");
  }
  const coverage = evaluateDecodedCoverage(poolState, ammConfig, tickArrays, tickMap);
  if (coverage.error) {
    throw new Error(`unsafe decoded coverage: ${coverage.error}`);
  }

  const liveSpotPrice = sqrtPriceX64ToPrice(
    poolState.sqrtPriceX64,
    Number(hydrated?.mintA?.decimals ?? 0),
    Number(hydrated?.mintB?.decimals ?? 0),
  );
  const { tokenAUsd, tokenBUsd } = deriveTokenUsd(hydrated, liveSpotPrice);
  if (!tokenAUsd || !tokenBUsd) {
    throw new Error("unable to derive token USD prices");
  }

  const inputAUi = tradeUsd / tokenAUsd;
  const inputBUi = tradeUsd / tokenBUsd;
  const inputARaw = BigInt(
    Math.floor(inputAUi * 10 ** Number(hydrated?.mintA?.decimals ?? 0)),
  );
  const inputBRaw = BigInt(
    Math.floor(inputBUi * 10 ** Number(hydrated?.mintB?.decimals ?? 0)),
  );

  const aToB = simulateDirection({
    row: hydrated,
    poolState,
    ammConfig,
    tickMap,
    tokenInIsToken0: true,
    inputUi: inputAUi,
    inputRaw: inputARaw,
    liveSpotPrice,
  });
  const bToA = simulateDirection({
    row: hydrated,
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

  if (options.debug && !cachedTicks) {
    try {
      const init = nativeDecoder.getInitializedTickArrayStarts(poolId);
      bitmapSource = init?.source ?? null;
      initializedStartsCount = Array.isArray(init?.starts) ? init.starts.length : 0;
      initializedStartsSample = Array.isArray(init?.starts)
        ? init.starts.slice(0, 20)
        : null;
    } catch (error) {
      bitmapSource = "error";
    }
  }
  return {
    value: impacts.length ? Math.max(...impacts) : null,
    liveSpotPrice,
    tokenAUsd,
    tokenBUsd,
    aToB,
    bToA,
    arrays: tickArrays.length,
    initializedTicks: tickMap.size,
    arraysSource: source,
    arraysRequested,
    arraysExists,
    tickArrayWindow: window,
    tickArrayStart: currentStart,
    coverageWarning: coverage.warning || null,
    poolLiquidity: poolState.liquidity ?? null,
    tickCurrent: poolState.tickCurrent ?? null,
    tickSpacing: ammConfig.tickSpacing ?? null,
    bitmapSource,
    initializedStartsCount,
    initializedStartsSample,
  };
}

function buildPoolStateCache(selected, batchSize, tickArrayWindow, tickArrayLimit) {
  const cache = new Map();
  cache.tickArrayWindow = tickArrayWindow;
  cache.tickArrayLimit = tickArrayLimit;
  const pools = selected.map((row) => getPoolId(row)).filter(Boolean);
  for (let i = 0; i < pools.length; i += batchSize) {
    const chunk = pools.slice(i, i + batchSize);
    const rows = nativeDecoder.decodePoolStatesBatch(chunk);
    for (const row of rows || []) {
      if (!row || !row.pool) continue;
      cache.set(row.pool, row);
    }
  }
  return cache;
}

async function main() {
  initEnv();
  const opts = parseArgs(process.argv.slice(2));
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }

  const snapshot = pickSnapshot(opts);
  const rows = JSON.parse(fs.readFileSync(snapshot.fullPath, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error(`${snapshot.name} is not a JSON array`);
  }

  let retryIds = null;
  if (opts.retryFrom) {
    const retryPath = path.isAbsolute(opts.retryFrom)
      ? opts.retryFrom
      : path.join(DATA_DIR, opts.retryFrom);
    const retryRows = JSON.parse(fs.readFileSync(retryPath, "utf8"));
    if (!Array.isArray(retryRows)) {
      throw new Error(`retry file ${retryPath} is not a JSON array`);
    }
    retryIds = new Set(
      retryRows
        .filter((row) => {
          if (!row) return false;
          if (opts.retryOnlyFailed) {
            return row.priceImpactMethod === "exact_native_clmm_unavailable";
          }
          if (!row.priceImpactPct || !Number.isFinite(row.priceImpactPct)) return true;
          if (row.priceImpactMethod === "exact_native_clmm_unavailable") return true;
          if (row.priceImpactMethod === "exact_native_clmm_best_effort") return true;
          if (row.priceImpactReason) return true;
          return false;
        })
        .map((row) => getPoolId(row))
        .filter(Boolean),
    );
  }

  let selected;
  if (opts.poolId) {
    selected = rows.filter((row) => getPoolId(row) === opts.poolId);
  } else if (retryIds) {
    selected = rows.filter((row) => retryIds.has(getPoolId(row)));
    if (opts.offset > 0) {
      selected = selected.slice(opts.offset);
    }
    if (Number.isFinite(opts.limit) && opts.limit > 0 && selected.length > opts.limit) {
      selected = selected.slice(0, opts.limit);
    }
  } else {
    const offset = Number.isFinite(opts.offset) && opts.offset > 0 ? opts.offset : 0;
    if (Number.isFinite(opts.limit) && opts.limit > 0) {
      selected = rows.slice(offset, offset + opts.limit);
    } else if (offset > 0) {
      selected = rows.slice(offset);
    } else {
      selected = rows;
    }
  }

  if (!selected.length) {
    if (retryIds) {
      throw new Error(
        `No rows selected (retry set size=${retryIds.size}). The retry file does not match snapshot ${snapshot.name}. Recompute a fastpass on this snapshot first or use a retry file from the same snapshot.`,
      );
    }
    throw new Error("No rows selected");
  }

  const outputRows = rows.map((row) => ({ ...row }));
  const byId = new Map(outputRows.map((row) => [getPoolId(row), row]));
  const minLiquidityUsd =
    Number.isFinite(opts.minLiquidityUsd) && opts.minLiquidityUsd > 0
      ? opts.minLiquidityUsd
      : Number.isFinite(opts.minLiquidityMultiplier) &&
          opts.minLiquidityMultiplier > 0
        ? opts.tradeUsd * opts.minLiquidityMultiplier
        : null;

  let updated = 0;
  let failed = 0;
  const debugRows = [];

  console.log(`CLMM native impact recompute`);
  console.log(`snapshot: ${snapshot.name}`);
  console.log(`selected: ${selected.length}`);
  console.log(`tradeUsd: ${opts.tradeUsd}`);
  if (minLiquidityUsd) {
    console.log(`minLiquidityUsd: ${minLiquidityUsd}`);
  }
  console.log(`concurrency: ${opts.concurrency}`);
  console.log(`stateBatchSize: ${opts.stateBatchSize}`);
  console.log(`tickArrayWindow: ${opts.tickArrayWindow}`);
  console.log(`tickArrayLimit: ${opts.tickArrayLimit}`);
  if (opts.retryFrom) {
    console.log(`retryFrom: ${opts.retryFrom}`);
  }
  if (opts.retryOnlyFailed) {
    console.log("retryOnlyFailed: true");
  }
  if (opts.offset) {
    console.log(`offset: ${opts.offset}`);
  }
  if (opts.batchTicks) {
    console.log("tickArrayMode: batch");
  } else {
    console.log("tickArrayMode: per-pool");
  }
  if (opts.debugOut) {
    console.log(`debugOut: ${opts.debugOut}`);
  }
  if (opts.concurrency > 1) {
    console.log("note: native decoder is synchronous; concurrency > 1 may not improve runtime");
  }
  console.log(`output:   ${opts.output}`);
  console.log("");

  const stateCache = buildPoolStateCache(
    selected,
    opts.stateBatchSize,
    opts.tickArrayWindow,
    opts.tickArrayLimit,
  );
  let tickCache = null;
  if (opts.batchTicks) {
    const batchStart = Date.now();
    console.log(
      `[ticks] batch fetch start pools=${selected.length} window=${opts.tickArrayWindow} limit=${opts.tickArrayLimit}`,
    );
    tickCache = buildBatchTickCache(
      selected,
      stateCache,
      opts.tickArrayLimit,
      opts.tickArrayWindow,
      Boolean(opts.debugOut),
    );
    const batchMs = Date.now() - batchStart;
    console.log(`[ticks] batch fetch done ${batchMs}ms`);
  }

  let cursor = 0;
  const runOne = async (index) => {
    const row = selected[index];
    const hydrated = hydrateRow(row);
    const poolId = getPoolId(hydrated);
    try {
      const liquidityUsd = getLiquidityUsd(hydrated);
      if (
        Number.isFinite(minLiquidityUsd) &&
        Number.isFinite(liquidityUsd) &&
        liquidityUsd < minLiquidityUsd
      ) {
        const target = byId.get(poolId);
        if (target) {
          target.priceImpactPct = null;
          target.priceImpactMethod = "exact_native_clmm_unavailable";
          target.priceImpactTradeUsd = opts.tradeUsd;
          target.priceImpactReason = `liquidity_usd_below_${minLiquidityUsd}`;
        }
        failed += 1;
        console.log(
          `${index + 1}/${selected.length} ${poolId} :: failed :: liquidity_usd ${liquidityUsd} < ${minLiquidityUsd}`,
        );
        return;
      }
      const result = computeClmmImpact(hydrated, opts.tradeUsd, stateCache, tickCache, {
        debug: Boolean(opts.debugOut),
      });
      const target = byId.get(poolId);
      target.priceImpactPct = result.value;
      target.priceImpactMethod = result.coverageWarning
        ? "exact_native_clmm_best_effort"
        : "exact_native_clmm_test";
      target.priceImpactTradeUsd = opts.tradeUsd;
      if (result.coverageWarning) {
        target.priceImpactReason = result.coverageWarning;
      } else {
        delete target.priceImpactReason;
      }
      updated += 1;
      if (opts.debugOut) {
        debugRows.push({
          poolId,
          status: "ok",
          priceImpactPct: result.value,
          priceImpactMethod: target.priceImpactMethod,
          priceImpactReason: target.priceImpactReason || null,
          arraysSource: result.arraysSource,
          arraysRequested: result.arraysRequested,
          arraysExists: result.arraysExists,
          initializedTicks: result.initializedTicks,
          tickArrayStart: result.tickArrayStart,
          liveSpotPrice: result.liveSpotPrice,
          liquidity: result.poolLiquidity,
          tickCurrent: result.tickCurrent,
          tickSpacing: result.tickSpacing,
          bitmapSource: result.bitmapSource,
          initializedStartsCount: result.initializedStartsCount,
          initializedStartsSample: result.initializedStartsSample,
        });
      }
      console.log(
        `${index + 1}/${selected.length} ${poolId} :: ${formatPct(result.value)} :: arrays=${result.arrays} ticks=${result.initializedTicks} :: spot=${result.liveSpotPrice.toFixed(9)} :: source=${result.arraysSource} exists=${result.arraysExists}/${result.arraysRequested}${result.coverageWarning ? ` :: warn=${result.coverageWarning}` : ""}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = message.startsWith("unsafe decoded coverage:")
        ? message.replace("unsafe decoded coverage:", "").trim()
        : message;
      const target = byId.get(poolId);
      if (target) {
        target.priceImpactPct = null;
        target.priceImpactMethod = "exact_native_clmm_unavailable";
        target.priceImpactTradeUsd = opts.tradeUsd;
        target.priceImpactReason = reason;
      }
      failed += 1;
      if (opts.debugOut) {
        debugRows.push({
          poolId,
          status: "failed",
          error: message,
          priceImpactReason: reason,
        });
      }
      console.log(
        `${index + 1}/${selected.length} ${poolId} :: failed :: ${message}`,
      );
    }
  };

  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, () =>
    (async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= selected.length) return;
        await runOne(index);
      }
    })(),
  );

  await Promise.all(workers);

  console.log("");
  console.log(`updated=${updated} failed=${failed}`);

  if (opts.write) {
    const outPath = path.join(DATA_DIR, opts.output);
    fs.writeFileSync(outPath, JSON.stringify(outputRows, null, 2));
    console.log(`wrote ${outPath}`);
  } else {
    console.log("dry-run only (use --write to save output)");
  }
  if (opts.debugOut) {
    const debugPath = path.isAbsolute(opts.debugOut)
      ? opts.debugOut
      : path.join(DATA_DIR, opts.debugOut);
    fs.writeFileSync(debugPath, JSON.stringify(debugRows, null, 2));
    console.log(`wrote ${debugPath}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
