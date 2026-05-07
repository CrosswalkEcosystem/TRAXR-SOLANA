#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_DIR =
  process.env.TRAXR_SQLITE_DIR || path.join(DATA_DIR, "sqlite");
const MANIFEST_PATH =
  process.env.TRAXR_SQLITE_MANIFEST_PATH ||
  path.join(OUT_DIR, "sqlite.manifest.json");
const DATASET_FILE_RE =
  /^(amm\.live\.json|clmm\.live\.json|cpmm\.live\.json|orca\.live\.json|meteora\.dlmm\.live\.json|meteora\.dammv2\.live\.json|other\.live\.json)_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json(?:\.gz)?$/i;

const DB_FILE_BY_DATASET = {
  "amm.live.json": "amm.sqlite",
  "clmm.live.json": "clmm.sqlite",
  "cpmm.live.json": "cpmm.sqlite",
  "orca.live.json": "orca.sqlite",
  "meteora.dlmm.live.json": "meteora.sqlite",
  "meteora.dammv2.live.json": "meteora-dammv2.sqlite",
  "other.live.json": "other.sqlite",
};
const VOLATILITY_WINDOW = 30;
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
  tradeSizeUsd: 1_000,
};

function readManifest() {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) return { datasets: {}, updatedAt: null };
    const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    return {
      datasets:
        raw && typeof raw === "object" && raw.datasets && typeof raw.datasets === "object"
          ? raw.datasets
          : {},
      updatedAt:
        raw && typeof raw === "object" && typeof raw.updatedAt === "string"
          ? raw.updatedAt
          : null,
    };
  } catch {
    return { datasets: {}, updatedAt: null };
  }
}

function writeManifest(datasets) {
  const payload = {
    updatedAt: new Date().toISOString(),
    datasets,
  };
  const tempPath = `${MANIFEST_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, MANIFEST_PATH);
}

function parseArgs(argv) {
  const datasetIndex = argv.indexOf("--dataset");
  const latestOnly = argv.includes("--latest");
  const replace = argv.includes("--replace");
  const fileIndex = argv.indexOf("--file");
  const backfillVolatilityState = argv.includes("--backfill-volatility-state");
  const rawFile =
    fileIndex >= 0 && argv[fileIndex + 1] ? argv[fileIndex + 1] : null;
  return {
    dataset:
      datasetIndex >= 0 && argv[datasetIndex + 1]
        ? argv[datasetIndex + 1]
        : null,
    latestOnly,
    replace,
    backfillVolatilityState,
    file: rawFile ? path.basename(rawFile) : null,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/build_snapshot_sqlite.js
  node scripts/build_snapshot_sqlite.js --latest
  node scripts/build_snapshot_sqlite.js --dataset orca.live.json
  node scripts/build_snapshot_sqlite.js --file orca.live.json_2026-03-18T122443002Z.json
  node scripts/build_snapshot_sqlite.js --backfill-volatility-state
  node scripts/build_snapshot_sqlite.js --backfill-volatility-state --dataset amm.live.json
  node scripts/build_snapshot_sqlite.js --replace

Builds SQLite DB files from stamped JSON snapshots without deleting the JSONs.
Outputs DB files under: data/sqlite/
`);
}

function listSnapshotFiles() {
  return fs
    .readdirSync(DATA_DIR)
    .map((name) => {
      const match = name.match(DATASET_FILE_RE);
      if (!match) return null;
      return {
        name,
        dataset: match[1],
        slug: match[2],
        fullPath: path.join(DATA_DIR, name),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.dataset === b.dataset) return a.slug.localeCompare(b.slug);
      return a.dataset.localeCompare(b.dataset);
    });
}

function selectFiles(files, opts) {
  let selected = files;
  if (opts.dataset) {
    selected = selected.filter((file) => file.dataset === opts.dataset);
  }
  if (opts.file) {
    selected = selected.filter((file) => file.name === opts.file);
  }
  if (opts.latestOnly) {
    const latest = new Map();
    for (const file of selected) {
      const prev = latest.get(file.dataset);
      if (!prev || file.slug > prev.slug) {
        latest.set(file.dataset, file);
      }
    }
    selected = Array.from(latest.values());
  }
  return selected;
}

