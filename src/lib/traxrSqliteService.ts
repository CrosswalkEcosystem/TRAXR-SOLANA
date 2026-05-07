import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

type DatasetKey =
  | "amm"
  | "clmm"
  | "cpmm"
  | "orca"
  | "pumpswap"
  | "meteora"
  | "meteora-dammv2"
  | "other";

const DB_DIR =
  process.env.TRAXR_SQLITE_DIR ||
  path.join(process.cwd(), "data", "sqlite");
const MANIFEST_PATH =
  process.env.TRAXR_SQLITE_MANIFEST_PATH ||
  path.join(DB_DIR, "sqlite.manifest.json");
const DB_BY_DATASET: Record<DatasetKey, string> = {
  amm: "amm.sqlite",
  clmm: "clmm.sqlite",
  cpmm: "cpmm.sqlite",
  orca: "orca.sqlite",
  pumpswap: "pumpswap.sqlite",
  meteora: "meteora.sqlite",
  "meteora-dammv2": "meteora-dammv2.sqlite",
  other: "other.sqlite",
};
const DATASET_FILE_BY_KEY: Record<DatasetKey, string> = {
  amm: "amm.live.json",
  clmm: "clmm.live.json",
  cpmm: "cpmm.live.json",
  orca: "orca.live.json",
  pumpswap: "pumpswap.live.json",
  meteora: "meteora.dlmm.live.json",
  "meteora-dammv2": "meteora.dammv2.live.json",
  other: "other.live.json",
};

const dbCache = new Map<string, Database.Database>();
let manifestCache:
  | {
      mtimeMs: number;
      datasets: Partial<Record<DatasetKey, string>>;
    }
  | null = null;

function readManifest() {
  try {
    if (!fs.existsSync(MANIFEST_PATH)) return null;
    const stat = fs.statSync(MANIFEST_PATH);
    if (manifestCache && manifestCache.mtimeMs === stat.mtimeMs) {
      return manifestCache.datasets;
    }
    const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    const datasets =
      raw && typeof raw === "object" && raw.datasets && typeof raw.datasets === "object"
        ? (raw.datasets as Partial<Record<DatasetKey, string>>)
        : null;
    if (!datasets) return null;
    manifestCache = { mtimeMs: stat.mtimeMs, datasets };
    return datasets;
  } catch {
    return null;
  }
}

function resolveDbPath(datasetKey: DatasetKey) {
  const manifest = readManifest();
  const manifestFile = manifest?.[datasetKey];
  return path.join(DB_DIR, manifestFile || DB_BY_DATASET[datasetKey]);
}

export function hasSqliteDataset(datasetKey: DatasetKey): boolean {
  const dbPath = resolveDbPath(datasetKey);
  return fs.existsSync(dbPath);
}

export function getSqliteCacheSignature() {
  const manifest = readManifest();
  const parts: string[] = [];

  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      const stat = fs.statSync(MANIFEST_PATH);
      parts.push(`manifest:${stat.mtimeMs}`);
    } catch {}
  }

  for (const datasetKey of listSqliteDatasets()) {
    const dbPath = resolveDbPath(datasetKey);
    try {
      const stat = fs.statSync(dbPath);
      parts.push(`${datasetKey}:${dbPath}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${datasetKey}:${dbPath}:missing`);
    }
  }

  if (manifest) {
    parts.push(`datasets:${JSON.stringify(manifest)}`);
  }

  return parts.join("|");
}

function openDb(datasetKey: DatasetKey) {
  const dbPath = resolveDbPath(datasetKey);
  if (!fs.existsSync(dbPath)) return null;
  if (dbCache.has(dbPath)) return dbCache.get(dbPath) ?? null;
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  dbCache.set(dbPath, db);
  return db;
}

export function listSqliteDatasets(): DatasetKey[] {
  return Object.keys(DB_BY_DATASET) as DatasetKey[];
}

