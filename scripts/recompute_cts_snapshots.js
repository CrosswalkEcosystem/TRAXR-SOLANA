const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATASET_FILE_RE =
  /^(amm\.live\.json|clmm\.live\.json|cpmm\.live\.json|orca\.live\.json|meteora\.dlmm\.live\.json|meteora\.dammv2\.live\.json|other\.live\.json)_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;

const WEIGHTS = {
  depth: 0.28,
  activity: 0.32,
  stability: 0.15,
  trust: 0.15,
  fee: 0.05,
  impact: 0.05,
};

const PARAMS = {
  impactProxyCapPct: 5,
  impactScoreCapPct: 10,
  volCap: 0.2,
  staleCapHours: 72,
  feeRefPct: 0.3,
  tradeSizeUsd: 1_000,
};

const STABLE_SYMBOLS = new Set([
  "USDC",
  "USDT",
  "USD1",
  "USDY",
  "PYUSD",
  "USDE",
  "USDS",
  "FDUSD",
  "USDH",
  "UXD",
  "DAI",
  "SUSD",
]);
const SOL_SYMBOLS = new Set(["SOL", "WSOL"]);
const VOLATILITY_WINDOW = 30;
const IMPACT_TRADE_SIZE_USD = 1_000;

const args = process.argv.slice(2);
const dryRun = !args.includes("--write");
const datasetArgIndex = args.indexOf("--dataset");
const snapshotArgIndex = args.indexOf("--snapshot");
const datasetFilter =
  datasetArgIndex >= 0 && args[datasetArgIndex + 1]
    ? args[datasetArgIndex + 1]
    : null;
const snapshotFilter =
  snapshotArgIndex >= 0 && args[snapshotArgIndex + 1]
    ? args[snapshotArgIndex + 1]
    : null;

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function safeLogNorm(value, denom) {
  return Math.log10(Math.max(value, 1)) / denom;
}

function impactProxyPct(liquidityUsd) {
  if (!liquidityUsd || liquidityUsd <= 0) return PARAMS.impactProxyCapPct;
  const ratio = PARAMS.tradeSizeUsd / Math.max(liquidityUsd, PARAMS.tradeSizeUsd);
  return Math.min(PARAMS.impactProxyCapPct, Math.sqrt(ratio) * 100);
}

function feeReferencePct(metrics) {
  const poolType = String(metrics.poolType ?? "").trim().toLowerCase();
  const source = String(metrics.source ?? "").trim().toLowerCase();

  if (poolType === "whirlpool" || source === "orca") return 0.1;
  if (
    poolType === "dlmm" ||
    poolType === "damm" ||
    source === "meteora" ||
    source === "meteora-damm"
  ) return 0.2;
  if (poolType === "clmm") return 0.1;
  return 0.3;
}

function calcCTSScore(metrics) {
  const vol24 = metrics.volume24hUsd ?? 0;
  const vol7 = metrics.volume7dUsd ?? vol24;

  const depth = clamp01(safeLogNorm(metrics.liquidityUsd, 6));
  const activity = clamp01(
    0.6 * safeLogNorm(vol24, 6) +
      0.4 * safeLogNorm(vol7 / 7, 6),
  );
  const stability = clamp01(1 - clamp01((metrics.volatilityPct ?? 0) / PARAMS.volCap));

  let lockAdj = 0.5;
  if (metrics.lockedPct === null || metrics.lockedPct === undefined) lockAdj -= 0.05;
  else if (metrics.lockedPct >= 70) lockAdj += 0.07;
  else if (metrics.lockedPct < 20) lockAdj -= 0.12;
  const lockTerm = clamp01(lockAdj);

  const missingPenalty =
    (metrics.liquidityUsd ? 0 : 0.05) +
    (vol24 ? 0 : 0.05);

  const trust = clamp01(0.5 * lockTerm + 0.5 * (1 - missingPenalty));
  const feeRefPct = feeReferencePct(metrics);
  const feeTerm = clamp01(
    (feeRefPct - (metrics.feePct ?? feeRefPct)) / feeRefPct,
  );
  const impactBase = metrics.priceImpactPct ?? impactProxyPct(metrics.liquidityUsd);
  const impact = clamp01(1 - clamp01(impactBase / PARAMS.impactScoreCapPct));
  const freshPenalty = clamp01((metrics.dataAgeHours ?? 0) / PARAMS.staleCapHours);

  const base =
    WEIGHTS.depth * depth +
    WEIGHTS.activity * activity +
    WEIGHTS.stability * stability +
    WEIGHTS.trust * trust +
    WEIGHTS.fee * feeTerm +
    WEIGHTS.impact * impact;

  return clamp01(base * (1 - freshPenalty));
}