function parseSnapshotIsoFromSlug(slug) {
  return `${slug.slice(0, 10)}T${slug.slice(11, 13)}:${slug.slice(13, 15)}:${slug.slice(15, 17)}.${slug.slice(17, 20)}Z`;
}

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

function safeLogNorm(v, denom) {
  return Math.log10(Math.max(v, 1)) / denom;
}

function impactProxyPct(liquidityUsd) {
  if (!liquidityUsd || liquidityUsd <= 0) return PARAMS.impactProxyCapPct;
  const ratio = PARAMS.tradeSizeUsd / Math.max(liquidityUsd, PARAMS.tradeSizeUsd);
  return Math.min(PARAMS.impactProxyCapPct, Math.sqrt(ratio) * 100);
}

function feeReferencePct(row) {
  const poolType = String(row.poolType ?? row.type ?? "").trim().toLowerCase();
  const source = String(row.source ?? "").trim().toLowerCase();
  if (poolType === "whirlpool" || source === "orca") return 0.1;
  if (
    poolType === "dlmm" ||
    poolType === "damm" ||
    source === "meteora" ||
    source === "meteora-damm"
  ) {
    return 0.2;
  }
  if (poolType === "clmm") return 0.1;
  return 0.3;
}

function countCTSNodes(score01) {
  return score01 === 0 ? 0 : Math.max(1, Math.round(score01 * 6));
}

function recomputeCTSRow(dataset, row) {
  const liquidityUsd = pickLiquidityUsd(dataset, row) ?? 0;
  const volume24hUsd = pickVolume24hUsd(dataset, row) ?? 0;
  const volume7dUsd = pickVolume7dUsd(dataset, row);
  const lockedPct = toNumber(
    row.lockedPct ??
      row.lockedLiquidityPct ??
      row.locked_liquidity_percentage,
  );
  const feePct = pickFeePct(dataset, row);
  const priceImpactPct = toNumber(row.priceImpactPct);
  const volatilityPct = toNumber(row.volatilityPct ?? row.volatility);

  const vol24 = volume24hUsd ?? 0;
  const vol7 = volume7dUsd ?? vol24;
  const depth = clamp01(safeLogNorm(liquidityUsd, 6));
  const activity = clamp01(
    0.6 * safeLogNorm(vol24, 6) + 0.4 * safeLogNorm(vol7 / 7, 6),
  );
  const stability = clamp01(
    1 - clamp01(((volatilityPct ?? 0) / PARAMS.volCap)),
  );

  let lockAdj = 0.5;
  if (lockedPct === null || lockedPct === undefined) lockAdj -= 0.05;
  else if (lockedPct >= 70) lockAdj += 0.07;
  else if (lockedPct < 20) lockAdj -= 0.12;
  const lockTerm = clamp01(lockAdj);
  const missingPenalty = (liquidityUsd ? 0 : 0.05) + (vol24 ? 0 : 0.05);
  const trust = clamp01(0.5 * lockTerm + 0.5 * (1 - missingPenalty));
  const feeRefPct = feeReferencePct(row);
  const fee = clamp01((feeRefPct - (feePct ?? feeRefPct)) / feeRefPct);
  const impactBase = priceImpactPct ?? impactProxyPct(liquidityUsd);
  const impact = clamp01(1 - clamp01(impactBase / PARAMS.impactScoreCapPct));

  const score01 = clamp01(
    WEIGHTS.depth * depth +
      WEIGHTS.activity * activity +
      WEIGHTS.stability * stability +
      WEIGHTS.trust * trust +
      WEIGHTS.fee * fee +
      WEIGHTS.impact * impact,
  );

  row.ctsScore = score01;
  row.ctsNodes = countCTSNodes(score01);
}

function toString(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.address === "string") return value.address;
    if (typeof value.symbol === "string") return value.symbol;
  }
  return null;
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

function pickPoolId(row) {
  return row.id || row.poolId || row.address || null;
}

function pickMintA(row) {
  return (
    toString(row.mintA) ||
    row.tokenMintA ||
    row.raw?.mint_x ||
    row.raw?.mintX ||
    null
  );
}

