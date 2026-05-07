import fs from "fs";
import path from "path";
import zlib from "zlib";
import Decimal from "decimal.js";

import { SAMPLE_POOLS } from "./sampleData";
import { buildWarnings, toScoreResult } from "./scoringAdapter";
import { sanitizeTokenLogoUrl } from "./tokenLogo";
import { TraxrDatasetSummary, TraxrScoreResult, SolanaPoolMetrics } from "./types";
import {
  getDatasetPriceSeries,
  getLatestPools,
  getLatestSnapshotIso,
  hasSqliteDataset,
  listSqliteDatasets,
} from "./traxrSqliteService";

const REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_API_LIMIT = 200;
const API_LIMIT = Number(process.env.TRAXR_API_LIMIT || DEFAULT_API_LIMIT);
const API_MAX_LIMIT = Number(process.env.TRAXR_API_MAX_LIMIT || 2000);
const CACHE_LIMIT = Number(process.env.TRAXR_CACHE_LIMIT || 0);

const FALLBACK_SAMPLE = process.env.TRAXR_FALLBACK_SAMPLE === "true";
const LOCAL_POOLS_PATH = process.env.TRAXR_LOCAL_POOLS_PATH || "";
const USE_SQLITE = process.env.TRAXR_USE_SQLITE === "true";
const LOCAL_POOLS_DIR =
  process.env.TRAXR_LOCAL_DATA_DIR || path.join(process.cwd(), "data");
const DATASET_FILES = [
  "amm.live.json",
  "clmm.live.json",
  "cpmm.live.json",
  "orca.live.json",
  "pumpswap.live.json",
  "meteora.dlmm.live.json",
  "meteora.dammv2.live.json",
  "other.live.json",
];
const DATASET_KEYS = {
  amm: "amm.live.json",
  clmm: "clmm.live.json",
  cpmm: "cpmm.live.json",
  orca: "orca.live.json",
  pumpswap: "pumpswap.live.json",
  meteora: "meteora.dlmm.live.json",
  "meteora-dammv2": "meteora.dammv2.live.json",
  other: "other.live.json",
} as const;
const DATASET_REGEX =
  /^(amm\.live\.json|clmm\.live\.json|cpmm\.live\.json|orca\.live\.json|pumpswap\.live\.json|meteora\.dlmm\.live\.json|meteora\.dammv2\.live\.json|other\.live\.json)_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json(?:\.gz)?$/i;
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

function resolveSqliteKey(datasetKey: string) {
  const keys = listSqliteDatasets();
  return keys.includes(datasetKey as any) ? (datasetKey as any) : null;
}

// In-memory cache
let cache = new Map<string, TraxrScoreResult>();
let cacheList: TraxrScoreResult[] = [];
let lastRefresh = 0;
let schedulerStarted = false;
const datasetCache = new Map<
  string,
  {
    cache: Map<string, TraxrScoreResult>;
    list: TraxrScoreResult[];
    lastRefresh: number;
  }
>();

const poolKey = (mintA: string, mintB: string) => {
  const a = String(mintA ?? "").toLowerCase();
  const b = String(mintB ?? "").toLowerCase();
  return [a, b].sort().join("_");
};

type NormalizeContext = {
  solUsd: number | null;
  volatilityByPool: Map<string, number> | null;
};

type SnapshotGroup = {
  timestamp: string;
  timestampSource: "filename" | "mtime";
  files: { name: string; fullPath: string; mtimeMs: number }[];
};

type HistoricalVolatilityCache = {
  signature: string;
  byPool: Map<string, number>;
  datasetKey: string | null;
};

const VOLATILITY_WINDOW = 30;
let historicalVolatilityCache: HistoricalVolatilityCache | null = null;
const sqliteHistoricalVolatilityCache = new Map<
  string,
  {
    signature: string;
    byPool: Map<string, number>;
  }
>();
const IMPACT_TRADE_SIZE_USD = 1_000;
const TIMINGS_ENABLED = process.env.TRAXR_TIMINGS === "true";

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function logTiming(label: string, startMs: number) {
  if (!TIMINGS_ENABLED) return;
  const elapsed = nowMs() - startMs;
  console.log(`[TRAXR-SOLANA] ${label} ${elapsed.toFixed(1)}ms`);
}

function getRawPoolId(entry: any) {
  if (typeof entry?.id === "string") return entry.id;
  if (typeof entry?.poolId === "string") return entry.poolId;
  if (typeof entry?.address === "string") return entry.address;
  return null;
}

