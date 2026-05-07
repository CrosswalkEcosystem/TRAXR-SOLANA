#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  DEFAULT_BIN_ARRAY_COUNT,
  DEFAULT_MIN_LIQUIDITY_USD,
  DEFAULT_MIN_VOLUME24H_USD,
  DEFAULT_RPC_TIMEOUT_MS,
  DEFAULT_TRADE_SIZE_USD,
  buildMeteoraConnection,
  getMeteoraPoolId,
  isViableMeteoraPool,
  quoteMeteoraImpact,
  toNumber,
} = require("./lib/meteoraImpact");

const DATA_DIR = path.join(__dirname, "..", "data");
const METEORA_FILE_RE =
  /^meteora\.dlmm\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const TRADE_SIZE_USD = DEFAULT_TRADE_SIZE_USD;
const RPC_TIMEOUT_MS = DEFAULT_RPC_TIMEOUT_MS;
const MIN_LIQUIDITY_USD = DEFAULT_MIN_LIQUIDITY_USD;
const MIN_VOLUME24H_USD = DEFAULT_MIN_VOLUME24H_USD;
const INTER_POOL_DELAY_MS = 200;
const BIN_ARRAY_COUNT = DEFAULT_BIN_ARRAY_COUNT;

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
  return {
    dryRun: !argv.includes("--write"),
    latest: argv.includes("--latest") || snapshotIndex === -1,
    snapshot:
      snapshotIndex >= 0 && argv[snapshotIndex + 1]
        ? argv[snapshotIndex + 1]
        : null,
    poolId:
      argv.includes("--pool") && argv[argv.indexOf("--pool") + 1]
        ? argv[argv.indexOf("--pool") + 1]
        : null,
    rpcUrl:
      argv.includes("--rpc-url") && argv[argv.indexOf("--rpc-url") + 1]
        ? argv[argv.indexOf("--rpc-url") + 1]
        : DEFAULT_RPC_URL,
  };
}

function printHelp() {
  console.log(`Usage:
  npm run repair:meteora-impact
  npm run repair:meteora-impact -- --latest
  npm run repair:meteora-impact -- --snapshot meteora.dlmm.live.json_<timestamp>.json
  npm run repair:meteora-impact -- --pool <POOL_ID>
  npm run repair:meteora-impact:write -- --latest

Defaults:
  latest snapshot only
  trade size = $${TRADE_SIZE_USD}
  rpc-url = ${DEFAULT_RPC_URL}
  min liquidity = $${MIN_LIQUIDITY_USD}
  min 24h volume = $${MIN_VOLUME24H_USD}
  bin arrays = ${BIN_ARRAY_COUNT}
  inter-pool delay = ${INTER_POOL_DELAY_MS}ms

Required env:
  NODEZERO_RPC_KEY
`);
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listSnapshots() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => METEORA_FILE_RE.test(name))
    .map((name) => {
      const match = name.match(METEORA_FILE_RE);
      return {
        name,
        fullPath: path.join(DATA_DIR, name),
        stamp: match ? match[1] : "",
      };
    })
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