function pickMintB(row) {
  return (
    toString(row.mintB) ||
    row.tokenMintB ||
    row.raw?.mint_y ||
    row.raw?.mintY ||
    null
  );
}

function pickTokenASymbol(row) {
  return (
    row.tokenA?.symbol ||
    row.mintA?.symbol ||
    row.tokenASymbol ||
    row.symbolA ||
    row.raw?.symbol_x ||
    null
  );
}

function pickTokenBSymbol(row) {
  return (
    row.tokenB?.symbol ||
    row.mintB?.symbol ||
    row.tokenBSymbol ||
    row.symbolB ||
    row.raw?.symbol_y ||
    null
  );
}

function pickPrice(dataset, row) {
  if (dataset === "meteora.dlmm.live.json") {
    return toNumber(row.raw?.current_price ?? row.raw?.price ?? row.price);
  }
  return toNumber(row.price);
}

function pickLiquidityUsd(dataset, row) {
  if (dataset === "orca.live.json") {
    return toNumber(row.tvlUsdc);
  }
  if (dataset === "meteora.dlmm.live.json") {
    return toNumber(row.raw?.tvl ?? row.raw?.liquidity);
  }
  return toNumber(row.tvl ?? row.liquidityUsd ?? row.liquidity);
}

function pickVolume24hUsd(dataset, row) {
  if (dataset === "orca.live.json") {
    return toNumber(row.stats?.["24h"]?.volume);
  }
  if (dataset === "meteora.dlmm.live.json") {
    return toNumber(
      row.raw?.volume?.["24h"] ??
        row.raw?.trade_volume_24h ??
        row.raw?.volume?.hour_24,
    );
  }
  return toNumber(row.day?.volume ?? row.volume24hUsd ?? row.volume_usd?.h24);
}

function pickVolume7dUsd(dataset, row) {
  if (dataset === "orca.live.json" || dataset === "meteora.dlmm.live.json") {
    return null;
  }
  return toNumber(row.week?.volume ?? row.volume7dUsd ?? row.volume_usd?.h7);
}

function pickFeePct(dataset, row) {
  const explicitFeePct = toNumber(row.feePct ?? row.fee_percentage);
  if (explicitFeePct !== null) return explicitFeePct;
  if (dataset === "orca.live.json") {
    const raw = toNumber(row.feeRate);
    return raw === null ? null : raw / 10000;
  }
  if (dataset === "meteora.dlmm.live.json") {
    return toNumber(
      row.raw?.pool_config?.base_fee_pct ??
        row.raw?.dynamic_fee_pct ??
        row.raw?.base_fee_percentage ??
        row.raw?.max_fee_percentage,
    );
  }
  const raw = toNumber(row.feeRate ?? row.config?.tradeFeeRate);
  if (raw === null) return null;
  if (raw <= 1) return raw * 100;
  return raw / 10000;
}

function pickUpdatedAt(row) {
  return row.updatedAt || row.poolUpdatedAt || row.rewardLastUpdatedTimestamp || null;
}

function parsePriceSeries(value) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const prices = parsed
      .map((price) => toNumber(price))
      .filter((price) => Number.isFinite(price) && price > 0);
    if (prices.length > VOLATILITY_WINDOW) {
      prices.splice(0, prices.length - VOLATILITY_WINDOW);
    }
    return prices;
  } catch {
    return [];
  }
}