export function getLatestSnapshotTs(datasetKey: DatasetKey): string | null {
  const db = openDb(datasetKey);
  if (!db) return null;
  const row = db
    .prepare(
      "SELECT snapshot_ts AS ts FROM pools_history GROUP BY snapshot_ts ORDER BY snapshot_ts DESC LIMIT 1",
    )
    .get() as { ts?: string } | undefined;
  return row?.ts ?? null;
}

export function getLatestPools(datasetKey: DatasetKey): any[] {
  const db = openDb(datasetKey);
  if (!db) return [];
  const snapshotTs = getLatestSnapshotTs(datasetKey);
  if (!snapshotTs) return [];
  const stmt = db.prepare(
    "SELECT payload_json FROM pools_history WHERE snapshot_ts = ?",
  );
  const rows = stmt.all(snapshotTs) as { payload_json: string }[];
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payload_json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function getLatestSnapshotIso(datasetKey: DatasetKey): string | null {
  return getLatestSnapshotTs(datasetKey);
}

export function findDatasetForPool(poolId: string): DatasetKey | null {
  const key = String(poolId || "");
  if (!key) return null;
  for (const datasetKey of listSqliteDatasets()) {
    const db = openDb(datasetKey);
    if (!db) continue;
    const snapshotTs = getLatestSnapshotTs(datasetKey);
    if (!snapshotTs) continue;
    const row = db
      .prepare(
        "SELECT 1 FROM pools_history WHERE snapshot_ts = ? AND pool_id = ? LIMIT 1",
      )
      .get(snapshotTs, key);
    if (row) return datasetKey;
  }
  return null;
}

export function getPoolHistory(poolId: string): { snapshotTs: string; entry: any }[] {
  const datasetKey = findDatasetForPool(poolId);
  if (!datasetKey) return [];
  const db = openDb(datasetKey);
  if (!db) return [];
  const rows = db
    .prepare(
      "SELECT snapshot_ts, payload_json FROM pools_history WHERE pool_id = ? ORDER BY snapshot_ts",
    )
    .all(poolId) as { snapshot_ts: string; payload_json: string }[];
  return rows
    .map((row) => {
      try {
        const entry = JSON.parse(row.payload_json);
        return { snapshotTs: row.snapshot_ts, entry };
      } catch {
        return null;
      }
    })
    .filter((row): row is { snapshotTs: string; entry: any } => row !== null);
}

export function getDatasetPriceSeries(
  datasetKey: DatasetKey,
  snapshotLimit: number,
): Map<string, { timestamp: string; price: number }[]> {
  const db = openDb(datasetKey);
  if (!db) return new Map();

  const snapshotRows = db
    .prepare(
      "SELECT snapshot_ts FROM snapshots ORDER BY snapshot_ts DESC LIMIT ?",
    )
    .all(snapshotLimit) as { snapshot_ts: string }[];
  if (!snapshotRows.length) return new Map();

  const snapshotTsList = snapshotRows
    .map((row) => row.snapshot_ts)
    .sort((a, b) => a.localeCompare(b));
  const placeholders = snapshotTsList.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT snapshot_ts, pool_id, payload_json
       FROM pools_history
       WHERE snapshot_ts IN (${placeholders})
       ORDER BY snapshot_ts, row_ordinal`,
    )
    .all(...snapshotTsList) as {
    snapshot_ts: string;
    pool_id: string;
    payload_json: string;
  }[];

  const byPool = new Map<string, { timestamp: string; price: number }[]>();
  for (const row of rows) {
    try {
      const entry = JSON.parse(row.payload_json);
      const price = Number.parseFloat(
        String(entry?.price ?? entry?.raw?.current_price ?? entry?.raw?.price ?? ""),
      );
      if (!row.pool_id || !Number.isFinite(price) || price <= 0) continue;
      const list = byPool.get(row.pool_id) ?? [];
      list.push({ timestamp: row.snapshot_ts, price });
      byPool.set(row.pool_id, list);
    } catch {
      continue;
    }
  }

  return byPool;
}

export function datasetKeyFromFile(datasetFile: string): DatasetKey | null {
  const entry = Object.entries(DATASET_FILE_BY_KEY).find(
    ([, file]) => file === datasetFile,
  );
  return entry ? (entry[0] as DatasetKey) : null;
}
