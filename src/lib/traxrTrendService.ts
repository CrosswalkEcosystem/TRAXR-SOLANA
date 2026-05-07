import fs from "fs";
import path from "path";
import zlib from "zlib";

import { buildWarnings, toScoreResult } from "./scoringAdapter";
import { TraxrTrendPoint } from "./types";
import {
  buildNormalizeContext,
  deriveVolatilityFromPrices,
  normalizePool,
} from "./traxrService";
import { getPoolHistory, getSqliteCacheSignature } from "./traxrSqliteService";

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

type TrendCache = {
  signature: string;
  byPool: Map<string, TraxrTrendPoint[]>;
};

let trendCache: TrendCache | null = null;
const poolDatasetCache = new Map<string, string | null>();
const TIMINGS_ENABLED = process.env.TRAXR_TIMINGS === "true";
const TREND_WINDOW = Number(process.env.TRAXR_TREND_WINDOW || "0");
const TREND_CACHE_LIMIT = Number(process.env.TRAXR_TREND_CACHE_LIMIT || "60");
const USE_SQLITE = process.env.TRAXR_USE_SQLITE === "true";
let latestDatasetPathCache: { signature: string; byFile: Map<string, string | null> } | null = null;
const snapshotCache = new Map<string, { mtimeMs: number; data: any[] }>();

function nowMs() {
  return Number(process.hrtime.bigint()) / 1_000_000;
}

function logTiming(label: string, startMs: number) {
  if (!TIMINGS_ENABLED) return;
  const elapsed = nowMs() - startMs;
  console.log(`[TRAXR-SOLANA] ${label} ${elapsed.toFixed(1)}ms`);
}

function readJsonFile(filePath: string) {
  const raw = fs.readFileSync(filePath);
  const text = filePath.endsWith(".gz")
    ? zlib.gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
  return JSON.parse(text);
}

function readJsonFileCached(filePath: string) {
  const stat = fs.statSync(filePath);
  const cached = snapshotCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.data;
  }
  const data = readJsonFile(filePath);
  snapshotCache.set(filePath, { mtimeMs: stat.mtimeMs, data });
  if (snapshotCache.size > TREND_CACHE_LIMIT) {
    const excess = snapshotCache.size - TREND_CACHE_LIMIT;
    let dropped = 0;
    for (const key of snapshotCache.keys()) {
      snapshotCache.delete(key);
      dropped += 1;
      if (dropped >= excess) break;
    }
  }
  return data;
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