function loadVolatilityState(db, poolIds, snapshotTs) {
  if (!poolIds.length) {
    return {
      seriesByPool: new Map(),
      fallbackPoolIds: [],
      usableStateCount: 0,
    };
  }

  const unresolved = new Set(poolIds);
  const seriesByPool = new Map();
  const chunkSize = 900;

  for (let index = 0; index < poolIds.length; index += chunkSize) {
    const poolChunk = poolIds.slice(index, index + chunkSize);
    const placeholders = poolChunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT pool_id, last_snapshot_ts, prices_json
         FROM pool_volatility_state
         WHERE pool_id IN (${placeholders})`,
      )
      .all(...poolChunk);

    for (const row of rows) {
      if (!row.pool_id || typeof row.last_snapshot_ts !== "string") continue;
      if (row.last_snapshot_ts >= snapshotTs) continue;
      const prices = parsePriceSeries(row.prices_json);
      if (!prices.length) continue;
      seriesByPool.set(row.pool_id, prices);
      unresolved.delete(row.pool_id);
    }
  }

  return {
    seriesByPool,
    fallbackPoolIds: Array.from(unresolved),
    usableStateCount: seriesByPool.size,
  };
}

function readHistoricalPriceSeries(db, poolIds, snapshotTs) {
  if (!poolIds.length) return new Map();

  const byPool = new Map();
  const chunkSize = 900;
  let cutoffSnapshotTs = null;

  try {
    const recentSnapshots = db
      .prepare(
        `SELECT snapshot_ts
         FROM snapshots
         WHERE snapshot_ts < ?
         ORDER BY snapshot_ts DESC
         LIMIT ?`,
      )
      .all(snapshotTs, VOLATILITY_WINDOW - 1);
    if (recentSnapshots.length) {
      cutoffSnapshotTs = recentSnapshots[recentSnapshots.length - 1].snapshot_ts;
    }
  } catch {
    cutoffSnapshotTs = null;
  }

  for (let index = 0; index < poolIds.length; index += chunkSize) {
    const poolChunk = poolIds.slice(index, index + chunkSize);
    const placeholders = poolChunk.map(() => "?").join(", ");
    const sql = `SELECT pool_id, price
      FROM (
        SELECT pool_id,
               price,
               ROW_NUMBER() OVER (
                 PARTITION BY pool_id
                 ORDER BY snapshot_ts DESC, row_ordinal DESC
               ) AS rn
        FROM pools_history
        WHERE snapshot_ts < ?
          ${cutoffSnapshotTs ? "AND snapshot_ts >= ?" : ""}
          AND pool_id IN (${placeholders})
          AND price IS NOT NULL
          AND price > 0
      )
      WHERE rn <= ?
      ORDER BY pool_id, rn DESC`;
    const params = cutoffSnapshotTs
      ? [snapshotTs, cutoffSnapshotTs, ...poolChunk, VOLATILITY_WINDOW - 1]
      : [snapshotTs, ...poolChunk, VOLATILITY_WINDOW - 1];
    const rows = db.prepare(sql).all(...params);

    for (const row of rows) {
      const price = toNumber(row.price);
      if (!row.pool_id || price === null || price <= 0) continue;
      const list = byPool.get(row.pool_id) ?? [];
      list.push(price);
      if (list.length > VOLATILITY_WINDOW - 1) {
        list.splice(0, list.length - (VOLATILITY_WINDOW - 1));
      }
      byPool.set(row.pool_id, list);
    }
  }

  return byPool;
}

function applyRollingVolatility(dataset, snapshotTs, db, rows) {
  const currentPriceByPool = new Map();
  for (const row of rows) {
    const poolId = pickPoolId(row);
    const price = pickPrice(dataset, row);
    if (!poolId || price === null || price <= 0 || currentPriceByPool.has(poolId)) {
      continue;
    }
    currentPriceByPool.set(poolId, price);
  }
  const poolIds = Array.from(currentPriceByPool.keys());

  console.log(
    `[sqlite] volatility prep dataset=${dataset} snapshot=${snapshotTs} pools=${poolIds.length}`,
  );
  const {
    seriesByPool,
    fallbackPoolIds,
    usableStateCount,
  } = loadVolatilityState(db, poolIds, snapshotTs);
  const historyByPool = readHistoricalPriceSeries(db, fallbackPoolIds, snapshotTs);
  for (const [poolId, prices] of historyByPool.entries()) {
    seriesByPool.set(poolId, prices);
  }
  console.log(
    `[sqlite] volatility history loaded dataset=${dataset} snapshot=${snapshotTs} pools=${seriesByPool.size} state=${usableStateCount} fallback=${fallbackPoolIds.length}`,
  );

  const nextStateByPool = new Map();
  const volatilityByPool = new Map();
  for (const [poolId, price] of currentPriceByPool.entries()) {
    const series = [...(seriesByPool.get(poolId) ?? [])];
    series.push(price);
    if (series.length > VOLATILITY_WINDOW) {
      series.splice(0, series.length - VOLATILITY_WINDOW);
    }
    nextStateByPool.set(poolId, series);
    const volatility = deriveVolatilityFromPrices(series);
    if (volatility !== null) {
      volatilityByPool.set(poolId, volatility);
    }
  }

  for (const row of rows) {
    const poolId = pickPoolId(row);
    if (!poolId) continue;
    const volatility = volatilityByPool.get(poolId);
    if (volatility !== null && volatility !== undefined) {
      row.volatilityPct = volatility;
    } else {
      delete row.volatilityPct;
    }
  }

  return nextStateByPool;
}

function recomputeCTSSnapshot(dataset, rows) {
  for (const row of rows) {
    recomputeCTSRow(dataset, row);
  }
}

function normalizeRow(dataset, snapshotTs, row, rowOrdinal) {
  return {
    snapshot_ts: snapshotTs,
    row_ordinal: rowOrdinal,
    pool_id: pickPoolId(row),
    pool_type: row.poolType || row.type || row.source || null,
    mint_a: pickMintA(row),
    mint_b: pickMintB(row),
    token_a_symbol: pickTokenASymbol(row),
    token_b_symbol: pickTokenBSymbol(row),
    price: pickPrice(dataset, row),
    liquidity_usd: pickLiquidityUsd(dataset, row),
    volume_24h_usd: pickVolume24hUsd(dataset, row),
    volume_7d_usd: pickVolume7dUsd(dataset, row),
    fee_pct: pickFeePct(dataset, row),
    price_impact_pct: toNumber(row.priceImpactPct),
    cts_score: toNumber(row.ctsScore),
    cts_nodes: toNumber(row.ctsNodes),
    updated_at: pickUpdatedAt(row),
    payload_json: JSON.stringify(row),
  };
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath);
  const text = filePath.endsWith(".gz")
    ? zlib.gunzipSync(raw).toString("utf8")
    : raw.toString("utf8");
  return JSON.parse(text);
}

function configureDb(db) {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -200000");
  db.pragma("busy_timeout = 5000");
}

function ensureSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_ts TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  dataset TEXT NOT NULL,
  pool_count INTEGER NOT NULL,
  imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pools_history (
  snapshot_ts TEXT NOT NULL,
  row_ordinal INTEGER NOT NULL,
  pool_id TEXT NOT NULL,
  pool_type TEXT,
  mint_a TEXT,
  mint_b TEXT,
  token_a_symbol TEXT,
  token_b_symbol TEXT,
  price REAL,
  liquidity_usd REAL,
  volume_24h_usd REAL,
  volume_7d_usd REAL,
  fee_pct REAL,
  price_impact_pct REAL,
  cts_score REAL,
  cts_nodes INTEGER,
  updated_at TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (snapshot_ts, row_ordinal)
);
CREATE INDEX IF NOT EXISTS idx_pools_history_pool_time ON pools_history(pool_id, snapshot_ts);
CREATE INDEX IF NOT EXISTS idx_pools_history_snapshot ON pools_history(snapshot_ts);
CREATE INDEX IF NOT EXISTS idx_pools_history_symbols ON pools_history(token_a_symbol, token_b_symbol);
CREATE TABLE IF NOT EXISTS pool_volatility_state (
  pool_id TEXT PRIMARY KEY,
  last_snapshot_ts TEXT NOT NULL,
  prices_json TEXT NOT NULL
);
`);
}

