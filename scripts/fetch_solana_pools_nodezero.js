const fs = require("fs");
const path = require("path");
const Decimal = require("decimal.js");
const BN = require("bn.js");
const { spawnSync } = require("child_process");
const { Connection, PublicKey } = require("@solana/web3.js");
const {
  buildMeteoraConnection,
  isViableMeteoraPool,
  quoteMeteoraImpact,
} = require("./lib/meteoraImpact");
const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const {
  mplTokenMetadata,
  safeFetchMetadataFromSeeds,
} = require("@metaplex-foundation/mpl-token-metadata");
const { publicKey } = require("@metaplex-foundation/umi");
const { ReadOnlyWallet, Percentage } = require("@orca-so/common-sdk");
const {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
  UseFallbackTickArray,
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
} = require("@orca-so/whirlpools-sdk");

const ENV_PATH = path.join(process.cwd(), ".env.local");
if (fs.existsSync(ENV_PATH)) {
  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const BASE_URL = "http://127.0.0.1/data/traxr/solana";
const DEFAULT_DATASETS = [
  "amm.live.json",
  "clmm.live.json",
  "cpmm.live.json",
  "orca.live.json",
  "meteora.dlmm.live.json",
  "meteora.dammv2.live.json",
  "other.live.json",
];
const DATASETS = (process.env.TRAXR_DATASETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ACTIVE_DATASETS = DATASETS.length ? DATASETS : DEFAULT_DATASETS;
const CLMM_BATCH_PRICEIMPACT = process.env.CLMM_PRICEIMPACT_BATCH !== "0";
const CLMM_IMPACT_TRADE_USD = Number(process.env.CLMM_IMPACT_TRADE_USD || 1000);
const CLMM_IMPACT_TICK_WINDOW = Number(process.env.CLMM_IMPACT_TICK_WINDOW || 2);
const CLMM_IMPACT_TICK_LIMIT = Number(process.env.CLMM_IMPACT_TICK_LIMIT || 8);
const CLMM_IMPACT_RETRY_WINDOW = Number(process.env.CLMM_IMPACT_RETRY_WINDOW || 5);
const CLMM_IMPACT_RETRY_LIMIT = Number(process.env.CLMM_IMPACT_RETRY_LIMIT || 24);
const CLMM_IMPACT_STATE_BATCH = Number(process.env.CLMM_IMPACT_STATE_BATCH || 200);

const API_KEY = process.env.NODEZERO_API_KEY || "";
const NODEZERO_RPC_KEY = process.env.NODEZERO_RPC_KEY || "";
const NODEZERO_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const PUMPSWAP_ENABLED = process.env.TRAXR_PUMPSWAP !== "0";
const PUMPSWAP_MIN_LIQUIDITY_USD = Number(
  process.env.PUMPSWAP_MIN_LIQUIDITY_USD || 1000,
);
const PUMPSWAP_GPA_RPC =
  process.env.PUMPSWAP_GPA_RPC || "https://api.mainnet-beta.solana.com";
const PUMPSWAP_DATA_RPC =
  process.env.PUMPSWAP_DATA_RPC || NODEZERO_RPC_URL;
const PUMPSWAP_BATCH_SIZE = Number(process.env.PUMPSWAP_BATCH_SIZE || 100);
const PUMPSWAP_CONCURRENCY = Number(process.env.PUMPSWAP_CONCURRENCY || 8);
const PUMPSWAP_THROTTLE_MS = Number(process.env.PUMPSWAP_THROTTLE_MS || 50);
const PUMPSWAP_METADATA_DELAY_MS = Number(
  process.env.PUMPSWAP_METADATA_DELAY_MS || 150,
);
const PUMPSWAP_POOL_INDEX =
  process.env.PUMPSWAP_POOL_INDEX || "data/pumpswap.pool_index.json";
const PUMPSWAP_REFRESH_FROM = process.env.PUMPSWAP_REFRESH_FROM || "";
const PUMPSWAP_FEE_PCT = process.env.PUMPSWAP_FEE_PCT || "";
const PUMPSWAP_FEE_RATE = process.env.PUMPSWAP_FEE_RATE || "";
const PUMPSWAP_ACTIVITY_CHUNK = Number(process.env.PUMPSWAP_ACTIVITY_CHUNK || 50);
const PUMPSWAP_ACTIVITY_SLEEP_MS = Number(process.env.PUMPSWAP_ACTIVITY_SLEEP_MS || 250);
const PUMPSWAP_ACTIVITY_INTERVALS =
  process.env.PUMPSWAP_ACTIVITY_INTERVALS || "5m,1h,6h,24h";
const PUMPSWAP_ACTIVITY_METRICS =
  process.env.PUMPSWAP_ACTIVITY_METRICS ||
  "numTxs,volumeUSD,numUsers,numBuys,numSells,buyVolumeUSD,sellVolumeUSD,numBuyers,numSellers,priceChangePercent";
const PUMPSWAP_ACTIVITY_SOURCE =
  process.env.PUMPSWAP_ACTIVITY_SOURCE || "dexscreener";
const PUMPSWAP_METADATA_RPC_TIMEOUT_MS = Number(
  process.env.PUMPSWAP_METADATA_RPC_TIMEOUT_MS || 8000,
);
const PUMPSWAP_METADATA_OFFCHAIN_TIMEOUT_MS = Number(
  process.env.PUMPSWAP_METADATA_OFFCHAIN_TIMEOUT_MS || 8000,
);
const OUTPUT_DIR = path.join(__dirname, "..", "data");
const CACHE_DIR = path.join(OUTPUT_DIR, "nodezero-cache");
const CACHE_META_PATH = path.join(CACHE_DIR, "meta.json");
const METEORA_METADATA_CACHE_PATH = path.join(
  CACHE_DIR,
  "meteora-mint-metadata.json",
);
const SQLITE_IMPORT = process.env.TRAXR_SQLITE_IMPORT === "true";
const COMPRESS_SNAPSHOTS = process.env.TRAXR_COMPRESS_SNAPSHOTS !== "0";
const COMPRESS_KEEP_LATEST = Math.max(
  0,
  Number(process.env.TRAXR_COMPRESS_KEEP_LATEST || 1),
);
const HELPER_RETENTION_ENABLED = process.env.TRAXR_HELPER_RETENTION !== "0";
const HELPER_KEEP_CLMM_BATCH = Math.max(
  0,
  Number(process.env.TRAXR_HELPER_KEEP_CLMM_BATCH || 3),
);
const HELPER_KEEP_PUMPSWAP_META = Math.max(
  0,
  Number(process.env.TRAXR_HELPER_KEEP_PUMPSWAP_META || 3),
);
const HELPER_KEEP_PUMPSWAP_ACTIVITY = Math.max(
  0,
  Number(process.env.TRAXR_HELPER_KEEP_PUMPSWAP_ACTIVITY || 3),
);
const HELPER_KEEP_PUMPSWAP_FULL = Math.max(
  0,
  Number(process.env.TRAXR_HELPER_KEEP_PUMPSWAP_FULL || 2),
);
const SQLITE_BACKUP_ENABLED = process.env.TRAXR_SQLITE_BACKUP === "true";
const SQLITE_BACKUP_FORCE = process.env.TRAXR_SQLITE_BACKUP_FORCE === "true";
const SQLITE_BACKUP_DIR =
  process.env.TRAXR_SQLITE_BACKUP_DIR || "/mnt/traxr-db/traxr-sqlite-backups";
const SQLITE_BACKUP_STATE_PATH =
  process.env.TRAXR_SQLITE_BACKUP_STATE_PATH ||
  path.join(SQLITE_BACKUP_DIR, "last_backup.json");
const SQLITE_BACKUP_INTERVAL_DAYS = Math.max(
  1,
  Number(process.env.TRAXR_SQLITE_BACKUP_INTERVAL_DAYS || 7),
);
const SQLITE_BACKUP_KEEP_WEEKLY = Math.max(
  0,
  Number(process.env.TRAXR_SQLITE_BACKUP_KEEP_WEEKLY || 4),
);
const SQLITE_BACKUP_KEEP_MONTHLY = Math.max(
  0,
  Number(process.env.TRAXR_SQLITE_BACKUP_KEEP_MONTHLY || 3),
);
const PIPELINE_STATUS_PATH =
  process.env.TRAXR_PIPELINE_STATUS_PATH ||
  "/opt/crosswalk/backend/data/pipeline.status.json";
const METEORA_SOURCE_FILE =
  process.env.TRAXR_METEORA_SOURCE_FILE || "";

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
const DATASET_FILE_RE =
  /^(amm\.live\.json|clmm\.live\.json|cpmm\.live\.json|orca\.live\.json|meteora\.dlmm\.live\.json|meteora\.dammv2\.live\.json|other\.live\.json|pumpswap\.live\.json)_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const VOLATILITY_WINDOW = 30;
const IMPACT_TRADE_SIZE_USD = 1_000;
const ORCA_MIN_TVL_USD = 1_000;
const ORCA_MIN_VOLUME24H_USD = 250;
const ORCA_INTER_POOL_DELAY_MS = 200;
const ORCA_RPC_TIMEOUT_MS = 15_000;
const METEORA_MIN_LIQUIDITY_USD = 1_000;
const METEORA_MIN_VOLUME24H_USD = 250;
const METEORA_INTER_POOL_DELAY_MS = 200;
const METEORA_INTER_MINT_DELAY_MS = 150;
const METEORA_RPC_TIMEOUT_MS = 15_000;
const METEORA_BIN_ARRAY_COUNT = 16;

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
}

function updatePipelineStatus(state, step, message, stats = null) {
  try {
    const statusDir = path.dirname(PIPELINE_STATUS_PATH);
    if (!fs.existsSync(statusDir)) return;
    let previous = {};
    if (fs.existsSync(PIPELINE_STATUS_PATH)) {
      try {
        previous = JSON.parse(fs.readFileSync(PIPELINE_STATUS_PATH, "utf8"));
      } catch {}
    }
    const timestamp = new Date().toISOString();
    const stepChanged = previous?.step !== step;
    const startedAt =
      typeof previous?.startedAt === "string" && previous.startedAt
        ? previous.startedAt
        : timestamp;
    const stepStartedAt =
      !stepChanged &&
      typeof previous?.stepStartedAt === "string" &&
      previous.stepStartedAt
        ? previous.stepStartedAt
        : timestamp;
    fs.writeFileSync(
      PIPELINE_STATUS_PATH,
      JSON.stringify(
        {
          state,
          step,
          message,
          stats,
          startedAt,
          stepStartedAt,
          updatedAt: timestamp,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.warn("[nodezero] Failed to update pipeline status", error?.message || error);
  }
}

function readCacheMeta() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_META_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeCacheMeta(meta) {
  fs.writeFileSync(CACHE_META_PATH, JSON.stringify(meta, null, 2));
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function listFilesByRegex(regex) {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  return fs
    .readdirSync(OUTPUT_DIR)
    .filter((name) => regex.test(name))
    .map((name) => {
      const fullPath = path.join(OUTPUT_DIR, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneByRegex(regex, keepLatest) {
  const files = listFilesByRegex(regex);
  const toDelete = files.slice(Math.max(0, keepLatest));
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file.fullPath);
    } catch {}
  }
  return {
    total: files.length,
    kept: Math.min(files.length, Math.max(0, keepLatest)),
    deleted: toDelete.length,
  };
}

function pruneHelperArtifacts() {
  const clmmAnyBatch =
    /^clmm\.live\.json_\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z\.priceimpact\.batch(?:\.merged|\.retry)?\.json$/i;
  const pumpswapMeta =
    /^pumpswap\.live\.json_\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z\.metadata\.json$/i;
  const pumpswapActivity =
    /^pumpswap\.live\.json_\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z\.activity\.json$/i;
  const pumpswapFull =
    /^pumpswap\.live\.full_\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z\.json$/i;

  return {
    clmmBatch: pruneByRegex(clmmAnyBatch, HELPER_KEEP_CLMM_BATCH),
    pumpswapMeta: pruneByRegex(pumpswapMeta, HELPER_KEEP_PUMPSWAP_META),
    pumpswapActivity: pruneByRegex(pumpswapActivity, HELPER_KEEP_PUMPSWAP_ACTIVITY),
    pumpswapFull: pruneByRegex(pumpswapFull, HELPER_KEEP_PUMPSWAP_FULL),
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function backupSqliteDatabases() {
  const dbDir = process.env.TRAXR_SQLITE_DIR || path.join(OUTPUT_DIR, "sqlite");
  if (!fs.existsSync(dbDir)) {
    throw new Error(`SQLite dir missing: ${dbDir}`);
  }
  if (!fs.existsSync(SQLITE_BACKUP_DIR)) {
    fs.mkdirSync(SQLITE_BACKUP_DIR, { recursive: true });
  }

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const backupRunDir = path.join(SQLITE_BACKUP_DIR, stamp);
  fs.mkdirSync(backupRunDir, { recursive: true });

  const dbFiles = fs
    .readdirSync(dbDir)
    .filter((name) => name.endsWith(".sqlite"))
    .sort();
  if (!dbFiles.length) {
    throw new Error(`No .sqlite files found in ${dbDir}`);
  }

  for (const dbFile of dbFiles) {
    const srcPath = path.join(dbDir, dbFile);
    const outPath = path.join(backupRunDir, dbFile);
    const result = spawnSync("sqlite3", [srcPath, `.backup '${outPath}'`], {
      encoding: "utf8",
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`sqlite backup failed for ${dbFile}`);
    }
  }

  const backupDirs = fs
    .readdirSync(SQLITE_BACKUP_DIR)
    .map((name) => {
      const fullPath = path.join(SQLITE_BACKUP_DIR, name);
      const stat = fs.statSync(fullPath);
      return { name, fullPath, isDir: stat.isDirectory(), mtimeMs: stat.mtimeMs };
    })
    .filter((entry) => entry.isDir)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const monthlyKept = new Set();
  const keepSet = new Set();
  const weeklyLimit = Math.max(SQLITE_BACKUP_KEEP_WEEKLY, SQLITE_BACKUP_KEEP_MONTHLY);
  for (const entry of backupDirs.slice(0, weeklyLimit)) {
    keepSet.add(entry.fullPath);
  }
  for (const entry of backupDirs) {
    const monthKey = entry.name.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
    if (monthlyKept.has(monthKey)) continue;
    if (monthlyKept.size >= SQLITE_BACKUP_KEEP_MONTHLY) break;
    monthlyKept.add(monthKey);
    keepSet.add(entry.fullPath);
  }

  let deleted = 0;
  for (const entry of backupDirs) {
    if (keepSet.has(entry.fullPath)) continue;
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
    deleted += 1;
  }

  return {
    stamp,
    backupDir: backupRunDir,
    dbCount: dbFiles.length,
    totalSets: backupDirs.length,
    deletedSets: deleted,
    keptSets: backupDirs.length - deleted,
  };
}

function loadSqliteBackupState() {
  try {
    if (!fs.existsSync(SQLITE_BACKUP_STATE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(SQLITE_BACKUP_STATE_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

function saveSqliteBackupState(state) {
  const dir = path.dirname(SQLITE_BACKUP_STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SQLITE_BACKUP_STATE_PATH, JSON.stringify(state, null, 2));
}

function evaluateSqliteBackupSchedule() {
  if (!SQLITE_BACKUP_ENABLED) return { shouldRun: false, reason: "disabled" };
  if (SQLITE_BACKUP_FORCE) return { shouldRun: true, reason: "forced" };

  const intervalMs = SQLITE_BACKUP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  const state = loadSqliteBackupState();
  const last = state?.lastSuccessfulBackupAt;
  const lastMs = typeof last === "string" ? Date.parse(last) : Number.NaN;

  if (!Number.isFinite(lastMs)) {
    return { shouldRun: true, reason: "no_valid_last_backup" };
  }

  const elapsed = Date.now() - lastMs;
  if (elapsed >= intervalMs) {
    return { shouldRun: true, reason: "interval_elapsed", elapsedMs: elapsed };
  }

  return {
    shouldRun: false,
    reason: "not_due",
    elapsedMs: elapsed,
    remainingMs: intervalMs - elapsed,
  };
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim() : null;
}

function cleanOptionalBool(value) {
  return typeof value === "boolean" ? value : null;
}

function loadMeteoraMetadataStore() {
  try {
    if (!fs.existsSync(METEORA_METADATA_CACHE_PATH)) return new Map();
    const raw = JSON.parse(fs.readFileSync(METEORA_METADATA_CACHE_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return new Map();
    return new Map(
      Object.entries(raw).map(([mint, entry]) => [
        mint,
        {
          mint,
          name: cleanText(entry?.name),
          symbol: cleanText(entry?.symbol),
          logo: cleanText(entry?.logo),
          uri: cleanText(entry?.uri),
          found: typeof entry?.found === "boolean" ? entry.found : false,
          reason: cleanText(entry?.reason),
          isMutable: cleanOptionalBool(entry?.isMutable),
          updateAuthority: cleanText(entry?.updateAuthority),
          lastCheckedAt: cleanText(entry?.lastCheckedAt),
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

function saveMeteoraMetadataStore(store) {
  const json = {};
  for (const [mint, entry] of store.entries()) {
    json[mint] = {
      mint,
      name: cleanText(entry?.name),
      symbol: cleanText(entry?.symbol),
      logo: cleanText(entry?.logo),
      uri: cleanText(entry?.uri),
      found: typeof entry?.found === "boolean" ? entry.found : false,
      reason: cleanText(entry?.reason),
      isMutable: cleanOptionalBool(entry?.isMutable),
      updateAuthority: cleanText(entry?.updateAuthority),
      lastCheckedAt: cleanText(entry?.lastCheckedAt),
    };
  }
  fs.writeFileSync(METEORA_METADATA_CACHE_PATH, JSON.stringify(json, null, 2));
}

function mergeMeteoraMetadataEntries(...entries) {
  const merged = {
    mint: null,
    name: null,
    symbol: null,
    logo: null,
    uri: null,
    found: false,
    reason: null,
    isMutable: null,
    updateAuthority: null,
    lastCheckedAt: null,
  };

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    merged.mint = merged.mint || cleanText(entry.mint);
    merged.name = merged.name || cleanText(entry.name);
    merged.symbol = merged.symbol || cleanText(entry.symbol);
    merged.logo = merged.logo || cleanText(entry.logo);
    merged.uri = merged.uri || cleanText(entry.uri);
    if (typeof merged.isMutable !== "boolean") {
      merged.isMutable = cleanOptionalBool(entry.isMutable);
    }
    merged.updateAuthority =
      merged.updateAuthority || cleanText(entry.updateAuthority);
    merged.lastCheckedAt =
      merged.lastCheckedAt || cleanText(entry.lastCheckedAt);
    if (!merged.found && entry.found === true) merged.found = true;
    merged.reason = merged.reason || cleanText(entry.reason);
  }

  return merged;
}

function shouldSkipMeteoraMetadataFetch(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (cleanText(entry.logo)) return true;
  return entry.found === true && cleanOptionalBool(entry.isMutable) === false && !cleanText(entry.uri);
}

function buildPriorSnapshotMetadataMap(datasetName) {
  const map = new Map();
  if (!datasetName) return map;
  const names = fs.existsSync(OUTPUT_DIR) ? fs.readdirSync(OUTPUT_DIR) : [];
  const snapshots = names
    .map((name) => {
      const match = name.match(DATASET_FILE_RE);
      if (!match || match[1] !== datasetName) return null;
      return {
        name,
        stampMs: parseTimestampSlug(match[2]),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b.stampMs || 0) - (a.stampMs || 0));
  if (!snapshots.length) return map;

  try {
    const prior = JSON.parse(
      fs.readFileSync(path.join(OUTPUT_DIR, snapshots[0].name), "utf8"),
    );
    if (!Array.isArray(prior)) return map;
    for (const row of prior) {
      const mintA = cleanText(row?.mintA ?? row?.raw?.mint_x);
      const mintB = cleanText(row?.mintB ?? row?.raw?.mint_y);
      if (mintA) {
        map.set(
          mintA,
          mergeMeteoraMetadataEntries(map.get(mintA), {
            mint: mintA,
            name: row?.mintA_name,
            symbol: row?.mintA_symbol,
            logo: row?.mintA_logo || row?.tokenALogo,
            found: Boolean(
              cleanText(row?.mintA_name) ||
                cleanText(row?.mintA_symbol) ||
                cleanText(row?.mintA_logo) ||
                cleanText(row?.tokenALogo),
            ),
          }),
        );
      }
      if (mintB) {
        map.set(
          mintB,
          mergeMeteoraMetadataEntries(map.get(mintB), {
            mint: mintB,
            name: row?.mintB_name,
            symbol: row?.mintB_symbol,
            logo: row?.mintB_logo || row?.tokenBLogo,
            found: Boolean(
              cleanText(row?.mintB_name) ||
                cleanText(row?.mintB_symbol) ||
                cleanText(row?.mintB_logo) ||
                cleanText(row?.tokenBLogo),
            ),
          }),
        );
      }
    }
  } catch {}

  return map;
}

async function fetchWithRetry(url, options, retries = 3) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      const res = await fetch(url, options);
      if (res.status === 200 || res.status === 304) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }

    attempt += 1;
    if (attempt <= retries) {
      await sleep(600 * attempt);
    }
  }

  throw lastError;
}

async function fetchDataset(name, meta) {
  if (
    name === "meteora.dlmm.live.json" &&
    METEORA_SOURCE_FILE &&
    fs.existsSync(METEORA_SOURCE_FILE)
  ) {
    const text = fs.readFileSync(METEORA_SOURCE_FILE, "utf8");
    const rows = METEORA_SOURCE_FILE.endsWith(".jsonl")
      ? text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : JSON.parse(text);
    if (!Array.isArray(rows)) {
      throw new Error("[nodezero] local Meteora source did not resolve to an array");
    }
    console.log(
      `[nodezero] Loaded ${rows.length} Meteora pools from ${METEORA_SOURCE_FILE}`,
    );
    return rows;
  }

  const url = `${BASE_URL}/${name}`;
  const headers = { "X-API-Key": API_KEY };
  const cacheEntry = meta[name] || {};

  if (cacheEntry.etag) headers["If-None-Match"] = cacheEntry.etag;
  if (cacheEntry.lastModified) headers["If-Modified-Since"] = cacheEntry.lastModified;

  const res = await fetchWithRetry(url, { headers });

  if (res.status === 304) {
    const cachedPath = path.join(CACHE_DIR, name);
    if (!fs.existsSync(cachedPath)) {
      throw new Error(`[nodezero] 304 for ${name} but no cache found`);
    }
    return JSON.parse(fs.readFileSync(cachedPath, "utf8"));
  }

  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error(`[nodezero] ${name} did not return a JSON array`);
  }

  const etag = res.headers.get("etag");
  const lastModified = res.headers.get("last-modified");
  meta[name] = {
    ...(cacheEntry || {}),
    etag: etag || cacheEntry.etag,
    lastModified: lastModified || cacheEntry.lastModified,
    updatedAt: new Date().toISOString(),
  };

  const cachedPath = path.join(CACHE_DIR, name);
  fs.writeFileSync(cachedPath, JSON.stringify(json, null, 2));
  return json;
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
  const poolType = String(metrics?.poolType ?? "").trim().toLowerCase();
  const source = String(metrics?.source ?? "").trim().toLowerCase();

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

function calcCTSComponents(metrics) {
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
  const feeTerm = clamp01((feeRefPct - (metrics.feePct ?? feeRefPct)) / feeRefPct);
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

  const score = clamp01(base * (1 - freshPenalty));

  return { score };
}

function countCTSNodes(score) {
  return score === 0 ? 0 : Math.max(1, Math.round(score * 6));
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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
  return new Decimal(amount.toString()).div(decimalPow10(decimals));
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

function buildHistoricalPriceSeriesByPool() {
  const seriesByPool = new Map();
  const names = fs.existsSync(OUTPUT_DIR) ? fs.readdirSync(OUTPUT_DIR) : [];

  for (const name of names) {
    const match = name.match(DATASET_FILE_RE);
    if (!match) continue;
    const stampMs = parseTimestampSlug(match[2]);
    if (!stampMs) continue;
    const fullPath = path.join(OUTPUT_DIR, name);
    try {
      const raw = JSON.parse(fs.readFileSync(fullPath, "utf8"));
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
    } catch {}
  }

  return seriesByPool;
}

function buildVolatilityByPool(seriesByPool, stampMs, dataset) {
  const merged = new Map();

  for (const [poolId, series] of seriesByPool.entries()) {
    merged.set(poolId, [...series]);
  }

  for (const entry of dataset) {
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
    const list = merged.get(poolId) ?? [];
    list.push({ ts: stampMs, price });
    merged.set(poolId, list);
  }

  const volatilityByPool = new Map();
  for (const [poolId, series] of merged.entries()) {
    const prices = series
      .sort((a, b) => a.ts - b.ts)
      .slice(-VOLATILITY_WINDOW)
      .map((point) => point.price);
    const volatility = deriveVolatilityFromPrices(prices);
    if (volatility !== null) volatilityByPool.set(poolId, volatility);
  }
  return volatilityByPool;
}

function estimateSolUsdFromDataset(dataset) {
  const candidates = [];
  for (const pool of dataset) {
    const price = toNumber(pool?.price);
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

function deriveOrcaSpotPrice(pool) {
  return toNumber(pool?.price);
}

function deriveOrcaTokenUsd(pool, spotPrice) {
  const tvlUsd = toNumber(pool?.tvlUsdc ?? pool?.tvl);
  const reserveA = toNumber(pool?.tokenBalanceA ?? pool?.mintAmountA ?? pool?.reserveA);
  const reserveB = toNumber(pool?.tokenBalanceB ?? pool?.mintAmountB ?? pool?.reserveB);
  const decimalsA = Number(
    pool?.tokenA?.decimals ?? pool?.decimalsA ?? pool?.tokenADecimals ?? 6,
  );
  const decimalsB = Number(
    pool?.tokenB?.decimals ?? pool?.decimalsB ?? pool?.tokenBDecimals ?? 6,
  );

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
    const reserveANormalized = reserveA / 10 ** decimalsA;
    const reserveBNormalized = reserveB / 10 ** decimalsB;
    if (reserveANormalized > 0 && reserveBNormalized > 0) {
      const denominator = reserveANormalized * spotPrice + reserveBNormalized;
      if (Number.isFinite(denominator) && denominator > 0) {
        const tokenBUsd = tvlUsd / denominator;
        const tokenAUsd = tokenBUsd * spotPrice;
        return { tokenAUsd, tokenBUsd, decimalsA, decimalsB };
      }
    }
  }

  const symbolA = String(pool?.tokenA?.symbol ?? pool?.tokenASymbol ?? "").toUpperCase();
  const symbolB = String(pool?.tokenB?.symbol ?? pool?.tokenBSymbol ?? "").toUpperCase();
  const mintA = String(pool?.tokenMintA ?? pool?.mintA ?? "");
  const mintB = String(pool?.tokenMintB ?? pool?.mintB ?? "");
  const isSolA = symbolA === "SOL" || mintA === "So11111111111111111111111111111111111111112";
  const isSolB = symbolB === "SOL" || mintB === "So11111111111111111111111111111111111111112";
  const solUsdGuess = 94;
  if (spotPrice !== null && spotPrice > 0 && isSolA) {
    return { tokenAUsd: solUsdGuess, tokenBUsd: solUsdGuess / spotPrice, decimalsA, decimalsB };
  }
  if (spotPrice !== null && spotPrice > 0 && isSolB) {
    return { tokenAUsd: solUsdGuess * spotPrice, tokenBUsd: solUsdGuess, decimalsA, decimalsB };
  }

  return { tokenAUsd: null, tokenBUsd: null, decimalsA, decimalsB };
}

function isViableOrcaPool(pool) {
  const tvlUsd = toNumber(pool?.tvlUsdc ?? pool?.tvl);
  const vol24Usd = toNumber(pool?.stats?.["24h"]?.volume);
  const spotPrice = deriveOrcaSpotPrice(pool);
  const poolId = pool?.address ?? pool?.id ?? pool?.poolId ?? null;
  const mintA = pool?.tokenMintA ?? pool?.mintA;
  const mintB = pool?.tokenMintB ?? pool?.mintB;
  const decimalsA = pool?.tokenA?.decimals ?? pool?.decimalsA ?? pool?.tokenADecimals;
  const decimalsB = pool?.tokenB?.decimals ?? pool?.decimalsB ?? pool?.tokenBDecimals;

  if (!poolId) return { ok: false, reason: "missing pool id" };
  if (!mintA || !mintB) return { ok: false, reason: "missing token mint" };
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
    return { ok: false, reason: "missing spot price" };
  }
  if (!Number.isFinite(tvlUsd) || tvlUsd < ORCA_MIN_TVL_USD) {
    return { ok: false, reason: `tvl below ${ORCA_MIN_TVL_USD}` };
  }
  if (!Number.isFinite(vol24Usd) || vol24Usd < ORCA_MIN_VOLUME24H_USD) {
    return { ok: false, reason: `24h volume below ${ORCA_MIN_VOLUME24H_USD}` };
  }
  if (!Number.isFinite(Number(decimalsA)) || !Number.isFinite(Number(decimalsB))) {
    return { ok: false, reason: "missing token decimals" };
  }
  return { ok: true, reason: null };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function buildOrcaClient() {
  if (!NODEZERO_RPC_KEY) {
    throw new Error("Missing NODEZERO_RPC_KEY");
  }
  const connection = new Connection(NODEZERO_RPC_URL, {
    commitment: "confirmed",
    httpHeaders: {
      "x-api-key": NODEZERO_RPC_KEY,
    },
  });
  const wallet = new ReadOnlyWallet(PublicKey.default);
  const ctx = WhirlpoolContext.from(connection, wallet);
  return buildWhirlpoolClient(ctx);
}

function buildMeteoraUmi() {
  if (!NODEZERO_RPC_KEY) {
    throw new Error("Missing NODEZERO_RPC_KEY");
  }
  return createUmi(NODEZERO_RPC_URL, {
    commitment: "confirmed",
    httpHeaders: { "x-api-key": NODEZERO_RPC_KEY },
  }).use(mplTokenMetadata());
}

async function computeOrcaLiveImpact(pool, client) {
  const poolId = String(pool?.address ?? pool?.id ?? pool?.poolId ?? "");
  if (!poolId) return { value: null, reason: "missing pool id" };

  try {
    const whirlpool = await withTimeout(
      client.getPool(new PublicKey(poolId)),
      ORCA_RPC_TIMEOUT_MS,
    );
    const poolData = whirlpool.getData();
    const decimalsA = Number(
      pool?.tokenA?.decimals ?? pool?.decimalsA ?? pool?.tokenADecimals ?? 6,
    );
    const decimalsB = Number(
      pool?.tokenB?.decimals ?? pool?.decimalsB ?? pool?.tokenBDecimals ?? 6,
    );
    const liveSpotPrice = PriceMath.sqrtPriceX64ToPrice(
      poolData.sqrtPrice,
      decimalsA,
      decimalsB,
    ).toNumber();
    if (!Number.isFinite(liveSpotPrice) || liveSpotPrice <= 0) {
      return { value: null, reason: "missing live spot price" };
    }
    const { tokenAUsd, tokenBUsd } = deriveOrcaTokenUsd(pool, liveSpotPrice);
    if (!tokenAUsd || !tokenBUsd) {
      return { value: null, reason: "unable to derive token USD prices" };
    }

    const fetcher = client.getFetcher();
    const mintA = new PublicKey(pool?.tokenMintA ?? pool?.mintA);
    const mintB = new PublicKey(pool?.tokenMintB ?? pool?.mintB);
    const [quoteAToB, quoteBToA] = await Promise.allSettled([
      withTimeout(
        swapQuoteByInputToken(
          whirlpool,
          mintA,
          amountToBn(new Decimal(IMPACT_TRADE_SIZE_USD).div(tokenAUsd), decimalsA),
          Percentage.fromFraction(1, 1000),
          ORCA_WHIRLPOOL_PROGRAM_ID,
          fetcher,
          undefined,
          UseFallbackTickArray.Always,
        ),
        ORCA_RPC_TIMEOUT_MS,
      ),
      withTimeout(
        swapQuoteByInputToken(
          whirlpool,
          mintB,
          amountToBn(new Decimal(IMPACT_TRADE_SIZE_USD).div(tokenBUsd), decimalsB),
          Percentage.fromFraction(1, 1000),
          ORCA_WHIRLPOOL_PROGRAM_ID,
          fetcher,
          undefined,
          UseFallbackTickArray.Always,
        ),
        ORCA_RPC_TIMEOUT_MS,
      ),
    ]);

    const impacts = [];
    const reasons = [];
    if (quoteAToB.status === "fulfilled") {
      const actualIn = bnToDecimal(quoteAToB.value.estimatedAmountIn, decimalsA);
      const actualOut = bnToDecimal(quoteAToB.value.estimatedAmountOut, decimalsB);
      const idealOut = actualIn.mul(liveSpotPrice);
      if (idealOut.gt(0)) {
        impacts.push(idealOut.minus(actualOut).abs().div(idealOut).mul(100).toNumber());
      }
    } else {
      reasons.push(
        quoteAToB.reason instanceof Error ? quoteAToB.reason.message : String(quoteAToB.reason),
      );
    }
    if (quoteBToA.status === "fulfilled") {
      const actualIn = bnToDecimal(quoteBToA.value.estimatedAmountIn, decimalsB);
      const actualOut = bnToDecimal(quoteBToA.value.estimatedAmountOut, decimalsA);
      const idealOut = actualIn.div(liveSpotPrice);
      if (idealOut.gt(0)) {
        impacts.push(idealOut.minus(actualOut).abs().div(idealOut).mul(100).toNumber());
      }
    } else {
      reasons.push(
        quoteBToA.reason instanceof Error ? quoteBToA.reason.message : String(quoteBToA.reason),
      );
    }

    return {
      value: impacts.length ? Math.max(...impacts) : null,
      reason: impacts.length ? null : reasons[0] ?? "no exact quote",
    };
  } catch (error) {
    return {
      value: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function enrichOrcaPriceImpact(dataset) {
  if (!dataset.length) return dataset;
  if (!NODEZERO_RPC_KEY) {
    console.warn("[nodezero] NODEZERO_RPC_KEY missing, skipping Orca live impact enrichment");
    return dataset;
  }

  const client = buildOrcaClient();
  let quoted = 0;
  let updated = 0;
  let failed = 0;
  let nonQuotable = 0;
  const skipReasons = new Map();
  const failureReasons = new Map();

  for (let idx = 0; idx < dataset.length; idx += 1) {
    const entry = dataset[idx];
    const viable = isViableOrcaPool(entry);
    if (!viable.ok) {
      skipReasons.set(viable.reason, (skipReasons.get(viable.reason) || 0) + 1);
      continue;
    }

    quoted += 1;
    const result = await computeOrcaLiveImpact(entry, client);
    if (typeof result.value === "number" && Number.isFinite(result.value)) {
      entry.priceImpactPct = result.value;
      updated += 1;
    } else {
      failed += 1;
      if (result.reason && /traversed too many arrays|out of bounds/i.test(result.reason)) {
        nonQuotable += 1;
      }
      const key = result.reason || "unknown";
      failureReasons.set(key, (failureReasons.get(key) || 0) + 1);
    }

    if (idx + 1 < dataset.length) {
      await sleep(ORCA_INTER_POOL_DELAY_MS);
    }
  }

  console.log(
    `[nodezero] Orca impact enrichment: quoted=${quoted}, updated=${updated}, failed=${failed}, nonQuotable=${nonQuotable}`,
  );
  for (const [reason, count] of skipReasons.entries()) {
    console.log(`[nodezero] Orca skipped ${count} pools: ${reason}`);
  }
  for (const [reason, count] of failureReasons.entries()) {
    console.log(`[nodezero] Orca impact issue ${count}x: ${reason}`);
  }
  return dataset;
}

async function fetchOffchainMetadataJson(uri) {
  if (!uri) return null;
  const response = await fetch(uri, {
    headers: { "user-agent": "traxr-solana/fetch-meteora-metadata" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function resolveMeteoraMintMetadata(umi, mint, cache) {
  if (!mint) {
    return {
      mint: null,
      name: null,
      symbol: null,
      logo: null,
      found: false,
      reason: "missing mint",
    };
  }
  if (cache.has(mint)) return cache.get(mint);

  const promise = (async () => {
    const metadata = await safeFetchMetadataFromSeeds(umi, {
      mint: publicKey(mint),
    });
    if (!metadata) {
      return {
        mint,
        name: null,
        symbol: null,
        logo: null,
        uri: null,
        found: false,
        reason: "no onchain metadata",
        isMutable: null,
        updateAuthority: null,
        lastCheckedAt: new Date().toISOString(),
      };
    }

    const uri = cleanText(metadata.uri);
    console.log("DEBUG URI:", uri);
    let logo = null;
    let reason = null;
    if (uri) {
      try {
        const offchain = await fetchOffchainMetadataJson(uri);
        logo = cleanText(offchain?.image) || null;
      } catch (error) {
        reason = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      mint,
      name: cleanText(metadata.name),
      symbol: cleanText(metadata.symbol),
      logo,
      uri,
      found: true,
      reason,
      isMutable: cleanOptionalBool(metadata.isMutable),
      updateAuthority: metadata.updateAuthority?.toString?.() || null,
      lastCheckedAt: new Date().toISOString(),
    };
  })().catch((error) => ({
    mint,
    name: null,
    symbol: null,
    logo: null,
    uri: null,
    found: false,
    reason: error instanceof Error ? error.message : String(error),
    isMutable: null,
    updateAuthority: null,
    lastCheckedAt: new Date().toISOString(),
  }));

  cache.set(mint, promise);
  return promise;
}

function applyMeteoraMetadata(row, tokenA, tokenB) {
  const updates = {
    mintA_name: tokenA.name || row.mintA_name || null,
    mintA_symbol: tokenA.symbol || row.mintA_symbol || null,
    mintA_logo: tokenA.logo || row.mintA_logo || null,
    tokenALogo: tokenA.logo || row.tokenALogo || null,
    mintB_name: tokenB.name || row.mintB_name || null,
    mintB_symbol: tokenB.symbol || row.mintB_symbol || null,
    mintB_logo: tokenB.logo || row.mintB_logo || null,
    tokenBLogo: tokenB.logo || row.tokenBLogo || null,
  };
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    const prev = row[key] ?? null;
    const next = value ?? null;
    if (prev !== next) {
      row[key] = next;
      changed = true;
    }
  }
  return changed;
}

async function enrichMeteoraMetadata(dataset, label = "Meteora", datasetName = "") {
  if (!dataset.length) return dataset;
  if (!NODEZERO_RPC_KEY) {
    console.warn(`[nodezero] NODEZERO_RPC_KEY missing, skipping ${label} metadata enrichment`);
    return dataset;
  }

  const umi = buildMeteoraUmi();
  const persistentStore = loadMeteoraMetadataStore();
  const priorSnapshotStore = buildPriorSnapshotMetadataMap(datasetName);
  const metadataCache = new Map();
  const uniqueMints = [];
  const seenMints = new Set();
  for (const row of dataset) {
    for (const mint of [row.mintA ?? row.raw?.mint_x, row.mintB ?? row.raw?.mint_y]) {
      if (mint && !seenMints.has(mint)) {
        seenMints.add(mint);
        uniqueMints.push(mint);
      }
    }
  }

  let metadataResolved = 0;
  let metadataReused = 0;
  let metadataFetchSkipped = 0;
  const metadataReasons = new Map();
  for (let i = 0; i < uniqueMints.length; i += 1) {
    const mint = uniqueMints[i];
    const cachedMetadata = mergeMeteoraMetadataEntries(
      persistentStore.get(mint),
      priorSnapshotStore.get(mint),
    );
    if (
      cleanText(cachedMetadata.name) ||
      cleanText(cachedMetadata.symbol) ||
      cleanText(cachedMetadata.logo)
    ) {
      metadataReused += 1;
      if (shouldSkipMeteoraMetadataFetch(cachedMetadata)) {
        metadataCache.set(mint, Promise.resolve(cachedMetadata));
        persistentStore.set(mint, mergeMeteoraMetadataEntries(cachedMetadata));
        metadataFetchSkipped += 1;
        continue;
      }
    } else if (shouldSkipMeteoraMetadataFetch(cachedMetadata)) {
      metadataCache.set(mint, Promise.resolve(cachedMetadata));
      persistentStore.set(mint, mergeMeteoraMetadataEntries(cachedMetadata));
      metadataFetchSkipped += 1;
      continue;
    }

    const metadata = await resolveMeteoraMintMetadata(umi, mint, metadataCache);
    const mergedMetadata = mergeMeteoraMetadataEntries(cachedMetadata, metadata);
    metadataCache.set(mint, Promise.resolve(mergedMetadata));
    persistentStore.set(mint, mergedMetadata);
    if (metadata.found) {
      metadataResolved += 1;
    } else {
      const key = metadata.reason || "unknown";
      metadataReasons.set(key, (metadataReasons.get(key) || 0) + 1);
    }
    if (i + 1 < uniqueMints.length) {
      await sleep(METEORA_INTER_MINT_DELAY_MS);
    }
  }

  saveMeteoraMetadataStore(persistentStore);

  let metadataRowsUpdated = 0;
  for (const row of dataset) {
    const tokenA =
      (await metadataCache.get(row.mintA ?? row.raw?.mint_x)) ||
      { name: null, symbol: null, logo: null };
    const tokenB =
      (await metadataCache.get(row.mintB ?? row.raw?.mint_y)) ||
      { name: null, symbol: null, logo: null };
    if (applyMeteoraMetadata(row, tokenA, tokenB)) {
      metadataRowsUpdated += 1;
    }
  }

  console.log(
    `[nodezero] ${label} metadata enrichment: uniqueMints=${uniqueMints.length}, reused=${metadataReused}, skipped=${metadataFetchSkipped}, resolved=${metadataResolved}, rowsUpdated=${metadataRowsUpdated}`,
  );
  for (const [reason, count] of metadataReasons.entries()) {
    console.log(`[nodezero] ${label} metadata issue ${count}x: ${reason}`);
  }

  return dataset;
}

async function enrichMeteoraDataset(dataset) {
  if (!dataset.length) return dataset;
  dataset = await enrichMeteoraMetadata(
    dataset,
    "Meteora DLMM",
    "meteora.dlmm.live.json",
  );
  if (!NODEZERO_RPC_KEY) {
    return dataset;
  }
  const connection = buildMeteoraConnection({
    rpcUrl: NODEZERO_RPC_URL,
    apiKey: NODEZERO_RPC_KEY,
  });

  let quoted = 0;
  let updated = 0;
  let failed = 0;
  let nonQuotable = 0;
  const skipReasons = new Map();
  const failureReasons = new Map();
  for (let idx = 0; idx < dataset.length; idx += 1) {
    const entry = dataset[idx];
    const viable = isViableMeteoraPool(entry, {
      minLiquidityUsd: METEORA_MIN_LIQUIDITY_USD,
      minVolume24hUsd: METEORA_MIN_VOLUME24H_USD,
    });
    if (!viable.ok) {
      skipReasons.set(viable.reason, (skipReasons.get(viable.reason) || 0) + 1);
      continue;
    }

    quoted += 1;
    const result = await quoteMeteoraImpact(entry, connection, {
      tradeSizeUsd: IMPACT_TRADE_SIZE_USD,
      rpcTimeoutMs: METEORA_RPC_TIMEOUT_MS,
      binArrayCount: METEORA_BIN_ARRAY_COUNT,
    });
    if (typeof result.value === "number" && Number.isFinite(result.value)) {
      entry.priceImpactPct = result.value;
      updated += 1;
    } else {
      failed += 1;
      if (result.reason && /insufficient liquidity in binarrays/i.test(result.reason)) {
        nonQuotable += 1;
      }
      const key = result.reason || "unknown";
      failureReasons.set(key, (failureReasons.get(key) || 0) + 1);
    }

    if (idx + 1 < dataset.length) {
      await sleep(METEORA_INTER_POOL_DELAY_MS);
    }
  }

  console.log(
    `[nodezero] Meteora impact enrichment: quoted=${quoted}, updated=${updated}, failed=${failed}, nonQuotable=${nonQuotable}`,
  );
  for (const [reason, count] of skipReasons.entries()) {
    console.log(`[nodezero] Meteora skipped ${count} pools: ${reason}`);
  }
  for (const [reason, count] of failureReasons.entries()) {
    console.log(`[nodezero] Meteora impact issue ${count}x: ${reason}`);
  }

  return dataset;
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

function enrichLocalPriceImpact(datasetName, dataset) {
  if (!Array.isArray(dataset) || !dataset.length) return dataset;

  const isConstantProductDataset =
    datasetName === "amm.live.json" ||
    datasetName === "cpmm.live.json" ||
    datasetName === "pumpswap.live.json";
  if (!isConstantProductDataset) return dataset;

  let updated = 0;
  let skipped = 0;
  const skipReasons = new Map();
  for (const entry of dataset) {
    const feePct = (() => {
      const raw =
        toNumber(entry?.feeRate) ??
        toNumber(entry?.config?.tradeFeeRate) ??
        null;
      if (raw === null) return null;
      if (raw <= 1) return raw * 100;
      return raw / 10000;
    })();
    const liquidityUsd = toNumber(entry?.tvl) ?? 0;
    const priceImpactPct = estimatePriceImpactPct(entry, {
      isOrca: false,
      isMeteora: false,
      liquidityUsd,
      feePct,
    });
    if (typeof priceImpactPct === "number" && Number.isFinite(priceImpactPct)) {
      entry.priceImpactPct = priceImpactPct;
      updated += 1;
    } else {
      skipped += 1;
      const reserveA = toNumber(entry?.mintAmountA);
      const reserveB = toNumber(entry?.mintAmountB);
      const price = toNumber(entry?.price);
      const tvlUsd = Number.isFinite(liquidityUsd) ? liquidityUsd : null;
      let reason = "unknown";
      if (reserveA === null || reserveB === null) reason = "missing reserves";
      else if (price === null) reason = "missing spot price";
      else if (tvlUsd === null || tvlUsd <= 0) reason = "missing tvl";
      else if (reserveA <= 0 || reserveB <= 0) reason = "zero reserves";
      else if (price <= 0) reason = "invalid spot price";
      else {
        const denom = reserveA * price + reserveB;
        if (!Number.isFinite(denom) || denom <= 0) reason = "invalid denominator";
        else {
          const priceBUsd = tvlUsd / denom;
          const priceAUsd = price * priceBUsd;
          if (
            !Number.isFinite(priceAUsd) ||
            !Number.isFinite(priceBUsd) ||
            priceAUsd <= 0 ||
            priceBUsd <= 0
          ) {
            reason = "invalid usd prices";
          } else {
            reason = "impact calc failed";
          }
        }
      }
      skipReasons.set(reason, (skipReasons.get(reason) || 0) + 1);
    }
  }

  console.log(
    `[nodezero] ${datasetName} local impact enrichment: updated=${updated}, skipped=${skipped}`,
  );
  for (const [reason, count] of skipReasons.entries()) {
    console.log(`[nodezero] ${datasetName} local impact issue ${count}x: ${reason}`);
  }
  return dataset;
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
    return toNumber(pool.tvl) ?? 0;
  })();

  let volume24hUsd = 0;
  if (isMeteora) {
    volume24hUsd =
      toNumber(pool.raw?.volume?.["24h"]) ??
      toNumber(pool.raw?.trade_volume_24h) ??
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
        toNumber(
          pool.raw?.pool_config?.base_fee_pct ??
            pool.raw?.dynamic_fee_pct ??
            pool.raw?.base_fee_percentage ??
            pool.raw?.max_fee_percentage,
        ) ?? null
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

function scorePool(datasetName, pool, context) {
  const metrics = normalizeForScoring(datasetName, pool, context);
  const { score } = calcCTSComponents(metrics);
  return {
    ctsScore: score,
    ctsNodes: countCTSNodes(score),
  };
}

function mergePriceImpactRows(baseRows, retryRows) {
  const map = new Map(baseRows.map((row) => [row.id || row.pool_id, row]));
  for (const row of retryRows) {
    const id = row.id || row.pool_id;
    if (!id) continue;
    const target = map.get(id);
    if (target) Object.assign(target, row);
    else baseRows.push(row);
  }
  return baseRows;
}

function runClmmPriceImpactBatch(stamp) {
  const script = path.join(__dirname, "recompute_clmm_priceimpact_native.js");
  const snapshotName = `clmm.live.json_${stamp}.json`;
  const baseOut = `clmm.live.json_${stamp}.priceimpact.batch.json`;
  const retryOut = `clmm.live.json_${stamp}.priceimpact.batch.retry.json`;
  const mergedOut = `clmm.live.json_${stamp}.priceimpact.batch.merged.json`;

  const baseArgs = [
    script,
    "--snapshot",
    snapshotName,
    "--trade-usd",
    String(CLMM_IMPACT_TRADE_USD),
    "--min-liquidity-usd",
    "1000",
    "--tick-array-window",
    String(CLMM_IMPACT_TICK_WINDOW),
    "--tick-array-limit",
    String(CLMM_IMPACT_TICK_LIMIT),
    "--state-batch-size",
    String(CLMM_IMPACT_STATE_BATCH),
    "--concurrency",
    "1",
    "--output",
    baseOut,
    "--write",
  ];

  let result = spawnSync("node", baseArgs, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("CLMM price impact batch pass failed");
  }

  const retryArgs = [
    script,
    "--snapshot",
    snapshotName,
    "--retry-from",
    baseOut,
    "--retry-only-failed",
    "--trade-usd",
    String(CLMM_IMPACT_TRADE_USD),
    "--min-liquidity-usd",
    "1000",
    "--tick-array-window",
    String(CLMM_IMPACT_RETRY_WINDOW),
    "--tick-array-limit",
    String(CLMM_IMPACT_RETRY_LIMIT),
    "--state-batch-size",
    String(CLMM_IMPACT_STATE_BATCH),
    "--concurrency",
    "1",
    "--output",
    retryOut,
    "--write",
  ];

  result = spawnSync("node", retryArgs, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("CLMM price impact retry pass failed");
  }

  const baseRows = JSON.parse(
    fs.readFileSync(path.join(OUTPUT_DIR, baseOut), "utf8"),
  );
  const retryRows = JSON.parse(
    fs.readFileSync(path.join(OUTPUT_DIR, retryOut), "utf8"),
  );
  const mergedRows = mergePriceImpactRows(baseRows, retryRows);
  const mergedPath = path.join(OUTPUT_DIR, mergedOut);
  fs.writeFileSync(mergedPath, JSON.stringify(mergedRows, null, 2));
  console.log(`[nodezero] CLMM price impact merged rows=${mergedRows.length} -> ${mergedPath}`);
  return mergedRows;
}

function runPumpswapSnapshot(stamp, stampMs, historicalSeries) {
  const fetchScript = path.join(__dirname, "fetch_pumpswap_pools_full.js");
  const enrichScript = path.join(__dirname, "enrich_pumpswap_metadata.js");
  const activityScript = path.join(__dirname, "enrich_pumpswap_market_activity.js");
  const baseOut = `pumpswap.live.json_${stamp}.json`;
  const metaOut = `pumpswap.live.json_${stamp}.metadata.json`;
  const activityOut = `pumpswap.live.json_${stamp}.activity.json`;
  const baseOutPath = path.join(OUTPUT_DIR, baseOut);
  const metaOutPath = path.join(OUTPUT_DIR, metaOut);
  const activityOutPath = path.join(OUTPUT_DIR, activityOut);

  console.log("[nodezero] Pumpswap snapshot: fetch start");
  const fetchArgs = [
    fetchScript,
    "--output",
    "data/pumpswap.live.json",
    "--pool-index",
    PUMPSWAP_POOL_INDEX,
    "--gpa-rpc",
    PUMPSWAP_GPA_RPC,
    "--data-rpc",
    PUMPSWAP_DATA_RPC,
    "--batch-size",
    String(PUMPSWAP_BATCH_SIZE),
    "--concurrency",
    String(PUMPSWAP_CONCURRENCY),
    "--throttle-ms",
    String(PUMPSWAP_THROTTLE_MS),
    "--cache-decimals",
    "--min-liquidity-usd",
    String(PUMPSWAP_MIN_LIQUIDITY_USD),
    "--stamp",
    stamp,
  ];
  if (PUMPSWAP_FEE_PCT) {
    fetchArgs.push("--fee-pct", PUMPSWAP_FEE_PCT);
  } else if (PUMPSWAP_FEE_RATE) {
    fetchArgs.push("--fee-rate", PUMPSWAP_FEE_RATE);
  }
  if (PUMPSWAP_REFRESH_FROM) {
    let refreshFrom = PUMPSWAP_REFRESH_FROM;
    if (refreshFrom === "latest") {
      const candidates = fs
        .readdirSync(OUTPUT_DIR)
        .filter(
          (name) =>
            name.startsWith("pumpswap.live.json_") &&
            name.endsWith(".json") &&
            !name.includes(".metadata.") &&
            !name.includes(".activity."),
        )
        .sort();
      if (candidates.length) {
        refreshFrom = path.join("data", candidates[candidates.length - 1]);
      } else {
        refreshFrom = "";
      }
    }
    if (refreshFrom) {
      fetchArgs.push("--refresh-from", refreshFrom);
    }
  }
  let result = spawnSync("node", fetchArgs, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("Pumpswap fetch failed");
  }
  if (!fs.existsSync(baseOutPath)) {
    const candidates = fs
      .readdirSync(OUTPUT_DIR)
      .filter((name) => name.startsWith("pumpswap.live.json_"))
      .slice(-10);
    throw new Error(
      `Pumpswap fetch missing output ${baseOutPath}. Candidates: ${candidates.join(", ")}`,
    );
  }

  console.log("[nodezero] Pumpswap snapshot: metadata enrich start");
  const enrichArgs = [
    enrichScript,
    "--snapshot",
    `data/${baseOut}`,
    "--output",
    `data/${metaOut}`,
    "--cache",
    "data/pumpswap.mint_metadata.json",
    "--delay-ms",
    String(PUMPSWAP_METADATA_DELAY_MS),
    "--rpc-timeout-ms",
    String(PUMPSWAP_METADATA_RPC_TIMEOUT_MS),
    "--offchain-timeout-ms",
    String(PUMPSWAP_METADATA_OFFCHAIN_TIMEOUT_MS),
  ];
  result = spawnSync("node", enrichArgs, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("Pumpswap metadata enrichment failed");
  }

  console.log("[nodezero] Pumpswap snapshot: activity enrich start");
  const activityArgs = [
    activityScript,
    "--snapshot",
    `data/${metaOut}`,
    "--output",
    `data/${activityOut}`,
    "--source",
    PUMPSWAP_ACTIVITY_SOURCE,
    "--chunk-size",
    String(PUMPSWAP_ACTIVITY_CHUNK),
    "--intervals",
    PUMPSWAP_ACTIVITY_INTERVALS,
    "--metrics",
    PUMPSWAP_ACTIVITY_METRICS,
    "--sleep-ms",
    String(PUMPSWAP_ACTIVITY_SLEEP_MS),
  ];
  result = spawnSync("node", activityArgs, { encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("Pumpswap market activity enrichment failed");
  }

  let enriched = JSON.parse(fs.readFileSync(activityOutPath, "utf8"));
  enriched = enrichLocalPriceImpact("pumpswap.live.json", enriched);
  const context = {
    solUsd: estimateSolUsdFromDataset(enriched),
    volatilityByPool: buildVolatilityByPool(historicalSeries, stampMs, enriched),
  };
  const scored = enriched.map((entry) => ({
    ...entry,
    ...scorePool("pumpswap.live.json", entry, context),
  }));

  fs.writeFileSync(baseOutPath, JSON.stringify(scored, null, 2));
  console.log(`[nodezero] Pumpswap snapshot written ${scored.length} -> ${baseOutPath}`);

  try {
    fs.unlinkSync(metaOutPath);
  } catch {}
  try {
    fs.unlinkSync(activityOutPath);
  } catch {}

  return scored;
}

async function main() {
  updatePipelineStatus(
    "running",
    "frontend_refresh",
    "Refreshing frontend snapshots",
    { datasets: ACTIVE_DATASETS, pumpswap: PUMPSWAP_ENABLED, sqliteImport: SQLITE_IMPORT },
  );

  if (!API_KEY) {
    console.error("[nodezero] Missing NODEZERO_API_KEY");
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  const meta = readCacheMeta();
  const stamp = timestampSlug();
  const stampMs = parseTimestampSlug(stamp) ?? Date.now();
  const results = await Promise.all(
    ACTIVE_DATASETS.map((name) => fetchDataset(name, meta)),
  );
  const historicalSeries = buildHistoricalPriceSeriesByPool();

  for (let idx = 0; idx < ACTIVE_DATASETS.length; idx += 1) {
    const name = ACTIVE_DATASETS[idx];
    const context = {
      solUsd: estimateSolUsdFromDataset(results[idx]),
      volatilityByPool: buildVolatilityByPool(historicalSeries, stampMs, results[idx]),
    };
    let sourceDataset =
      name === "orca.live.json"
        ? await enrichOrcaPriceImpact(results[idx])
        : name === "meteora.dlmm.live.json"
          ? await enrichMeteoraDataset(results[idx])
          : name === "meteora.dammv2.live.json"
            ? await enrichMeteoraMetadata(
                results[idx],
                "Meteora DAMM v2",
                "meteora.dammv2.live.json",
              )
        : enrichLocalPriceImpact(name, results[idx]);

    const isClmm = name === "clmm.live.json";
    if (isClmm && CLMM_BATCH_PRICEIMPACT) {
      const stampedPath = path.join(
        OUTPUT_DIR,
        `${name.replace(/\\.json$/, "")}_${stamp}.json`,
      );
      fs.writeFileSync(stampedPath, JSON.stringify(sourceDataset, null, 2));
      console.log(`[nodezero] CLMM raw snapshot written for impact: ${stampedPath}`);
      try {
        sourceDataset = runClmmPriceImpactBatch(stamp);
      } catch (error) {
        console.error(
          "[nodezero] CLMM price impact batch failed, continuing without it",
          error instanceof Error ? error.message : String(error),
        );
      }
    }
    const dataset = sourceDataset.map((entry) => ({
      ...entry,
      ...scorePool(name, entry, context),
    }));
    const stampedPath = path.join(
      OUTPUT_DIR,
      `${name.replace(/\\.json$/, "")}_${stamp}.json`,
    );

    fs.writeFileSync(stampedPath, JSON.stringify(dataset, null, 2));
    console.log(`[nodezero] Wrote ${dataset.length} pools to ${stampedPath}`);
  }

  if (PUMPSWAP_ENABLED) {
    updatePipelineStatus(
      "running",
      "pumpswap_refresh",
      "Refreshing PumpSwap snapshot",
      { dataset: "pumpswap.live.json" },
    );
    try {
      runPumpswapSnapshot(stamp, stampMs, historicalSeries);
    } catch (error) {
      console.error(
        "[nodezero] Pumpswap snapshot failed",
        error instanceof Error ? error.message : String(error),
      );
      updatePipelineStatus("error", "pumpswap_failed", "PumpSwap refresh failed");
      process.exit(1);
    }
  }

  // Remove any non-stamped dataset files in the output dir.
  const outputFiles = fs.readdirSync(OUTPUT_DIR);
  for (const name of ACTIVE_DATASETS) {
    if (outputFiles.includes(name)) {
      try {
        fs.unlinkSync(path.join(OUTPUT_DIR, name));
      } catch {}
    }
  }
  if (outputFiles.includes("pumpswap.live.json")) {
    try {
      fs.unlinkSync(path.join(OUTPUT_DIR, "pumpswap.live.json"));
    } catch {}
  }

  writeCacheMeta(meta);
  console.log(`[nodezero] Output directory cleaned (timestamped files only).`);

  if (SQLITE_IMPORT) {
    const sqliteScript = path.join(__dirname, "build_snapshot_sqlite.js");
    console.log("[nodezero] SQLite import: start");
    updatePipelineStatus(
      "running",
      "sqlite_import",
      "Importing refreshed snapshots into SQLite",
      { datasets: ACTIVE_DATASETS, totalDatasets: ACTIVE_DATASETS.length },
    );
    let result = { status: 0 };
    if (ACTIVE_DATASETS.length) {
      for (let idx = 0; idx < ACTIVE_DATASETS.length; idx += 1) {
        const datasetName = ACTIVE_DATASETS[idx];
        updatePipelineStatus(
          "running",
          "sqlite_import",
          `Importing ${datasetName} into SQLite`,
          {
            dataset: datasetName,
            datasetIndex: idx + 1,
            totalDatasets: ACTIVE_DATASETS.length,
          },
        );
        result = spawnSync("node", [sqliteScript, "--latest", "--dataset", datasetName], {
          encoding: "utf8",
          stdio: "inherit",
        });
        if (result.status !== 0) break;
      }
    } else {
      result = spawnSync("node", [sqliteScript, "--latest"], {
        encoding: "utf8",
        stdio: "inherit",
      });
    }
    if (result.status !== 0) {
      console.error("[nodezero] SQLite import failed");
      updatePipelineStatus("error", "sqlite_import_failed", "SQLite import failed");
      process.exit(result.status || 1);
    } else {
      console.log("[nodezero] SQLite import: done");
    }

    if (PUMPSWAP_ENABLED) {
      const pumpSqliteScript = path.join(__dirname, "build_pumpswap_sqlite.js");
      updatePipelineStatus(
        "running",
        "sqlite_import",
        "Importing pumpswap.live.json into SQLite",
        { dataset: "pumpswap.live.json" },
      );
      const pumpResult = spawnSync(
        "node",
        [
          pumpSqliteScript,
          "--file",
          `pumpswap.live.json_${stamp}.json`,
        ],
        { encoding: "utf8", stdio: "inherit" },
      );
      if (pumpResult.status !== 0) {
        console.error("[nodezero] PumpSwap SQLite import failed");
        updatePipelineStatus(
          "error",
          "sqlite_import_failed",
          "PumpSwap SQLite import failed",
        );
        process.exit(pumpResult.status || 1);
      }
    }
  }

  if (COMPRESS_SNAPSHOTS) {
    const compressScript = path.join(__dirname, "compress_snapshots.js");
    updatePipelineStatus(
      "running",
      "snapshot_compression",
      "Compressing historical JSON snapshots",
      { keepLatest: COMPRESS_KEEP_LATEST },
    );
    const compressResult = spawnSync(
      "node",
      [compressScript, "--keep-latest", String(COMPRESS_KEEP_LATEST)],
      { encoding: "utf8", stdio: "inherit" },
    );
    if (compressResult.status !== 0) {
      console.error("[nodezero] Snapshot compression failed");
      updatePipelineStatus(
        "error",
        "snapshot_compression_failed",
        "Snapshot compression failed",
      );
      process.exit(compressResult.status || 1);
    } else {
      console.log("[nodezero] Snapshot compression: done");
    }
  }

  if (HELPER_RETENTION_ENABLED) {
    updatePipelineStatus(
      "running",
      "helper_cleanup",
      "Pruning helper artifacts",
      {
        clmmKeep: HELPER_KEEP_CLMM_BATCH,
        pumpswapMetaKeep: HELPER_KEEP_PUMPSWAP_META,
        pumpswapActivityKeep: HELPER_KEEP_PUMPSWAP_ACTIVITY,
        pumpswapFullKeep: HELPER_KEEP_PUMPSWAP_FULL,
      },
    );
    const helperStats = pruneHelperArtifacts();
    console.log("[nodezero] Helper cleanup stats", helperStats);
  }

  const backupSchedule = evaluateSqliteBackupSchedule();
  if (backupSchedule.shouldRun) {
    updatePipelineStatus(
      "running",
      "sqlite_backup",
      "Backing up SQLite datasets",
      {
        backupDir: SQLITE_BACKUP_DIR,
        statePath: SQLITE_BACKUP_STATE_PATH,
        intervalDays: SQLITE_BACKUP_INTERVAL_DAYS,
        keepWeekly: SQLITE_BACKUP_KEEP_WEEKLY,
        keepMonthly: SQLITE_BACKUP_KEEP_MONTHLY,
        reason: backupSchedule.reason,
      },
    );
    try {
      const backupStats = backupSqliteDatabases();
      const completedAt = new Date().toISOString();
      saveSqliteBackupState({
        lastSuccessfulBackupAt: completedAt,
        lastBackupDir: backupStats.backupDir,
        lastBackupStamp: backupStats.stamp,
        dbCount: backupStats.dbCount,
      });
      console.log("[nodezero] SQLite backup: done", backupStats);
    } catch (error) {
      console.error(
        "[nodezero] SQLite backup failed",
        error instanceof Error ? error.message : String(error),
      );
      updatePipelineStatus("error", "sqlite_backup_failed", "SQLite backup failed");
      process.exit(1);
    }
  } else if (SQLITE_BACKUP_ENABLED) {
    console.log("[nodezero] SQLite backup: skipped", backupSchedule);
  }

  updatePipelineStatus(
    "done",
    "complete",
    SQLITE_IMPORT
      ? "Pipeline + publish + frontend refresh + SQLite import finished successfully"
      : "Pipeline + publish + frontend refresh finished successfully",
    { datasets: ACTIVE_DATASETS, pumpswap: PUMPSWAP_ENABLED, sqliteImport: SQLITE_IMPORT },
  );
}

main().catch((err) => {
  console.error("[nodezero] Fetch failed", err);
  updatePipelineStatus(
    "error",
    "frontend_refresh_failed",
    err?.message || "Frontend refresh failed",
  );
  process.exit(1);
});