function parseTimestampFromName(
  name: string,
  mtimeMs: number,
): { timestamp: string; source: "filename" | "mtime" } {
  const normalized = name.endsWith(".gz") ? name.slice(0, -3) : name;
  const datasetMatch = normalized.match(DATASET_REGEX);
  if (datasetMatch) {
    const stampMs = parseTimestampSlug(datasetMatch[2]);
    if (stampMs) {
      return { timestamp: new Date(stampMs).toISOString(), source: "filename" };
    }
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
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      return { timestamp: date.toISOString(), source: "filename" };
    }
  }

  const match = normalized.match(/solanaPools_(\d{8})_(\d{6})Z\.json/i);
  if (match) {
    const [yyyymmdd, hhmmss] = [match[1], match[2]];
    const yyyy = yyyymmdd.slice(0, 4);
    const mm = yyyymmdd.slice(4, 6);
    const dd = yyyymmdd.slice(6, 8);
    const hh = hhmmss.slice(0, 2);
    const min = hhmmss.slice(2, 4);
    const ss = hhmmss.slice(4, 6);
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}Z`;
    const date = new Date(iso);
    if (!Number.isNaN(date.getTime())) {
      return { timestamp: date.toISOString(), source: "filename" };
    }
  }
  return { timestamp: new Date(mtimeMs).toISOString(), source: "mtime" };
}

function listSnapshotGroups() {
  try {
    const files = fs.readdirSync(LOCAL_POOLS_DIR);
    const datasetGroups = new Map<
      string,
      {
        timestamp: string;
        timestampSource: "filename" | "mtime";
        files: { name: string; fullPath: string; mtimeMs: number }[];
      }
    >();
    const legacyFiles: {
      name: string;
      fullPath: string;
      mtimeMs: number;
      timestamp: string;
      timestampSource: "filename" | "mtime";
    }[] = [];

    for (const name of files) {
      const fullPath = path.join(LOCAL_POOLS_DIR, name);
      const stat = fs.statSync(fullPath);
      const parsed = parseTimestampFromName(name, stat.mtimeMs);

      if (DATASET_REGEX.test(name)) {
        const group = datasetGroups.get(parsed.timestamp) ?? {
          timestamp: parsed.timestamp,
          timestampSource: parsed.source,
          files: [],
        };
        group.files.push({ name, fullPath, mtimeMs: stat.mtimeMs });
        datasetGroups.set(parsed.timestamp, group);
      } else if (/^solanaPools_.*\.json(\.gz)?$/i.test(name)) {
        legacyFiles.push({
          name,
          fullPath,
          mtimeMs: stat.mtimeMs,
          timestamp: parsed.timestamp,
          timestampSource: parsed.source,
        });
      }
    }

    const groups = Array.from(datasetGroups.values()).map((group) => ({
      timestamp: group.timestamp,
      timestampSource: group.timestampSource,
      files: group.files,
    }));

    for (const legacy of legacyFiles) {
      groups.push({
        timestamp: legacy.timestamp,
        timestampSource: legacy.timestampSource,
        files: [
          {
            name: legacy.name,
            fullPath: legacy.fullPath,
            mtimeMs: legacy.mtimeMs,
          },
        ],
      });
    }

    return groups.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}

function getTrendCacheSignature() {
  if (USE_SQLITE) {
    return getSqliteCacheSignature();
  }
  const groups = listSnapshotGroups();
  return groups
    .flatMap((group) =>
      group.files.map((file) => `${file.name}:${file.mtimeMs}`),
    )
    .join("|");
}

function resolveLatestDatasetPath(datasetFile: string) {
  try {
    const files = fs.readdirSync(LOCAL_POOLS_DIR);
    const candidates = files
      .filter((name) => name.toLowerCase().startsWith(`${datasetFile}_`.toLowerCase()))
      .filter((name) => name.endsWith(".json") || name.endsWith(".json.gz"))
      .map((name) => {
        const fullPath = path.join(LOCAL_POOLS_DIR, name);
        const stat = fs.statSync(fullPath);
        const match = name.match(DATASET_REGEX);
        const stampMs = match ? parseTimestampSlug(match[2]) : null;
        return {
          fullPath,
          stampMs: stampMs ?? stat.mtimeMs,
        };
      })
      .sort((a, b) => b.stampMs - a.stampMs);
    return candidates[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

function getLatestDatasetPaths() {
  try {
    const files = fs.readdirSync(LOCAL_POOLS_DIR);
    const signature = files
      .filter((name) => name.endsWith(".json") || name.endsWith(".json.gz"))
      .map((name) => {
        const fullPath = path.join(LOCAL_POOLS_DIR, name);
        const stat = fs.statSync(fullPath);
        return `${name}:${stat.mtimeMs}`;
      })
      .join("|");
    if (latestDatasetPathCache?.signature === signature) {
      return latestDatasetPathCache.byFile;
    }
    const byFile = new Map<string, string | null>();
    for (const datasetFile of DATASET_FILES) {
      byFile.set(datasetFile, resolveLatestDatasetPath(datasetFile));
    }
    latestDatasetPathCache = { signature, byFile };
    return byFile;
  } catch {
    return new Map();
  }
}

function findPoolDatasetFile(poolId: string) {
  if (poolDatasetCache.has(poolId)) {
    return poolDatasetCache.get(poolId) ?? null;
  }
  const latestByFile = getLatestDatasetPaths();
  for (const datasetFile of DATASET_FILES) {
    const latestPath = latestByFile.get(datasetFile) ?? null;
    if (!latestPath) continue;
    try {
      const raw = readJsonFile(latestPath);
      if (!Array.isArray(raw)) continue;
      if (raw.some((entry) => getRawPoolId(entry) === poolId)) {
        poolDatasetCache.set(poolId, datasetFile);
        return datasetFile;
      }
    } catch {
      continue;
    }
  }
  poolDatasetCache.set(poolId, null);
  return null;
}

function getRawPoolId(entry: any) {
  if (typeof entry?.id === "string") return entry.id;
  if (typeof entry?.poolId === "string") return entry.poolId;
  if (typeof entry?.address === "string") return entry.address;
  return null;
}

function recomputeLatestPointAsCurrent(series: TraxrTrendPoint[]) {
  if (!series.length) return series;
  const latest = series[series.length - 1];
  const updatedAt =
    typeof latest.metrics.poolUpdatedAt === "string"
      ? latest.metrics.poolUpdatedAt
      : latest.timestamp;
  const updatedMs = Date.parse(updatedAt);
  latest.metrics.dataAgeHours = Number.isNaN(updatedMs)
    ? 0
    : Math.max(0, (Date.now() - updatedMs) / (60 * 60 * 1000));
  const { score, nodes, ctsNodes } = toScoreResult(latest.metrics);
  latest.score = score;
  latest.nodes = nodes;
  latest.ctsNodes = ctsNodes;
  latest.warnings = buildWarnings(latest.metrics, nodes);
  return series;
}

function stripEmbeddedScoreMetrics(point: TraxrTrendPoint) {
  delete point.metrics.ctsScore;
  delete point.metrics.ctsNodes;
  return point;
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

function buildTrendSeries(poolId: string, datasetKey?: string): TraxrTrendPoint[] {
  if (!poolId) return [];
  if (USE_SQLITE) {
    const history = getPoolHistory(poolId);
    if (!history.length) return [];
    const series: { point: TraxrTrendPoint; price: number | null }[] = [];
    const buildStart = nowMs();
    for (const item of history) {
      const snapshotTimestamp = item.snapshotTs;
      const normalized = normalizePool(
        {
          ...item.entry,
          poolUpdatedAt:
            typeof item.entry.poolUpdatedAt === "string"
              ? item.entry.poolUpdatedAt
              : snapshotTimestamp,
        },
        { solUsd: null, volatilityByPool: null },
      );
      // Trend points should be scored as-of their own snapshot, not as stale
      // relative to "now", otherwise old history collapses toward zero.
      normalized.dataAgeHours = 0;
      const { score, nodes, ctsNodes } = toScoreResult(normalized);
      const warnings = buildWarnings(normalized, nodes);
      const price = Number.parseFloat(
        String(
          item.entry?.price ??
            item.entry?.raw?.current_price ??
            item.entry?.raw?.price ??
            "",
        ),
      );
      series.push({
        point: {
          score,
          nodes,
          ctsNodes,
          warnings,
          timestamp: snapshotTimestamp,
          metrics: normalized,
        },
        price: Number.isFinite(price) && price > 0 ? price : null,
      });
    }
    logTiming("trend build series", buildStart);
    series.sort((a, b) => a.point.timestamp.localeCompare(b.point.timestamp));
    const finalized = series.map((entry, idx, all) => {
      if (entry.point.metrics.volatilityPct === null) {
        const prices = all
          .slice(Math.max(0, idx - 29), idx + 1)
          .map((item) => item.price)
          .filter((price): price is number => price !== null);
        const volatility = deriveVolatilityFromPrices(prices);
        if (volatility !== null) {
          entry.point.metrics.volatilityPct = volatility;
          const { score, nodes, ctsNodes } = toScoreResult(entry.point.metrics);
          entry.point.score = score;
          entry.point.nodes = nodes;
          entry.point.ctsNodes = ctsNodes;
          entry.point.warnings = buildWarnings(entry.point.metrics, nodes);
        }
      }
      return stripEmbeddedScoreMetrics(entry.point);
    });
    return recomputeLatestPointAsCurrent(finalized);
  }
  const allGroups = listSnapshotGroups();
  const groups =
    Number.isFinite(TREND_WINDOW) && TREND_WINDOW > 0
      ? allGroups.slice(-TREND_WINDOW)
      : allGroups;
  const datasetFile = datasetKey
    ? DATASET_KEYS[datasetKey as keyof typeof DATASET_KEYS] ?? null
    : findPoolDatasetFile(poolId);
  const series: { point: TraxrTrendPoint; price: number | null }[] = [];

  const buildStart = nowMs();
  for (const group of groups) {
    try {
      const merged: any[] = [];
      const files = datasetFile
        ? group.files.filter((file) => file.name.startsWith(`${datasetFile}_`))
        : group.files;
      if (!files.length) continue;
      for (const file of files) {
        const raw = readJsonFileCached(file.fullPath);
        if (!Array.isArray(raw)) continue;
        merged.push(...raw);
      }

      if (!merged.length) continue;
      const deduped = dedupeRawPools(merged);
      const context = buildNormalizeContext(deduped);
      const matches = deduped.filter((entry) => getRawPoolId(entry) === poolId);
      if (!matches.length) continue;

      let snapshotTimestamp = group.timestamp;
      if (group.timestampSource === "mtime") {
        const candidate = merged.find((entry) => entry?.poolUpdatedAt)?.poolUpdatedAt;
        const parsed = candidate ? new Date(candidate) : null;
        if (parsed && !Number.isNaN(parsed.getTime())) {
          snapshotTimestamp = parsed.toISOString();
        }
      }

      for (const entry of matches) {
        const normalized = normalizePool(entry, context);
        normalized.dataAgeHours = 0;
        const { score, nodes, ctsNodes } = toScoreResult(normalized);
        const warnings = buildWarnings(normalized, nodes);

        const point: TraxrTrendPoint = {
          timestamp: snapshotTimestamp,
          score,
          ctsNodes,
          nodes,
          warnings,
          metrics: normalized,
        };
        const price = Number.parseFloat(
          String(entry?.price ?? entry?.raw?.current_price ?? entry?.raw?.price ?? ""),
        );
        series.push({
          point,
          price: Number.isFinite(price) && price > 0 ? price : null,
        });
      }
    } catch (e) {
      console.warn("[TRAXR-SOLANA] trend snapshot parse failed", e);
    }
  }
  logTiming("trend build series", buildStart);
  series.sort((a, b) => a.point.timestamp.localeCompare(b.point.timestamp));

  const finalized = series.map((entry, idx, all) => {
    if (entry.point.metrics.volatilityPct === null) {
      const prices = all
        .slice(Math.max(0, idx - 29), idx + 1)
        .map((item) => item.price)
        .filter((price): price is number => price !== null);
      const volatility = deriveVolatilityFromPrices(prices);
      if (volatility !== null) {
        entry.point.metrics.volatilityPct = volatility;
        const { score, nodes, ctsNodes } = toScoreResult(entry.point.metrics);
        entry.point.score = score;
        entry.point.nodes = nodes;
        entry.point.ctsNodes = ctsNodes;
        entry.point.warnings = buildWarnings(entry.point.metrics, nodes);
      }
    }
    return stripEmbeddedScoreMetrics(entry.point);
  });
  return recomputeLatestPointAsCurrent(finalized);
}

export function getPoolTrend(poolId: string, datasetKey?: string): TraxrTrendPoint[] {
  if (!poolId) return [];
  const signature = getTrendCacheSignature();
  if (!trendCache || trendCache.signature !== signature) {
    trendCache = { signature, byPool: new Map() };
  }
  const cacheKey = datasetKey ? `${datasetKey}:${poolId}` : poolId;
  const cached = trendCache.byPool.get(cacheKey);
  if (cached) return cached;
  const trendStart = nowMs();
  const series = buildTrendSeries(poolId, datasetKey);
  logTiming(`trend ${poolId}`, trendStart);
  trendCache.byPool.set(cacheKey, series);
  return series;
}