function importFileIntoDb(fileInfo, dbPath) {
  const rows = readJsonFile(fileInfo.fullPath);
  if (!Array.isArray(rows)) {
    throw new Error(`${fileInfo.name} is not a JSON array`);
  }

  const snapshotTs = parseSnapshotIsoFromSlug(fileInfo.slug);
  const db = new Database(dbPath);
  try {
    configureDb(db);
    ensureSchema(db);
    const volatilityStateByPool = applyRollingVolatility(
      fileInfo.dataset,
      snapshotTs,
      db,
      rows,
    );
    recomputeCTSSnapshot(fileInfo.dataset, rows);

    const insertSnapshot = db.prepare(
      `INSERT OR REPLACE INTO snapshots (snapshot_ts, source_file, dataset, pool_count, imported_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const deleteSnapshotRows = db.prepare(
      `DELETE FROM pools_history WHERE snapshot_ts = ?`,
    );
    const insertHistory = db.prepare(
      `INSERT INTO pools_history (
        snapshot_ts,
        row_ordinal,
        pool_id,
        pool_type,
        mint_a,
        mint_b,
        token_a_symbol,
        token_b_symbol,
        price,
        liquidity_usd,
        volume_24h_usd,
        volume_7d_usd,
        fee_pct,
        price_impact_pct,
        cts_score,
        cts_nodes,
        updated_at,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const upsertVolatilityState = db.prepare(
      `INSERT INTO pool_volatility_state (pool_id, last_snapshot_ts, prices_json)
       VALUES (?, ?, ?)
       ON CONFLICT(pool_id) DO UPDATE
       SET last_snapshot_ts = excluded.last_snapshot_ts,
           prices_json = excluded.prices_json
       WHERE excluded.last_snapshot_ts >= pool_volatility_state.last_snapshot_ts`,
    );

    const importRows = db.transaction((normalizedRows, volatilityStates) => {
      insertSnapshot.run(
        snapshotTs,
        fileInfo.name,
        fileInfo.dataset,
        rows.length,
        new Date().toISOString(),
      );
      deleteSnapshotRows.run(snapshotTs);
      for (const normalized of normalizedRows) {
        insertHistory.run(
          normalized.snapshot_ts,
          normalized.row_ordinal,
          normalized.pool_id,
          normalized.pool_type,
          normalized.mint_a,
          normalized.mint_b,
          normalized.token_a_symbol,
          normalized.token_b_symbol,
          normalized.price,
          normalized.liquidity_usd,
          normalized.volume_24h_usd,
          normalized.volume_7d_usd,
          normalized.fee_pct,
          normalized.price_impact_pct,
          normalized.cts_score,
          normalized.cts_nodes,
          normalized.updated_at,
          normalized.payload_json,
        );
      }
      for (const [poolId, prices] of volatilityStates.entries()) {
        upsertVolatilityState.run(poolId, snapshotTs, JSON.stringify(prices));
      }
    });

    const normalizedRows = [];
    for (let i = 0; i < rows.length; i += 1) {
      const normalized = normalizeRow(fileInfo.dataset, snapshotTs, rows[i], i);
      if (normalized.pool_id) {
        normalizedRows.push(normalized);
      }
    }
    importRows(normalizedRows, volatilityStateByPool);
  } finally {
    db.close();
  }
  return rows.length;
}

function ensureOutDir() {
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }
}

function maybeRemoveExistingDb(dbPath, replace) {
  if (replace && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}

function rebuildVolatilityStateForDb(dataset, dbPath) {
  if (!fs.existsSync(dbPath)) {
    console.log(`[sqlite] volatility state skip dataset=${dataset} missing_db=${dbPath}`);
    return 0;
  }

  const db = new Database(dbPath);
  try {
    configureDb(db);
    ensureSchema(db);

    const clearState = db.prepare(`DELETE FROM pool_volatility_state`);
    const insertState = db.prepare(
      `INSERT INTO pool_volatility_state (pool_id, last_snapshot_ts, prices_json)
       VALUES (?, ?, ?)`,
    );

    const rebuild = db.transaction(() => {
      const poolIds = db
        .prepare(
          `SELECT DISTINCT pool_id
           FROM pools_history
           WHERE pool_id IS NOT NULL
             AND price IS NOT NULL
             AND price > 0
           ORDER BY pool_id`,
        )
        .pluck()
        .all();
      const chunkSize = 900;

      clearState.run();
      let inserted = 0;
      for (let index = 0; index < poolIds.length; index += chunkSize) {
        const poolChunk = poolIds.slice(index, index + chunkSize);
        const placeholders = poolChunk.map(() => "?").join(", ");
        const chunkRows = db
          .prepare(
            `SELECT pool_id, snapshot_ts, price
             FROM (
               SELECT pool_id,
                      snapshot_ts,
                      price,
                      ROW_NUMBER() OVER (
                        PARTITION BY pool_id
                        ORDER BY snapshot_ts DESC, row_ordinal DESC
                      ) AS rn
               FROM pools_history
               WHERE pool_id IN (${placeholders})
                 AND price IS NOT NULL
                 AND price > 0
             )
             WHERE rn <= ?
             ORDER BY pool_id, rn DESC`,
          )
          .all(...poolChunk, VOLATILITY_WINDOW);

        let currentPoolId = null;
        let currentSnapshotTs = null;
        let currentPrices = [];
        const flushCurrent = () => {
          if (!currentPoolId || !currentSnapshotTs || !currentPrices.length) {
            return;
          }
          insertState.run(
            currentPoolId,
            currentSnapshotTs,
            JSON.stringify(currentPrices),
          );
          inserted += 1;
        };

        for (const row of chunkRows) {
          const poolId = row.pool_id;
          const price = toNumber(row.price);
          if (!poolId || price === null || price <= 0) continue;

          if (poolId !== currentPoolId) {
            flushCurrent();
            currentPoolId = poolId;
            currentSnapshotTs = row.snapshot_ts || null;
            currentPrices = [];
          }

          if (!currentSnapshotTs && row.snapshot_ts) {
            currentSnapshotTs = row.snapshot_ts;
          }
          currentPrices.push(price);
        }

        flushCurrent();

        if (inserted > 0 && inserted % 5000 === 0) {
          console.log(
            `[sqlite] volatility state rebuild progress dataset=${dataset} pools=${inserted}/${poolIds.length}`,
          );
        }
      }

      return inserted;
    });

    console.log(
      `[sqlite] volatility state rebuild dataset=${dataset} db=${dbPath}`,
    );
    const inserted = rebuild();
    console.log(
      `[sqlite] volatility state rebuilt dataset=${dataset} pools=${inserted} window=${VOLATILITY_WINDOW}`,
    );
    return inserted;
  } finally {
    db.close();
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  ensureOutDir();
  const manifest = readManifest();

  const opts = parseArgs(args);
  if (opts.backfillVolatilityState) {
    const datasets = opts.dataset
      ? [opts.dataset]
      : Object.keys(DB_FILE_BY_DATASET);
    let rebuiltPools = 0;
    for (const dataset of datasets) {
      const dbFile = DB_FILE_BY_DATASET[dataset];
      if (!dbFile) {
        console.log(`[sqlite] skipping unsupported dataset ${dataset}`);
        continue;
      }
      const dbPath = path.join(OUT_DIR, dbFile);
      rebuiltPools += rebuildVolatilityStateForDb(dataset, dbPath);
    }
    console.log(
      `[sqlite] volatility state backfill done datasets=${datasets.length} pools=${rebuiltPools} out_dir=${OUT_DIR}`,
    );
    return;
  }

  const files = selectFiles(listSnapshotFiles(), opts);
  if (!files.length) {
    console.log("No matching snapshot files found.");
    return;
  }

  const byDataset = new Map();
  for (const file of files) {
    const arr = byDataset.get(file.dataset) || [];
    arr.push(file);
    byDataset.set(file.dataset, arr);
  }

  let totalFiles = 0;
  let totalRows = 0;
  for (const [dataset, datasetFiles] of byDataset.entries()) {
    const dbFile = DB_FILE_BY_DATASET[dataset];
    if (!dbFile) {
      console.log(`[sqlite] skipping unsupported dataset ${dataset}`);
      continue;
    }
    const dbPath = path.join(OUT_DIR, dbFile);
    maybeRemoveExistingDb(dbPath, opts.replace);
    console.log(`[sqlite] dataset=${dataset} db=${dbPath}`);
    for (const file of datasetFiles.sort((a, b) => a.slug.localeCompare(b.slug))) {
      const rows = importFileIntoDb(file, dbPath);
      totalFiles += 1;
      totalRows += rows;
      console.log(`[sqlite] imported ${rows} rows from ${file.name}`);
    }
  }

  console.log(
    `[sqlite] done files=${totalFiles} rows=${totalRows} out_dir=${OUT_DIR}`,
  );

  if (manifest && typeof manifest === "object") {
    // Placeholder hook for manifest promotion in the next step.
  }
}

main();