function pickSnapshots(opts) {
  const snapshots = listSnapshots();
  if (!snapshots.length) {
    throw new Error(`No Meteora snapshot files found in ${DATA_DIR}`);
  }
  if (opts.snapshot) {
    const found = snapshots.find((file) => file.name === opts.snapshot);
    if (!found) throw new Error(`Snapshot not found: ${opts.snapshot}`);
    return [found];
  }
  if (opts.latest) return [snapshots[0]];
  return snapshots;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function processSnapshot(fileInfo, opts, connection) {
  const startedAt = Date.now();
  const raw = JSON.parse(fs.readFileSync(fileInfo.fullPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`${fileInfo.name} is not a JSON array`);
  }

  const candidates = opts.poolId
    ? raw.filter((entry) => getMeteoraPoolId(entry) === opts.poolId)
    : raw;
  if (!candidates.length) {
    throw new Error(
      opts.poolId
        ? `Pool ${opts.poolId} not found in ${fileInfo.name}`
        : `No pools in ${fileInfo.name}`,
    );
  }

  const pools = [];
  let skipped = 0;
  const skipReasons = new Map();
  for (const entry of candidates) {
    const viable = isViableMeteoraPool(entry);
    if (opts.poolId || viable.ok) {
      pools.push(entry);
    } else {
      skipped += 1;
      skipReasons.set(viable.reason, (skipReasons.get(viable.reason) || 0) + 1);
    }
  }

  if (!pools.length) {
    return {
      file: fileInfo.name,
      pools: 0,
      candidates: candidates.length,
      skipped,
      changed: 0,
      success: 0,
      failed: 0,
      nonQuotable: 0,
      elapsedMs: Date.now() - startedAt,
      reasons: skipReasons,
    };
  }

  let changed = 0;
  let success = 0;
  let failed = 0;
  let nonQuotable = 0;
  const reasons = new Map();

  for (let idx = 0; idx < pools.length; idx += 1) {
    const entry = pools[idx];
    const quoteStart = Date.now();
    const result = await quoteMeteoraImpact(entry, connection, {
      tradeSizeUsd: TRADE_SIZE_USD,
      rpcTimeoutMs: RPC_TIMEOUT_MS,
      binArrayCount: BIN_ARRAY_COUNT,
    });
    const prev = toNumber(entry.priceImpactPct);
    const next = result.value;
    const shouldWrite =
      (prev === null && next !== null) ||
      (prev !== null && next !== null && Math.abs(prev - next) > 1e-12);

    if (shouldWrite) {
      entry.priceImpactPct = next;
      changed += 1;
    }

    if (next !== null) {
      success += 1;
    } else {
      failed += 1;
      if (
        result.reason &&
        /insufficient liquidity|out of bounds|traversed too many arrays/i.test(
          result.reason,
        )
      ) {
        nonQuotable += 1;
      }
      const key = result.reason || "unknown";
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }

    const poolId = getMeteoraPoolId(entry);
    console.log(
      `${fileInfo.name} :: ${poolId} :: ${
        next === null ? "n/a" : `${next.toFixed(6)}%`
      } :: ${formatMs(Date.now() - quoteStart)}${result.reason ? ` :: ${result.reason}` : ""}`,
    );

    if (idx + 1 < pools.length) {
      await sleep(INTER_POOL_DELAY_MS);
    }
  }

  if (!opts.dryRun && changed > 0) {
    fs.writeFileSync(fileInfo.fullPath, JSON.stringify(raw, null, 2));
  }

  return {
    file: fileInfo.name,
    pools: pools.length,
    candidates: candidates.length,
    skipped,
    changed,
    success,
    failed,
    nonQuotable,
    elapsedMs: Date.now() - startedAt,
    reasons: new Map([...reasons, ...skipReasons]),
  };
}

async function main() {
  initEnv();
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }
  const opts = parseArgs(args);
  const files = pickSnapshots(opts);
  const connection = buildMeteoraConnection({ rpcUrl: opts.rpcUrl });

  console.log(
    `${opts.dryRun ? "[DRY RUN]" : "[WRITE]"} Meteora price impact recompute`,
  );
  console.log(`RPC URL: ${opts.rpcUrl}`);
  console.log(`Trade size: $${TRADE_SIZE_USD}`);
  console.log(`Snapshots: ${files.map((f) => f.name).join(", ")}`);
  if (opts.poolId) {
    console.log(`Pool filter: ${opts.poolId}`);
  }
  console.log("");

  const allReasons = new Map();
  const startedAt = Date.now();

  for (const file of files) {
    const result = await processSnapshot(file, opts, connection);
    console.log("");
    console.log(
      `Summary ${result.file}: candidates=${result.candidates}, quoted=${result.pools}, skipped=${result.skipped}, changed=${result.changed}, success=${result.success}, failed=${result.failed}, nonQuotable=${result.nonQuotable}, elapsed=${formatMs(result.elapsedMs)}`,
    );
    for (const [reason, count] of result.reasons.entries()) {
      allReasons.set(reason, (allReasons.get(reason) || 0) + count);
    }
    console.log("");
  }

  console.log(`Total elapsed: ${formatMs(Date.now() - startedAt)}`);
  if (allReasons.size) {
    console.log("Failure reasons:");
    for (const [reason, count] of allReasons.entries()) {
      console.log(`- ${count}x ${reason}`);
    }
  }
}

main().catch((error) => {
  console.error("");
  console.error("Run failed:");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
