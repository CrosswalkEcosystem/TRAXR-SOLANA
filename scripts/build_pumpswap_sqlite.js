#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUT_DIR =
  process.env.TRAXR_SQLITE_DIR || path.join(DATA_DIR, "sqlite");
const DATASET = "pumpswap.live.json";
const DATASET_FILE_RE =
  /^pumpswap\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)(?:\.(?:metadata|activity))?\.json(?:\.gz)?$/i;

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

function parseArgs(argv) {
  const fileIndex = argv.indexOf("--file");
  const replace = argv.includes("--replace");
  const dbIndex = argv.indexOf("--db");
  return {
    file:
      fileIndex >= 0 && argv[fileIndex + 1]
        ? argv[fileIndex + 1]
        : null,
    replace,
    db:
      dbIndex >= 0 && argv[dbIndex + 1]
        ? argv[dbIndex + 1]
        : null,
  };
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
  const feePct = pickFeePct(dataset, row);
  const impactPct = toNumber(row.priceImpactPct);
  const volatility = toNumber(row.volatilityPct);

  const depthScore = clamp01(safeLogNorm(liquidityUsd, 6));
  const activityScore = clamp01(safeLogNorm(volume24hUsd, 6));
  const stabilityScore =
    volatility === null
      ? 0.5
      : clamp01(1 - Math.min(volatility, PARAMS.volCap) / PARAMS.volCap);
  const trustScore = clamp01(
    safeLogNorm(volume7dUsd ?? volume24hUsd ?? 0, 7),
  );
  const feeScore =
    feePct === null
      ? 0.5
      : clamp01(1 - Math.min(Math.abs(feePct - feeReferencePct(row)), 1) / 1);
  const impactValue =
    impactPct !== null
      ? impactPct
      : impactProxyPct(liquidityUsd);
  const impactScore = clamp01(
    1 - Math.min(impactValue, PARAMS.impactScoreCapPct) / PARAMS.impactScoreCapPct,
  );

  const score01 =
    depthScore * WEIGHTS.depth +
    activityScore * WEIGHTS.activity +
    stabilityScore * WEIGHTS.stability +
    trustScore * WEIGHTS.trust +
    feeScore * WEIGHTS.fee +
    impactScore * WEIGHTS.impact;

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
  return toNumber(row.price);
}

function pickLiquidityUsd(dataset, row) {
  return toNumber(row.tvl ?? row.liquidityUsd ?? row.liquidity);
}

function pickVolume24hUsd(dataset, row) {
  return toNumber(row.day?.volume ?? row.volume24hUsd ?? row.volume_usd?.h24);
}

function pickVolume7dUsd(dataset, row) {
  return toNumber(row.week?.volume ?? row.volume7dUsd ?? row.volume_usd?.h7);
}

function pickFeePct(dataset, row) {
  const explicitFeePct = toNumber(row.feePct ?? row.fee_percentage);
  if (explicitFeePct !== null) return explicitFeePct;
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

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file) {
    console.error(
      "Usage: node scripts/build_pumpswap_sqlite.js --file pumpswap.live.json_<timestamp>.json [--db /path/to/pumpswap.sqlite] [--replace]",
    );
    process.exit(1);
  }

  let filePath = path.isAbsolute(opts.file)
    ? opts.file
    : path.join(DATA_DIR, opts.file);
  if (!fs.existsSync(filePath) && opts.file.startsWith("data/")) {
    const stripped = opts.file.slice(5);
    filePath = path.join(DATA_DIR, stripped);
  }
  const name = path.basename(filePath);
  const match = name.match(DATASET_FILE_RE);
  if (!match) {
    throw new Error(`File does not match pumpswap snapshot pattern: ${name}`);
  }
  const slug = match[1];
  const dbPath = opts.db
    ? (path.isAbsolute(opts.db) ? opts.db : path.join(OUT_DIR, opts.db))
    : path.join(OUT_DIR, "pumpswap.sqlite");

  ensureOutDir();
  maybeRemoveExistingDb(dbPath, opts.replace);

  const fileInfo = {
    name,
    dataset: DATASET,
    slug,
    fullPath: filePath,
  };
  console.log(`[sqlite] dataset=${DATASET} db=${dbPath}`);
  const count = importFileIntoDb(fileInfo, dbPath);
  console.log(`[sqlite] imported ${count} rows from ${name}`);
  console.log(`[sqlite] done files=1 rows=${count} out_dir=${OUT_DIR}`);
}

main();