function dedupeRawPools(rows: any[]) {
  const passthrough: any[] = [];
  const byPool = new Map<string, any>();
  for (const row of rows) {
    const poolId = getRawPoolId(row);
    if (!poolId) {
      passthrough.push(row);
      continue;
    }
    byPool.set(poolId, row);
  }
  return [...passthrough, ...byPool.values()];
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

function estimateSolUsdFromPools(pools: any[]) {
  const candidates: number[] = [];
  for (const p of pools) {
    const price = Number.parseFloat(String(p?.price ?? ""));
    if (!Number.isFinite(price) || price <= 0) continue;

    const symbolA = String(p?.mintA?.symbol ?? p?.symbolA ?? "")
      .trim()
      .toUpperCase();
    const symbolB = String(p?.mintB?.symbol ?? p?.symbolB ?? "")
      .trim()
      .toUpperCase();
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

function readJsonFile(filePath: string) {
  const raw = fs.readFileSync(filePath);
  const text = filePath.endsWith(".gz")
    ? zlib.gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
  return JSON.parse(text);
}

export function buildNormalizeContext(pools: any[]): NormalizeContext {
  return {
    solUsd: estimateSolUsdFromPools(pools),
    volatilityByPool: null,
  };
}

export function deriveVolatilityFromPrices(prices: number[]) {
  const valid = prices.filter((price) => Number.isFinite(price) && price > 0);
  if (valid.length < 3) return null;

  const returns: number[] = [];
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

function selectRaydiumVolumeUsd(
  volumeA: number | null,
  volumeB: number | null,
  symbolA: string,
  symbolB: string,
  solUsd: number | null,
) {
  const _a = symbolA.trim().toUpperCase();
  const _b = symbolB.trim().toUpperCase();
  const _solUsd = solUsd;

  // Raydium Standard pool payloads expose `day.volume` / `week.volume`
  // as the source-backed USD notional. `volumeQuote` is quote-token volume,
  // which only coincidentally resembles USD on some pairs (e.g. WSOL quotes).
  // Prefer `volume` directly and only fall back to `volumeQuote` when needed.
  return volumeA ?? volumeB ?? null;
}

function estimateConstantProductPriceImpactPct(opts: {
  reserveA: number | null;
  reserveB: number | null;
  priceBPerA: number | null;
  tvlUsd: number | null;
  feePct: number | null;
}) {
  const { reserveA, reserveB, priceBPerA, tvlUsd, feePct } = opts;
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

  const simulate = (
    reserveIn: number,
    reserveOut: number,
    spotOutPerIn: number,
    inputTokenUsd: number,
  ) => {
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
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (!impacts.length) return null;
  return Math.max(...impacts);
}

function estimateRpcBackedPriceImpactPct(_pool: any) {
  // CLMM / Whirlpool / DLMM need live depth state (ticks / bins) to simulate
  // execution correctly. Wire RPC-backed account fetches here next.
  return null;
}

function estimatePriceImpactPct(pool: any, opts: {
  isOrca: boolean;
  isMeteora: boolean;
  liquidityUsd: number;
  feePct: number | null;
}) {
  const explicit = Number.parseFloat(
    String(
      pool?.priceImpactPct ??
        pool?.priceImpactPercentage ??
        pool?.price_impact_percentage ??
        "",
    ),
  );
  if (Number.isFinite(explicit)) return explicit;

  const poolType = Array.isArray(pool?.pooltype)
    ? String(pool.pooltype[0] ?? "")
    : String(pool?.poolType ?? pool?.type ?? "");
  const normalizedPoolType = poolType.trim().toLowerCase();

  const reserveA = Number.parseFloat(String(pool?.mintAmountA ?? ""));
  const reserveB = Number.parseFloat(String(pool?.mintAmountB ?? ""));
  const price = Number.parseFloat(String(pool?.price ?? ""));
  const tvlUsd = Number.isFinite(opts.liquidityUsd) ? opts.liquidityUsd : null;

  if (
    !opts.isOrca &&
    !opts.isMeteora &&
    (normalizedPoolType === "amm" ||
      normalizedPoolType === "cpmm" ||
      String(pool?.type ?? "").toLowerCase() === "standard")
  ) {
    return estimateConstantProductPriceImpactPct({
      reserveA: Number.isFinite(reserveA) ? reserveA : null,
      reserveB: Number.isFinite(reserveB) ? reserveB : null,
      priceBPerA: Number.isFinite(price) ? price : null,
      tvlUsd,
      feePct: opts.feePct,
    });
  }

  return estimateRpcBackedPriceImpactPct(pool);
}

/* ---------------------------------- */
/* Pool matching (search)              */
/* ---------------------------------- */

function matchesPoolTokens(
  pool: SolanaPoolMetrics,
  tokenA: string,
  tokenB: string,
): boolean {
  const canon = (v?: string) => v?.toLowerCase().trim();

  const poolTokens = [
    canon(pool.mintA),
    canon(pool.mintB),
    canon(pool.tokenASymbol),
    canon(pool.tokenBSymbol),
    canon(pool.tokenAName),
    canon(pool.tokenBName),
  ].filter(Boolean) as string[];

  const a = canon(tokenA);
  const b = canon(tokenB);
  if (!a || !b) return false;
  return poolTokens.includes(a) && poolTokens.includes(b);
}

/* ---------------------------------- */
/* Fetch + cache                       */
/* ---------------------------------- */

async function fetchSolanaPools(): Promise<SolanaPoolMetrics[]> {
  const localRaw = loadLocalPools();
  const localContext = {
    ...buildNormalizeContext(localRaw),
    volatilityByPool: USE_SQLITE ? null : getHistoricalVolatilityByPool(),
  };
  const local = localRaw.map((entry) => normalizePool(entry, localContext));
  if (local.length) {
    if (Number.isFinite(CACHE_LIMIT) && CACHE_LIMIT > 0) {
      return local.slice(0, CACHE_LIMIT);
    }
    return local;
  }

  if (FALLBACK_SAMPLE) {
    console.warn("[TRAXR-SOLANA] Using SAMPLE_POOLS fallback");
    if (Number.isFinite(CACHE_LIMIT) && CACHE_LIMIT > 0) {
      return SAMPLE_POOLS.slice(0, CACHE_LIMIT);
    }
    return SAMPLE_POOLS;
  }

  return [];
}

async function refreshCache() {
  const pools = await fetchSolanaPools();
  const next = new Map<string, TraxrScoreResult>();
  const nextList: TraxrScoreResult[] = [];

  for (const p of pools) {
    const { score, nodes, ctsNodes } = toScoreResult(p);

    const item: TraxrScoreResult = {
      poolId: p.poolId,
      score,
      ctsNodes,
      nodes,
      warnings: buildWarnings(p, nodes),
      updatedAt: p.poolUpdatedAt || new Date().toISOString(),

      // PASS-THROUGH (NO TRANSFORM)
      metrics: p,

      tokenAName: p.tokenAName,
      tokenASymbol: p.tokenASymbol,
      tokenBName: p.tokenBName,
      tokenBSymbol: p.tokenBSymbol,
    };

    next.set(poolKey(p.mintA, p.mintB), item);
    nextList.push(item);
  }

  cache = next;
  cacheList = nextList.sort((a, b) => b.score - a.score);
  lastRefresh = Date.now();
}

/* ---------------------------------- */
/* Public API                          */
/* ---------------------------------- */

export async function ensureTraxrCache() {
  if (!lastRefresh || Date.now() - lastRefresh > REFRESH_MS * 2) {
    try {
      await refreshCache();
    } catch (e) {
      console.error("[TRAXR-SOLANA] cache refresh failed", e);
    }
  }
}

async function refreshDatasetCache(datasetKey: string) {
  const refreshStart = nowMs();
  const datasetPath = resolveDatasetPath(datasetKey);
  let raw: any[] = [];
  if (USE_SQLITE) {
    const sqliteKey = resolveSqliteKey(datasetKey);
    if (sqliteKey && hasSqliteDataset(sqliteKey)) {
      raw = getLatestPools(sqliteKey);
    } else if (datasetPath) {
      const readStart = nowMs();
      raw = readJsonFile(datasetPath);
      logTiming(`dataset ${datasetKey} read`, readStart);
    }
  } else {
    if (!datasetPath) return;
    const readStart = nowMs();
    raw = readJsonFile(datasetPath);
    logTiming(`dataset ${datasetKey} read`, readStart);
  }
  if (!Array.isArray(raw)) return;
  const dedupedRaw = dedupeRawPools(raw);
  const volatilityStart = nowMs();
  const volatilityByPool = USE_SQLITE
    ? null
    : getHistoricalVolatilityByPool(datasetKey);
  logTiming(`dataset ${datasetKey} volatility`, volatilityStart);
  const context = {
    ...buildNormalizeContext(dedupedRaw),
    volatilityByPool,
  };

  const snapshotIso = USE_SQLITE
    ? (resolveSqliteKey(datasetKey) && hasSqliteDataset(resolveSqliteKey(datasetKey)!)
        ? getLatestSnapshotIso(resolveSqliteKey(datasetKey)!)
        : (() => {
            if (!datasetPath) return null;
            const snapshotMs = parseTimestampFromFilename(path.basename(datasetPath));
            return snapshotMs ? new Date(snapshotMs).toISOString() : null;
          })())
    : (() => {
        const snapshotMs = parseTimestampFromFilename(path.basename(datasetPath!));
        return snapshotMs ? new Date(snapshotMs).toISOString() : null;
      })();

  const next = new Map<string, TraxrScoreResult>();
  const nextList: TraxrScoreResult[] = [];

  const normalizeStart = nowMs();
  for (const entry of dedupedRaw) {
    const normalized = normalizePool({
      ...entry,
      poolUpdatedAt:
        typeof entry.poolUpdatedAt === "string"
          ? entry.poolUpdatedAt
          : snapshotIso ?? undefined,
    }, context);
    const { score, nodes, ctsNodes } = toScoreResult(normalized);
    const item: TraxrScoreResult = {
      poolId: normalized.poolId,
      score,
      ctsNodes,
      nodes,
      warnings: buildWarnings(normalized, nodes),
      updatedAt: normalized.poolUpdatedAt || new Date().toISOString(),
      metrics: normalized,
      tokenAName: normalized.tokenAName,
      tokenASymbol: normalized.tokenASymbol,
      tokenBName: normalized.tokenBName,
      tokenBSymbol: normalized.tokenBSymbol,
    };
    next.set(poolKey(normalized.mintA, normalized.mintB), item);
    nextList.push(item);
  }

  datasetCache.set(datasetKey, {
    cache: next,
    list: nextList.sort((a, b) => b.score - a.score),
    lastRefresh: Date.now(),
  });
  logTiming(`dataset ${datasetKey} normalize`, normalizeStart);
  logTiming(`dataset ${datasetKey} total`, refreshStart);
}

async function ensureDatasetCache(datasetKey: string) {
  const entry = datasetCache.get(datasetKey);
  if (!entry || Date.now() - entry.lastRefresh > REFRESH_MS * 2) {
    await refreshDatasetCache(datasetKey);
  }
  return datasetCache.get(datasetKey) ?? null;
}

function buildDatasetSummary(list: TraxrScoreResult[]): TraxrDatasetSummary {
  const totalPools = list.length;
  if (!totalPools) {
    return {
      totalPools: 0,
      totalLiquidityUsd: 0,
      totalVolume24hUsd: 0,
      elevatedPools: 0,
      warningPools: 0,
      programs: 0,
      medianScore: 0,
      hasVolume24h: false,
      hasVolume7d: false,
      hasPriceRange24h: false,
      hasFeeApr24h: false,
      hasFeeApr7d: false,
    };
  }

  const scores = list.map((p) => p.score ?? 0).sort((a, b) => a - b);
  const medianScore = scores[Math.floor(scores.length / 2)] ?? 0;
  const cutoff = scores[Math.floor(scores.length * 0.25)] ?? 0;
  const elevatedPools = list.filter((p) => (p.score ?? 0) <= cutoff).length;
  const warningPools = list.filter((p) => (p.warnings ?? []).length > 0).length;
  const programs = new Set(
    list
      .map((p) => p.metrics?.poolProgramId || p.poolId || p.metrics?.poolId)
      .filter(Boolean),
  ).size;
  const totals = list.reduce(
    (acc, p) => {
      acc.totalLiquidityUsd += p.metrics?.liquidityUsd ?? 0;
      if (
        typeof p.metrics?.volume24hUsd === "number" &&
        Number.isFinite(p.metrics.volume24hUsd)
      ) {
        acc.totalVolume24hUsd += p.metrics.volume24hUsd;
        acc.hasVolume24h = true;
      }
      if (
        typeof p.metrics?.volume7dUsd === "number" &&
        Number.isFinite(p.metrics.volume7dUsd)
      ) {
        acc.hasVolume7d = true;
      }
      if (
        typeof p.metrics?.priceMin24h === "number" &&
        typeof p.metrics?.priceMax24h === "number" &&
        p.metrics.priceMin24h >= 0 &&
        p.metrics.priceMax24h >= 0
      ) {
        acc.hasPriceRange24h = true;
      }
      if (
        typeof p.metrics?.feeApr24h === "number" &&
        Number.isFinite(p.metrics.feeApr24h)
      ) {
        acc.hasFeeApr24h = true;
      }
      if (
        typeof p.metrics?.feeApr7d === "number" &&
        Number.isFinite(p.metrics.feeApr7d)
      ) {
        acc.hasFeeApr7d = true;
      }
      return acc;
    },
    {
      totalLiquidityUsd: 0,
      totalVolume24hUsd: 0,
      hasVolume24h: false,
      hasVolume7d: false,
      hasPriceRange24h: false,
      hasFeeApr24h: false,
      hasFeeApr7d: false,
    },
  );

  return {
    totalPools,
    totalLiquidityUsd: totals.totalLiquidityUsd,
    totalVolume24hUsd: totals.totalVolume24hUsd,
    elevatedPools,
    warningPools,
    programs,
    medianScore,
    hasVolume24h: totals.hasVolume24h,
    hasVolume7d: totals.hasVolume7d,
    hasPriceRange24h: totals.hasPriceRange24h,
    hasFeeApr24h: totals.hasFeeApr24h,
    hasFeeApr7d: totals.hasFeeApr7d,
  };
}

export async function getDatasetSummary(
  datasetKey: string,
): Promise<TraxrDatasetSummary> {
  const latest = await ensureDatasetCache(datasetKey);
  if (!latest) {
    return buildDatasetSummary([]);
  }
  const summary = buildDatasetSummary(latest.list);
  return {
    ...summary,
    snapshotIso: getDatasetSnapshotIso(datasetKey),
  };
}

export async function getTraxrScore(
  mintA: string,
  mintB: string,
  datasetKey?: string,
): Promise<TraxrScoreResult | null> {
  if (datasetKey) {
    const latest = await ensureDatasetCache(datasetKey);
    if (!latest) return null;

    const exact = latest.cache.get(poolKey(mintA, mintB));
    if (exact) return exact;

    return (
      latest.list.find((p) => matchesPoolTokens(p.metrics, mintA, mintB)) ??
      null
    );
  }

  for (const key of Object.keys(DATASET_KEYS)) {
    const latest = await ensureDatasetCache(key);
    if (!latest) continue;
    const exact = latest.cache.get(poolKey(mintA, mintB));
    if (exact) return exact;

    const match =
      latest.list.find((p) => matchesPoolTokens(p.metrics, mintA, mintB)) ??
      null;
    if (match) return match;
  }

  await ensureTraxrCache();

  const exact = cache.get(poolKey(mintA, mintB));
  if (exact) return exact;

  return (
    cacheList.find((p) =>
      matchesPoolTokens(p.metrics, mintA, mintB),
    ) ?? null
  );
}

export async function getTopPools(
  limit?: number,
  offset?: number,
): Promise<TraxrScoreResult[]> {
  await ensureTraxrCache();
  const normalizedLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? Math.min(limit, API_MAX_LIMIT)
      : API_LIMIT;
  const safeOffset = Number.isFinite(offset) && (offset ?? 0) > 0 ? offset! : 0;
  if (Number.isFinite(normalizedLimit) && normalizedLimit > 0) {
    return cacheList.slice(safeOffset, safeOffset + normalizedLimit);
  }
  return cacheList;
}

export async function getPoolById(
  poolId: string,
  datasetKey?: string,
): Promise<TraxrScoreResult | null> {
  const needle = poolId.trim();
  if (!needle) return null;

  if (datasetKey) {
    const latest = await ensureDatasetCache(datasetKey);
    if (!latest) return null;
    return latest.list.find((pool) => pool.poolId === needle) ?? null;
  }

  for (const key of Object.keys(DATASET_KEYS)) {
    const latest = await ensureDatasetCache(key);
    const match = latest?.list.find((pool) => pool.poolId === needle) ?? null;
    if (match) return match;
  }

  await ensureTraxrCache();
  return cacheList.find((pool) => pool.poolId === needle) ?? null;
}

export async function getTopPoolsTotal(): Promise<number> {
  await ensureTraxrCache();
  return cacheList.length;
}

export async function searchPools(
  query: string,
  limit = 50,
): Promise<TraxrScoreResult[]> {
  await ensureTraxrCache();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const max = Number.isFinite(limit) && limit > 0 ? limit : 50;

  const parts = q.split(/[\\s/]+/).filter(Boolean);
  const wantsPair = parts.length >= 2;
  const tokenA = parts[0];
  const tokenB = parts[1];

  const results: TraxrScoreResult[] = [];
  for (const pool of cacheList) {
    const m: any = pool.metrics || {};
    if (wantsPair && matchesPoolTokens(m, tokenA, tokenB)) {
      results.push(pool);
    } else {
      const fields = [
        pool.poolId,
        m.mintA,
        m.mintB,
        m.tokenAName,
        m.tokenBName,
        m.tokenASymbol,
        m.tokenBSymbol,
        pool.tokenAName,
        pool.tokenBName,
        pool.tokenASymbol,
        pool.tokenBSymbol,
        m.poolProgramId,
        m.poolType,
      ];
      const haystack = fields
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .map((t: string) => t.toLowerCase())
        .join(" ");
      if (haystack.includes(q)) {
        results.push(pool);
      }
    }

    if (results.length >= max) break;
  }

  return results;
}

export async function getDatasetPoolsPage(
  datasetKey: string,
  limit?: number,
  offset?: number,
): Promise<{ total: number; pools: TraxrScoreResult[]; snapshotIso: string | null }> {
  const latest = await ensureDatasetCache(datasetKey);
  const snapshotIso = getDatasetSnapshotIso(datasetKey);
  if (!latest) return { total: 0, pools: [], snapshotIso };

  const total = latest.list.length;
  const safeOffset = Number.isFinite(offset) && (offset ?? 0) > 0 ? offset! : 0;
  const normalizedLimit =
    typeof limit === "number" && Number.isFinite(limit) && limit > 0
      ? limit
      : 0;
  if (normalizedLimit > 0) {
    return {
      total,
      pools: latest.list.slice(safeOffset, safeOffset + normalizedLimit),
      snapshotIso,
    };
  }
  return { total, pools: latest.list, snapshotIso };
}

export async function searchDatasetPools(
  datasetKey: string,
  query: string,
  limit = 50,
): Promise<TraxrScoreResult[]> {
  const latest = await ensureDatasetCache(datasetKey);
  if (!latest) return [];
  const list = latest.list;
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const max = Number.isFinite(limit) && limit > 0 ? limit : 50;

  const parts = q.split(/[\\s/]+/).filter(Boolean);
  const wantsPair = parts.length >= 2;
  const tokenA = parts[0];
  const tokenB = parts[1];

  const results: TraxrScoreResult[] = [];
  for (const pool of list) {
    const m: any = pool.metrics || {};
    if (wantsPair && matchesPoolTokens(m, tokenA, tokenB)) {
      results.push(pool);
    } else {
      const fields = [
        pool.poolId,
        m.mintA,
        m.mintB,
        m.tokenAName,
        m.tokenBName,
        m.tokenASymbol,
        m.tokenBSymbol,
        pool.tokenAName,
        pool.tokenBName,
        pool.tokenASymbol,
        pool.tokenBSymbol,
        m.poolProgramId,
        m.poolType,
      ];
      const haystack = fields
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .map((t: string) => t.toLowerCase())
        .join(" ");
      if (haystack.includes(q)) results.push(pool);
    }

    if (results.length >= max) break;
  }

  return results;
}

export function startTraxrScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setInterval(() => {
    refreshCache().catch((e) =>
      console.error("[TRAXR-SOLANA] background refresh failed", e),
    );
  }, REFRESH_MS);
}

startTraxrScheduler();

/* ---------------------------------- */
/* Local cache loader                  */
/* ---------------------------------- */

function parseTimestampFromFilename(name: string) {
  const normalized = name.endsWith(".gz") ? name.slice(0, -3) : name;
  const datasetMatch = normalized.match(DATASET_REGEX);
  if (datasetMatch) {
    const slug = datasetMatch[2];
    const parsed = parseTimestampSlug(slug);
    return parsed;
  }

  const geckoMatch = normalized.match(
    /solanaPools_(?:gecko_)?(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)/i,
  );
  if (geckoMatch) {
    const raw = geckoMatch[1];
    const iso =
      `${raw.slice(0, 4)}-${raw.slice(5, 7)}-${raw.slice(8, 10)}` +
      `T${raw.slice(11, 13)}:${raw.slice(13, 15)}:${raw.slice(15, 17)}.` +
      `${raw.slice(17, 20)}Z`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }

  const match = /^solanaPools_(\d{8})_(\d{6})Z\.json$/i.exec(normalized);
  if (!match) return null;
  const date = match[1];
  const time = match[2];
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

function parseTimestampSlug(slug: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/i.exec(
    slug,
  );
  if (!match) return null;
  const [, yyyy, mm, dd, hh, min, ss, ms] = match;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}.${ms}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

function listSnapshotGroups(): SnapshotGroup[] {
  try {
    const files = fs.readdirSync(LOCAL_POOLS_DIR);
    const datasetGroups = new Map<string, SnapshotGroup>();
    const legacyFiles: SnapshotGroup[] = [];

    for (const name of files) {
      const fullPath = path.join(LOCAL_POOLS_DIR, name);
      const stat = fs.statSync(fullPath);
      const parsedMs = parseTimestampFromFilename(name);
      const timestamp = new Date(parsedMs ?? stat.mtimeMs).toISOString();
      const timestampSource = parsedMs === null ? "mtime" : "filename";

      if (DATASET_REGEX.test(name)) {
        const group = datasetGroups.get(timestamp) ?? {
          timestamp,
          timestampSource,
          files: [],
        };
        group.files.push({ name, fullPath, mtimeMs: stat.mtimeMs });
        datasetGroups.set(timestamp, group);
      } else if (/^solanaPools_.*\.json(\.gz)?$/i.test(name)) {
        legacyFiles.push({
          timestamp,
          timestampSource,
          files: [{ name, fullPath, mtimeMs: stat.mtimeMs }],
        });
      }
    }

    return [...datasetGroups.values(), ...legacyFiles].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
  } catch {
    return [];
  }
}

function getSnapshotGroupsSignature(groups: SnapshotGroup[]) {
  return groups
    .flatMap((group) =>
      group.files.map((file) => `${file.name}:${file.mtimeMs}`),
    )
    .join("|");
}

function getHistoricalVolatilityByPool(datasetKey?: string) {
  if (USE_SQLITE) {
    // Under SQLite, volatility should come from payload_json written during
    // import/backfill. Avoid historical scans on request path.
    return new Map<string, number>();
  }

  const groups = listSnapshotGroups();
  const windowedGroups =
    groups.length > VOLATILITY_WINDOW
      ? groups.slice(-VOLATILITY_WINDOW)
      : groups;
  const datasetFile = datasetKey
    ? (DATASET_KEYS as Record<string, string>)[datasetKey] ?? null
    : null;
  const signature = datasetFile
    ? windowedGroups
        .flatMap((group) =>
          group.files
            .filter((file) => file.name.startsWith(`${datasetFile}_`))
            .map((file) => `${file.name}:${file.mtimeMs}`),
        )
        .join("|")
    : getSnapshotGroupsSignature(windowedGroups);
  if (
    historicalVolatilityCache?.signature === signature &&
    historicalVolatilityCache.datasetKey === (datasetKey ?? null)
  ) {
    return historicalVolatilityCache.byPool;
  }

  const pricesByPool = new Map<string, { timestamp: string; price: number }[]>();

  const volatilityStart = nowMs();
  for (const group of windowedGroups) {
    try {
      const merged: any[] = [];
      const files = datasetFile
        ? group.files.filter((file) => file.name.startsWith(`${datasetFile}_`))
        : group.files;
      if (!files.length) continue;
      for (const file of files) {
        const raw = readJsonFile(file.fullPath);
        if (Array.isArray(raw)) merged.push(...raw);
      }
      const deduped = dedupeRawPools(merged);

      for (const entry of deduped) {
        const poolId = getRawPoolId(entry);
        const price = Number.parseFloat(
          String(entry?.price ?? entry?.raw?.current_price ?? entry?.raw?.price ?? ""),
        );
        if (!poolId || !Number.isFinite(price) || price <= 0) continue;
        const list = pricesByPool.get(poolId) ?? [];
        list.push({ timestamp: group.timestamp, price });
        pricesByPool.set(poolId, list);
      }
    } catch (e) {
      console.warn("[TRAXR-SOLANA] volatility snapshot parse failed", e);
    }
  }
  logTiming("volatility snapshot scan", volatilityStart);

  const byPool = new Map<string, number>();
  for (const [poolId, series] of pricesByPool.entries()) {
    const prices = series
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      .slice(-VOLATILITY_WINDOW)
      .map((point) => point.price);
    const volatility = deriveVolatilityFromPrices(prices);
    if (volatility !== null) byPool.set(poolId, volatility);
  }

  historicalVolatilityCache = { signature, byPool, datasetKey: datasetKey ?? null };
  return byPool;
}

function resolveDatasetPath(datasetKey: string) {
  const datasetFile =
    (DATASET_KEYS as Record<string, string>)[datasetKey] ?? null;
  if (!datasetFile) return null;

  const isEmptySnapshotFile = (fullPath: string) => {
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > 32) return false;
      const data = readJsonFile(fullPath);
      return Array.isArray(data) && data.length === 0;
    } catch {
      return false;
    }
  };

  try {
    const files = fs.readdirSync(LOCAL_POOLS_DIR);
    const candidates = files
      .filter((name) =>
        name.toLowerCase().startsWith(`${datasetFile.toLowerCase()}_`),
      )
      .map((name) => {
        const fullPath = path.join(LOCAL_POOLS_DIR, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          fullPath,
          mtimeMs: stat.mtimeMs,
          stampMs: parseTimestampFromFilename(name),
        };
      })
      .sort((a, b) => {
        const aMs = a.stampMs ?? a.mtimeMs;
        const bMs = b.stampMs ?? b.mtimeMs;
        return bMs - aMs;
      });
    if (!candidates.length) return null;
    const nonEmpty = candidates.find((candidate) => !isEmptySnapshotFile(candidate.fullPath));
    return (nonEmpty ?? candidates[0])?.fullPath ?? null;
  } catch {
    return null;
  }
}

function getDatasetSnapshotIso(datasetKey: string) {
  if (USE_SQLITE) {
    const sqliteKey = resolveSqliteKey(datasetKey);
    return sqliteKey ? getLatestSnapshotIso(sqliteKey) : null;
  }
  const datasetPath = resolveDatasetPath(datasetKey);
  if (!datasetPath) return null;
  const snapshotMs = parseTimestampFromFilename(path.basename(datasetPath));
  return snapshotMs ? new Date(snapshotMs).toISOString() : null;
}

function resolveLocalPoolsSource(): {
  paths: string[];
  snapshotIso: string | null;
} {
  if (USE_SQLITE) {
    return { paths: [], snapshotIso: null };
  }
  if (LOCAL_POOLS_PATH) {
    const snapshotMs = parseTimestampFromFilename(
      path.basename(LOCAL_POOLS_PATH),
    );
    return {
      paths: [LOCAL_POOLS_PATH],
      snapshotIso: snapshotMs ? new Date(snapshotMs).toISOString() : null,
    };
  }

  try {
    const files = fs.readdirSync(LOCAL_POOLS_DIR);
    const datasetGroups = new Map<
      string,
      { stampMs: number; files: Map<string, string> }
    >();

    for (const name of files) {
      const match = name.match(DATASET_REGEX);
      if (!match) continue;
      const datasetName = match[1];
      const slug = match[2];
      const stampMs = parseTimestampSlug(slug);
      if (!stampMs) continue;
      const group = datasetGroups.get(slug) ?? {
        stampMs,
        files: new Map<string, string>(),
      };
      group.files.set(datasetName, path.join(LOCAL_POOLS_DIR, name));
      datasetGroups.set(slug, group);
    }

    if (datasetGroups.size) {
      const groups = Array.from(datasetGroups.entries()).sort((a, b) => {
        const aMs = a[1].stampMs;
        const bMs = b[1].stampMs;
        if (aMs !== bMs) return bMs - aMs;
        return b[1].files.size - a[1].files.size;
      });

      const [slug, group] = groups[0];
      const paths = DATASET_FILES.map((name) => group.files.get(name)).filter(
        Boolean,
      ) as string[];
      return {
        paths,
        snapshotIso: new Date(group.stampMs).toISOString(),
      };
    }

    const candidates = files
      .filter((name) => /^solanaPools_.*\.json$/i.test(name))
      .map((name) => {
        const fullPath = path.join(LOCAL_POOLS_DIR, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          fullPath,
          mtimeMs: stat.mtimeMs,
          stampMs: parseTimestampFromFilename(name),
        };
      })
      .sort((a, b) => {
        const aMs = a.stampMs ?? a.mtimeMs;
        const bMs = b.stampMs ?? b.mtimeMs;
        return bMs - aMs;
      });

    if (candidates.length) {
      const latest = candidates[0];
      return {
        paths: [latest.fullPath],
        snapshotIso: latest.stampMs
          ? new Date(latest.stampMs).toISOString()
          : null,
      };
    }
  } catch {}

  const legacyJson = path.join(LOCAL_POOLS_DIR, "solanaPools.json");
  const legacyGz = `${legacyJson}.gz`;
  return {
    paths: [fs.existsSync(legacyGz) ? legacyGz : legacyJson],
    snapshotIso: null,
  };
}

function loadLocalPools(): any[] {
  if (USE_SQLITE) {
    const all: any[] = [];
    for (const datasetKey of listSqliteDatasets()) {
      all.push(...getLatestPools(datasetKey));
    }
    if (!all.length) return [];
    const deduped = dedupeRawPools(all);
    console.warn(
      `[TRAXR-SOLANA] Loaded ${deduped.length} deduped pools from sqlite`,
    );
    return deduped;
  }
  const resolved = resolveLocalPoolsSource();
  const validPaths = resolved.paths.filter((filePath) =>
    fs.existsSync(filePath),
  );
  if (!validPaths.length) return [];

  try {
    const snapshotIso = resolved.snapshotIso;
    const all: any[] = [];
    for (const filePath of validPaths) {
      const raw = readJsonFile(filePath);
      if (!Array.isArray(raw)) continue;
      all.push(...raw);
    }

    if (!all.length) return [];
    const deduped = dedupeRawPools(all);
    console.warn(
      `[TRAXR-SOLANA] Loaded ${deduped.length} deduped pools from ${validPaths.join(", ")}`,
    );
    if (!snapshotIso) return deduped;
    return deduped.map((entry) => ({
      ...entry,
      poolUpdatedAt:
        typeof entry.poolUpdatedAt === "string"
          ? entry.poolUpdatedAt
          : snapshotIso,
    }));
  } catch (e) {
    console.warn("[TRAXR-SOLANA] Failed to load local pools", e);
  }

  return [];
}

/* ---------------------------------- */
/* NORMALIZATION (MOST IMPORTANT)      */
/* ---------------------------------- */

export function normalizePool(
  p: any,
  context: NormalizeContext = { solUsd: null, volatilityByPool: null },
): SolanaPoolMetrics {
  const toString = (value: any, fallback: string) => {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return fallback;
    if (typeof value === "object" && typeof value.address === "string") {
      return value.address;
    }
    return String(value);
  };
  const toNumber = (value: any): number | null => {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const resolveMint = (value: any, fallback: string) => {
    if (value && typeof value === "object") {
      return {
        mint: toString(value.address ?? value.mint, fallback),
        symbol: toString(value.symbol, ""),
        name: toString(value.name, ""),
        logo: sanitizeTokenLogoUrl(toString(value.logoURI ?? value.imageUrl, "")),
        decimals: toNumber(value.decimals),
      };
    }
    return {
      mint: toString(value, fallback),
      symbol: "",
      name: "",
      logo: "",
      decimals: null,
    };
  };

  const mintAResolved = resolveMint(
    p.mintA ?? p.tokenA ?? p.tokenMintA ?? p.symbolA,
    "UNKNOWN",
  );
  const mintBResolved = resolveMint(
    p.mintB ?? p.tokenB ?? p.tokenMintB ?? p.symbolB,
    "SINGLE",
  );
  const mintA = mintAResolved.mint;
  const mintB = mintBResolved.mint;
  const poolId = toString(
    p.poolId ?? p.poolRef ?? p.id ?? p.address,
    `${mintA}_${mintB}`,
  );
  const poolUpdatedAt =
    typeof p.poolUpdatedAt === "string"
      ? p.poolUpdatedAt
      : typeof p.updatedAt === "string"
        ? p.updatedAt
        : undefined;
  const poolType = Array.isArray(p.pooltype)
    ? p.pooltype[0]
    : (p.poolType ?? p.type ?? null);
  const isOrca = p.poolType === "whirlpool" || !!p.whirlpoolsConfig;
  const isMeteora = p.poolType === "dlmm" || p.source === "meteora";
  const meteoraName =
    isMeteora && typeof p.raw?.name === "string" ? p.raw.name : null;
  const meteoraTokens =
    meteoraName && meteoraName.includes("-")
      ? meteoraName.split("-").map((part: string) => part.trim()).filter(Boolean)
      : null;

  const tokenASymbol =
    p.tokenASymbol ??
    p.mintA_symbol ??
    p.symbolA ??
    (mintAResolved.symbol || undefined) ??
    (meteoraTokens ? meteoraTokens[0] : undefined);
  const tokenBSymbol =
    p.tokenBSymbol ??
    p.mintB_symbol ??
    p.symbolB ??
    (mintBResolved.symbol || undefined) ??
    (meteoraTokens && meteoraTokens.length > 1
      ? meteoraTokens[1]
      : undefined);
  const raydiumVolume24hUsd = selectRaydiumVolumeUsd(
    toNumber(p.day?.volume),
    toNumber(p.day?.volumeQuote),
    tokenASymbol ?? "",
    tokenBSymbol ?? "",
    context.solUsd,
  );
  const raydiumVolume7dUsd = selectRaydiumVolumeUsd(
    toNumber(p.week?.volume),
    toNumber(p.week?.volumeQuote),
    tokenASymbol ?? "",
    tokenBSymbol ?? "",
    context.solUsd,
  );
  const liquidityUsd = (() => {
    if (isOrca) return toNumber(p.tvlUsdc) ?? 0;
    if (isMeteora) return toNumber(p.raw?.tvl ?? p.raw?.liquidity) ?? 0;
    return (
      toNumber(
        p.tvl ??
          p.tvlUsd ??
          p.tvl_usd ??
          p.liquidity ??
          p.liquidityUsd ??
          p.reserveUsd ??
          p.reserve_in_usd,
      ) ?? 0
    );
  })();
  const feePct = (() => {
    if (isOrca) {
      const raw = toNumber(p.feeRate);
      return raw === null ? null : raw / 10000;
    }
    if (isMeteora) {
      return (
        toNumber(
          p.raw?.pool_config?.base_fee_pct ??
            p.raw?.dynamic_fee_pct ??
            p.raw?.base_fee_percentage ??
            p.raw?.max_fee_percentage,
        ) ?? null
      );
    }
    const explicitFeePct = toNumber(p.feePct ?? p.fee_percentage);
    if (explicitFeePct !== null) return explicitFeePct;
    const raw = toNumber(
      p.feeRate ??
        p.config?.tradeFeeRate ??
        p.poolFeePercentage ??
        p.pool_fee_percentage ??
        p.feePct ??
        p.fee_percentage,
    );
    if (raw === null) return null;
    if (raw <= 1) return raw * 100;
    return raw / 10000;
  })();
  const priceImpactPct = estimatePriceImpactPct(p, {
    isOrca,
    isMeteora,
    liquidityUsd,
    feePct,
  });

  return {
    poolId,
    poolName: p.poolName || p.name || p.pool_name,
    poolType,
    mintA,
    mintB,
    poolProgramId: p.programId ?? p.ammProgramId ?? p.whirlpoolsConfig ?? null,
    poolUpdatedAt,
    source: p.source ?? null,

    tokenAName:
      p.tokenAName ??
      p.mintA_name ??
      p.tokenNameA ??
      (mintAResolved.name || undefined) ??
      (meteoraTokens ? meteoraTokens[0] : undefined),
    tokenASymbol:
      tokenASymbol,
    tokenALogo:
      sanitizeTokenLogoUrl(p.tokenALogo) ??
      sanitizeTokenLogoUrl(p.mintA_logo) ??
      (mintAResolved.logo || null),
    tokenBName:
      p.tokenBName ??
      p.mintB_name ??
      p.tokenNameB ??
      (mintBResolved.name || undefined) ??
      (meteoraTokens && meteoraTokens.length > 1
        ? meteoraTokens[1]
        : undefined),
    tokenBSymbol:
      tokenBSymbol,
    tokenBLogo:
      sanitizeTokenLogoUrl(p.tokenBLogo) ??
      sanitizeTokenLogoUrl(p.mintB_logo) ??
      (mintBResolved.logo || null),
    decimalsMintA: toNumber(p.decimalsMintA) ?? mintAResolved.decimals,
    decimalsMintB: toNumber(p.decimalsMintB) ?? mintBResolved.decimals,

    liquidityUsd,
    volume24hUsd: (() => {
      if (!isOrca && !isMeteora) {
        const sourceUsd = toNumber(p.day?.volume);
        if (sourceUsd !== null) return sourceUsd;
      }
      const explicitUsd = toNumber(
        p.volume24hUsd ??
          p.volume_usd?.h24 ??
          p.volume_usd_24h ??
          p.volume24hUSD ??
          p.raw?.trade_volume_24h ??
          p.raw?.volume?.["24h"] ??
          p.raw?.volume?.hour_24 ??
          p.stats?.["24h"]?.volume,
      );
      if (explicitUsd !== null) return explicitUsd;
      if (isOrca) {
        return toNumber(p.stats?.["24h"]?.volume);
      }
      if (isMeteora) return null;
      return raydiumVolume24hUsd;
    })(),
    volume7dUsd: isOrca || isMeteora
      ? null
      : (() => {
          const sourceUsd = toNumber(p.week?.volume);
          if (sourceUsd !== null) return sourceUsd;
          return (
            toNumber(
              p.volume7d ??
                p.volume7dUsd ??
                p.volume_usd?.h7 ??
                p.volume_usd_7d ??
                p.volume7dUSD,
            ) ?? raydiumVolume7dUsd
          );
        })(),
    tx24h: toNumber(
      p.day?.txCount ??
        p.tx24h ??
        p.txCount24h ??
        p.txCount,
    ) ?? 0,
    tx7d: toNumber(p.week?.txCount ?? p.tx7d ?? p.txCount7d),
    lockedPct: toNumber(
      p.lockedPct ??
        p.lockedLiquidityPct ??
        p.locked_liquidity_percentage,
    ),
    feePct,
    priceImpactPct,
    volatilityPct:
      toNumber(p.volatilityPct ?? p.volatility) ??
      context.volatilityByPool?.get(poolId) ??
      null,
    dataAgeHours: (() => {
      const explicit = toNumber(p.dataAgeHours ?? p.data_age_hours);
      if (explicit !== null) return explicit;
      if (!poolUpdatedAt) return 0;
      const updatedMs = Date.parse(poolUpdatedAt);
      if (Number.isNaN(updatedMs)) return 0;
      return Math.max(0, (Date.now() - updatedMs) / (60 * 60 * 1000));
    })(),
    burnPct: toNumber(p.burnPercent ?? p.burn_percentage),
    priceMin24h: toNumber(p.day?.priceMin),
    priceMax24h: toNumber(p.day?.priceMax),
    feeApr24h: toNumber(p.day?.feeApr),
    feeApr7d: toNumber(p.week?.feeApr),

    ctsScore: toNumber(p.ctsScore),
    ctsNodes: toNumber(p.ctsNodes),
  };
}