function countCTSNodes(score01) {
  return score01 === 0 ? 0 : Math.max(1, Math.round(score01 * 6));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function parseTimestampSlug(slug) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/i.exec(
    slug,
  );
  if (!match) return null;
  const [, yyyy, mm, dd, hh, min, ss, ms] = match;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.${ms}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function deriveVolatilityFromPrices(prices) {
  const valid = prices.filter((price) => Number.isFinite(price) && price > 0);
  if (valid.length < 3) return null;

  const returns = [];
  for (let idx = 1; idx < valid.length; idx += 1) {
    returns.push(Math.log(valid[idx] / valid[idx - 1]));
  }
  if (returns.length < 2) return null;

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    returns.length;
  return Math.sqrt(variance);
}

function estimateSolUsdFromDataset(dataset) {
  const candidates = [];
  for (const pool of dataset) {
    const price = toNumber(pool?.price ?? pool?.raw?.current_price ?? pool?.raw?.price);
    if (price === null || price <= 0) continue;

    const symbolA = String(pool?.mintA?.symbol ?? pool?.symbolA ?? "").trim().toUpperCase();
    const symbolB = String(pool?.mintB?.symbol ?? pool?.symbolB ?? "").trim().toUpperCase();
    const aSol = SOL_SYMBOLS.has(symbolA);
    const bSol = SOL_SYMBOLS.has(symbolB);
    const aStable = STABLE_SYMBOLS.has(symbolA);
    const bStable = STABLE_SYMBOLS.has(symbolB);

    if (aSol && bStable) {
      if (price > 10 && price < 500) candidates.push(price);
      continue;
    }
    if (bSol && aStable) {
      const implied = 1 / price;
      if (Number.isFinite(implied) && implied > 10 && implied < 500) {
        candidates.push(implied);
      }
    }
  }
  return median(candidates);
}

function selectRaydiumVolumeUsd(volumeA, volumeB, symbolA, symbolB, solUsd) {
  const _a = String(symbolA ?? "").trim().toUpperCase();
  const _b = String(symbolB ?? "").trim().toUpperCase();
  const _solUsd = solUsd;

  // Raydium Standard pool payloads already expose `day.volume` / `week.volume`
  // as USD notional. `volumeQuote` is quote-token turnover, not a second USD field.
  return volumeA ?? volumeB ?? null;
}

function estimateConstantProductPriceImpactPct({
  reserveA,
  reserveB,
  priceBPerA,
  tvlUsd,
  feePct,
}) {
  if (
    reserveA === null ||
    reserveB === null ||
    priceBPerA === null ||
    tvlUsd === null ||
    reserveA <= 0 ||
    reserveB <= 0 ||
    priceBPerA <= 0 ||
    tvlUsd <= 0
  ) {
    return null;
  }

  const denominator = reserveA * priceBPerA + reserveB;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  const priceBUsd = tvlUsd / denominator;
  const priceAUsd = priceBPerA * priceBUsd;
  if (
    !Number.isFinite(priceAUsd) ||
    !Number.isFinite(priceBUsd) ||
    priceAUsd <= 0 ||
    priceBUsd <= 0
  ) {
    return null;
  }

  const feeFraction = Math.max(0, Math.min(0.99, (feePct ?? 0) / 100));
  const simulate = (reserveIn, reserveOut, spotOutPerIn, inputTokenUsd) => {
    if (inputTokenUsd <= 0 || spotOutPerIn <= 0) return null;
    const grossIn = IMPACT_TRADE_SIZE_USD / inputTokenUsd;
    if (!Number.isFinite(grossIn) || grossIn <= 0) return null;
    const effectiveIn = grossIn * (1 - feeFraction);
    if (effectiveIn <= 0) return null;
    const idealOut = effectiveIn * spotOutPerIn;
    if (!Number.isFinite(idealOut) || idealOut <= 0) return null;
    const actualOut = (reserveOut * effectiveIn) / (reserveIn + effectiveIn);
    if (!Number.isFinite(actualOut) || actualOut <= 0) return null;
    return Math.max(0, ((idealOut - actualOut) / idealOut) * 100);
  };

  const impactAtoB = simulate(reserveA, reserveB, priceBPerA, priceAUsd);
  const impactBtoA = simulate(reserveB, reserveA, 1 / priceBPerA, priceBUsd);
  const impacts = [impactAtoB, impactBtoA].filter(
    (value) => value !== null && Number.isFinite(value),
  );
  return impacts.length ? Math.max(...impacts) : null;
}

function estimateRpcBackedPriceImpactPct(_pool) {
  return null;
}

function estimatePriceImpactPct(pool, { isOrca, isMeteora, liquidityUsd, feePct }) {
  const explicit =
    toNumber(
      pool?.priceImpactPct ??
        pool?.priceImpactPercentage ??
        pool?.price_impact_percentage,
    );
  if (explicit !== null) return explicit;

  const poolType = Array.isArray(pool?.pooltype)
    ? String(pool.pooltype[0] ?? "")
    : String(pool?.poolType ?? pool?.type ?? "");
  const normalizedPoolType = poolType.trim().toLowerCase();

  if (
    !isOrca &&
    !isMeteora &&
    (normalizedPoolType === "amm" ||
      normalizedPoolType === "cpmm" ||
      String(pool?.type ?? "").toLowerCase() === "standard")
  ) {
    return estimateConstantProductPriceImpactPct({
      reserveA: toNumber(pool?.mintAmountA),
      reserveB: toNumber(pool?.mintAmountB),
      priceBPerA: toNumber(pool?.price),
      tvlUsd: Number.isFinite(liquidityUsd) ? liquidityUsd : null,
      feePct,
    });
  }

  return estimateRpcBackedPriceImpactPct(pool);
}

function normalizeForScoring(datasetName, pool, context = { solUsd: null, volatilityByPool: null }) {
  const isOrca = datasetName === "orca.live.json" || pool.poolType === "whirlpool";
  const isMeteora =
    datasetName === "meteora.dlmm.live.json" ||
    pool.poolType === "dlmm" ||
    pool.source === "meteora";

  const liquidityUsd = (() => {
    if (isOrca) return toNumber(pool.tvlUsdc) ?? 0;
    if (isMeteora) return toNumber(pool.raw?.tvl ?? pool.raw?.liquidity) ?? 0;
    return toNumber(pool.tvl ?? pool.liquidityUsd ?? pool.liquidity) ?? 0;
  })();

  let volume24hUsd = 0;
  if (isMeteora) {
    volume24hUsd =
      toNumber(pool.raw?.trade_volume_24h) ??
      toNumber(pool.raw?.volume?.["24h"]) ??
      toNumber(pool.raw?.volume?.hour_24) ??
      0;
  } else if (isOrca) {
    volume24hUsd = toNumber(pool.stats?.["24h"]?.volume) ?? 0;
  } else {
    const sourceUsd = toNumber(pool.day?.volume);
    if (sourceUsd !== null) {
      volume24hUsd = sourceUsd;
    } else {
      const explicitUsd =
        toNumber(pool.volume24hUsd) ??
        toNumber(pool.volume_usd?.h24) ??
        toNumber(pool.volume_usd_24h) ??
        toNumber(pool.volume24hUSD);
      if (explicitUsd !== null) {
        volume24hUsd = explicitUsd;
      } else {
        volume24hUsd =
          selectRaydiumVolumeUsd(
            toNumber(pool.day?.volume),
            toNumber(pool.day?.volumeQuote),
            pool?.mintA?.symbol ?? pool?.symbolA ?? "",
            pool?.mintB?.symbol ?? pool?.symbolB ?? "",
            context.solUsd,
          ) ?? 0;
      }
    }
  }

  const volume7dUsd = (() => {
    if (isMeteora || isOrca) return null;
    const sourceUsd = toNumber(pool.week?.volume);
    if (sourceUsd !== null) return sourceUsd;
    return (
      toNumber(pool.volume7dUsd) ??
      toNumber(pool.volume_usd?.h7) ??
      toNumber(pool.volume_usd_7d) ??
      toNumber(pool.volume7dUSD) ??
      selectRaydiumVolumeUsd(
        toNumber(pool.week?.volume),
        toNumber(pool.week?.volumeQuote),
        pool?.mintA?.symbol ?? pool?.symbolA ?? "",
        pool?.mintB?.symbol ?? pool?.symbolB ?? "",
        context.solUsd,
      )
    );
  })();

  const feePct = (() => {
    if (isOrca) {
      const raw = toNumber(pool.feeRate);
      return raw === null ? null : raw / 10000;
    }
    if (isMeteora) {
      return (
        toNumber(pool.raw?.pool_config?.base_fee_pct) ??
        toNumber(pool.raw?.dynamic_fee_pct) ??
        toNumber(pool.raw?.base_fee_percentage) ??
        toNumber(pool.raw?.max_fee_percentage) ??
        null
      );
    }
    const explicitFeePct = toNumber(pool.feePct ?? pool.fee_percentage);
    if (explicitFeePct !== null) return explicitFeePct;
    const raw =
      toNumber(pool.feeRate) ??
      toNumber(pool.config?.tradeFeeRate) ??
      null;
    if (raw === null) return null;
    if (raw <= 1) return raw * 100;
    return raw / 10000;
  })();
  const priceImpactPct = estimatePriceImpactPct(pool, {
    isOrca,
    isMeteora,
    liquidityUsd,
    feePct,
  });

  return {
    poolType: isMeteora
      ? "dlmm"
      : isOrca
        ? "whirlpool"
        : pool.poolType ?? pool.type ?? null,
    source: isMeteora ? "meteora" : isOrca ? "orca" : pool.source ?? null,
    liquidityUsd,
    volume24hUsd,
    volume7dUsd,
    tx24h: 0,
    tx7d: null,
    lockedPct: null,
    feePct,
    priceImpactPct,
    volatilityPct:
      toNumber(pool.volatilityPct ?? pool.volatility) ??
      context.volatilityByPool?.get(pool.id ?? pool.poolId ?? pool.address) ??
      null,
    dataAgeHours: 0,
  };
}

function listSnapshotFiles() {
  const names = fs.readdirSync(DATA_DIR);
  return names
    .filter((name) => DATASET_FILE_RE.test(name))
    .sort()
    .map((name) => {
      const match = name.match(DATASET_FILE_RE);
      return {
        name,
        datasetName: match ? match[1] : "",
        fullPath: path.join(DATA_DIR, name),
      };
    });
}

function buildHistoricalVolatilityByPool(files) {
  const seriesByPool = new Map();

  for (const file of files) {
    const match = file.name.match(DATASET_FILE_RE);
    const stampMs = match ? parseTimestampSlug(match[2]) : null;
    if (!stampMs) continue;
    const raw = JSON.parse(fs.readFileSync(file.fullPath, "utf8"));
    if (!Array.isArray(raw)) continue;

    for (const entry of raw) {
      const poolId =
        typeof entry?.id === "string"
          ? entry.id
          : typeof entry?.poolId === "string"
            ? entry.poolId
            : typeof entry?.address === "string"
              ? entry.address
              : null;
      const price = toNumber(entry?.price ?? entry?.raw?.current_price ?? entry?.raw?.price);
      if (!poolId || price === null || price <= 0) continue;
      const list = seriesByPool.get(poolId) ?? [];
      list.push({ ts: stampMs, price });
      seriesByPool.set(poolId, list);
    }
  }

  const volatilityByPool = new Map();
  for (const [poolId, series] of seriesByPool.entries()) {
    const prices = series
      .sort((a, b) => a.ts - b.ts)
      .slice(-VOLATILITY_WINDOW)
      .map((point) => point.price);
    const volatility = deriveVolatilityFromPrices(prices);
    if (volatility !== null) volatilityByPool.set(poolId, volatility);
  }
  return volatilityByPool;
}

function recomputeFile(fileInfo, sharedVolatilityByPool) {
  const raw = JSON.parse(fs.readFileSync(fileInfo.fullPath, "utf8"));
  if (!Array.isArray(raw)) return { pools: 0, changedPools: 0, fileChanged: false };

  const context = {
    solUsd: estimateSolUsdFromDataset(raw),
    volatilityByPool: sharedVolatilityByPool,
  };
  let changedPools = 0;

  for (const entry of raw) {
    const metrics = normalizeForScoring(fileInfo.datasetName, entry, context);
    const score01 = calcCTSScore(metrics);
    const nextScore = score01;
    const nextNodes = countCTSNodes(score01);

    const prevScore =
      typeof entry.ctsScore === "number" ? entry.ctsScore : toNumber(entry.ctsScore);
    const prevNodes =
      typeof entry.ctsNodes === "number" ? entry.ctsNodes : toNumber(entry.ctsNodes);

    const scoreChanged =
      prevScore === null || Math.abs(prevScore - nextScore) > 1e-12;
    const nodesChanged = prevNodes === null || prevNodes !== nextNodes;

    if (scoreChanged || nodesChanged) {
      changedPools += 1;
      entry.ctsScore = nextScore;
      entry.ctsNodes = nextNodes;
    }
  }

  const fileChanged = changedPools > 0;
  if (fileChanged && !dryRun) {
    fs.writeFileSync(fileInfo.fullPath, JSON.stringify(raw, null, 2));
  }

  return {
    pools: raw.length,
    changedPools,
    fileChanged,
    solUsd: context.solUsd,
  };
}

function main() {
  const files = listSnapshotFiles();
  if (!files.length) {
    console.log("No stamped snapshot files found.");
    return;
  }
  const sharedVolatilityByPool = buildHistoricalVolatilityByPool(files);

  let totalPools = 0;
  let changedPools = 0;
  let changedFiles = 0;

  console.log(
    `${dryRun ? "[DRY RUN]" : "[WRITE]"} Processing ${files.length} snapshot files in ${DATA_DIR}`,
  );

  for (const file of files) {
    const result = recomputeFile(file, sharedVolatilityByPool);
    totalPools += result.pools;
    changedPools += result.changedPools;
    if (result.fileChanged) changedFiles += 1;
    console.log(
      `${file.name}: pools=${result.pools}, changed=${result.changedPools}, solUsd=${result.solUsd ?? "n/a"}`,
    );
  }

  console.log(
    `Summary: files=${files.length}, filesChanged=${changedFiles}, pools=${totalPools}, poolsChanged=${changedPools}`,
  );
}

main();
