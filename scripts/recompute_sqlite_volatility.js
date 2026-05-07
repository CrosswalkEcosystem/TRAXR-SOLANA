#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const OUT_DIR =
  process.env.TRAXR_SQLITE_DIR ||
  path.join(__dirname, "..", "data", "sqlite");
const VOLATILITY_WINDOW = Number(process.env.TRAXR_VOLATILITY_WINDOW || 30);
const DB_FILE_BY_DATASET = {
  amm: "amm.sqlite",
  clmm: "clmm.sqlite",
  cpmm: "cpmm.sqlite",
  meteora: "meteora.sqlite",
  "meteora-dammv2": "meteora-dammv2.sqlite",
  orca: "orca.sqlite",
  other: "other.sqlite",
};

function parseArgs(argv) {
  const datasetIndex = argv.indexOf("--dataset");
  return {
    dryRun: !argv.includes("--write"),
    dataset:
      datasetIndex >= 0 && argv[datasetIndex + 1]
        ? argv[datasetIndex + 1]
        : null,
  };
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
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

function pickPrice(entry) {
  return toNumber(entry?.price ?? entry?.raw?.current_price ?? entry?.raw?.price);
}

function listTargets(datasetArg) {
  const keys = datasetArg ? [datasetArg] : Object.keys(DB_FILE_BY_DATASET);
  return keys.map((key) => {
    const file = DB_FILE_BY_DATASET[key];
    if (!file) throw new Error(`Unknown dataset: ${key}`);
    return {
      dataset: key,
      dbPath: path.join(OUT_DIR, file),
    };
  });
}

function recomputeDataset(target, dryRun) {
  if (!fs.existsSync(target.dbPath)) {
    throw new Error(`DB not found: ${target.dbPath}`);
  }

  const db = new Database(target.dbPath);
  db.pragma("busy_timeout = 10000");
  const rows = db
    .prepare(
      `SELECT snapshot_ts, row_ordinal, pool_id, payload_json
       FROM pools_history
       ORDER BY pool_id, snapshot_ts, row_ordinal`,
    )
    .all();

  const update = db.prepare(
    `UPDATE pools_history
     SET payload_json = ?
     WHERE snapshot_ts = ? AND row_ordinal = ?`,
  );

  const writeBatch = db.transaction((batch) => {
    for (const item of batch) {
      update.run(item.payload_json, item.snapshot_ts, item.row_ordinal);
    }
  });

  let currentPoolId = null;
  let series = [];
  let scanned = 0;
  let updated = 0;
  let withVolatility = 0;
  let cleared = 0;
  let parseErrors = 0;
  const pending = [];

  for (const row of rows) {
    scanned += 1;
    if (row.pool_id !== currentPoolId) {
      currentPoolId = row.pool_id;
      series = [];
    }

    let payload;
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      parseErrors += 1;
      continue;
    }

    const price = pickPrice(payload);
    if (price !== null && price > 0) {
      series.push(price);
      if (series.length > VOLATILITY_WINDOW) {
        series.splice(0, series.length - VOLATILITY_WINDOW);
      }
    }

    const volatility = deriveVolatilityFromPrices(series);
    const prev =
      toNumber(payload?.volatilityPct ?? payload?.volatility) ?? null;

    if (volatility !== null) {
      withVolatility += 1;
      payload.volatilityPct = volatility;
      if (prev === null || Math.abs(prev - volatility) > 1e-12) {
        updated += 1;
        pending.push({
          snapshot_ts: row.snapshot_ts,
          row_ordinal: row.row_ordinal,
          payload_json: JSON.stringify(payload),
        });
      }
    } else if ("volatilityPct" in payload) {
      cleared += 1;
      delete payload.volatilityPct;
      updated += 1;
      pending.push({
        snapshot_ts: row.snapshot_ts,
        row_ordinal: row.row_ordinal,
        payload_json: JSON.stringify(payload),
      });
    }

    if (!dryRun && pending.length >= 1000) {
      writeBatch(pending.splice(0, pending.length));
    }
  }

  if (!dryRun && pending.length) {
    writeBatch(pending);
  }

  db.close();

  console.log(
    `[sqlite-volatility] dataset=${target.dataset} scanned=${scanned} updated=${updated} withVolatility=${withVolatility} cleared=${cleared} parseErrors=${parseErrors} dryRun=${dryRun ? "yes" : "no"}`,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const targets = listTargets(opts.dataset);
  for (const target of targets) {
    recomputeDataset(target, opts.dryRun);
  }
}

main();
