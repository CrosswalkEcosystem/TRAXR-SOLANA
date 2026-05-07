#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_WORKERS = 10;
const DEFAULT_TICK_ARRAY_WINDOW = 2;
const DEFAULT_TICK_ARRAY_LIMIT = 8;
const DEFAULT_RETRY_WINDOW = 5;
const DEFAULT_RETRY_LIMIT = 24;

function parseArgs(argv) {
  const snapshotIndex = argv.indexOf("--snapshot");
  const workersIndex = argv.indexOf("--workers");
  const outputIndex = argv.indexOf("--output");
  const minLiqIndex = argv.indexOf("--min-liquidity-usd");
  const windowIndex = argv.indexOf("--tick-array-window");
  const limitIndex = argv.indexOf("--tick-array-limit");
  const retryIndex = argv.indexOf("--retry");
  const retryWindowIndex = argv.indexOf("--retry-window");
  const retryLimitIndex = argv.indexOf("--retry-limit");
  const batchIndex = argv.indexOf("--state-batch-size");
  return {
    snapshot:
      snapshotIndex >= 0 && argv[snapshotIndex + 1]
        ? argv[snapshotIndex + 1]
        : null,
    workers:
      workersIndex >= 0 && argv[workersIndex + 1]
        ? Math.max(1, Number(argv[workersIndex + 1]))
        : DEFAULT_WORKERS,
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : "clmm.priceimpact.parallel.json",
    minLiquidityUsd:
      minLiqIndex >= 0 && argv[minLiqIndex + 1]
        ? Number(argv[minLiqIndex + 1])
        : null,
    tickArrayWindow:
      windowIndex >= 0 && argv[windowIndex + 1]
        ? Math.max(1, Number(argv[windowIndex + 1]))
        : DEFAULT_TICK_ARRAY_WINDOW,
    tickArrayLimit:
      limitIndex >= 0 && argv[limitIndex + 1]
        ? Math.max(1, Number(argv[limitIndex + 1]))
        : DEFAULT_TICK_ARRAY_LIMIT,
    retry: retryIndex === -1 || argv[retryIndex + 1] !== "false",
    retryWindow:
      retryWindowIndex >= 0 && argv[retryWindowIndex + 1]
        ? Math.max(1, Number(argv[retryWindowIndex + 1]))
        : DEFAULT_RETRY_WINDOW,
    retryLimit:
      retryLimitIndex >= 0 && argv[retryLimitIndex + 1]
        ? Math.max(1, Number(argv[retryLimitIndex + 1]))
        : DEFAULT_RETRY_LIMIT,
    stateBatchSize:
      batchIndex >= 0 && argv[batchIndex + 1]
        ? Math.max(1, Number(argv[batchIndex + 1]))
        : 200,
  };
}

function printHelp() {
  console.log(`Usage:
  node scripts/recompute_clmm_priceimpact_parallel.js --snapshot <file> [options]

Options:
  --workers 10
  --output clmm.priceimpact.parallel.json
  --min-liquidity-usd 1000
  --tick-array-window 2
  --tick-array-limit 8
  --retry true|false
  --retry-window 5
  --retry-limit 24
  --state-batch-size 200
`);
}

function readSnapshotRows(snapshot) {
  const filePath = path.isAbsolute(snapshot)
    ? snapshot
    : path.join(DATA_DIR, snapshot);
  const rows = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error(`${snapshot} is not a JSON array`);
  }
  return { rows, filePath };
}

function spawnWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`worker exited with code ${code}`));
    });
  });
}

function mergeSnapshots(basePath, patchPath, outPath) {
  const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
  const patch = JSON.parse(fs.readFileSync(patchPath, "utf8"));
  const map = new Map(base.map((row) => [row.id || row.pool_id, row]));
  for (const row of patch) {
    const id = row.id || row.pool_id;
    if (!id) continue;
    if (!row.priceImpactMethod) continue;
    if (!String(row.priceImpactMethod).startsWith("exact_native_clmm")) continue;
    const target = map.get(id);
    if (!target) continue;
    target.priceImpactPct = row.priceImpactPct ?? null;
    target.priceImpactMethod = row.priceImpactMethod;
    target.priceImpactTradeUsd = row.priceImpactTradeUsd ?? target.priceImpactTradeUsd;
    if (row.priceImpactReason) {
      target.priceImpactReason = row.priceImpactReason;
    } else {
      delete target.priceImpactReason;
    }
  }
  fs.writeFileSync(outPath, JSON.stringify(base, null, 2));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printHelp();
    return;
  }
  if (!opts.snapshot) {
    throw new Error("Missing --snapshot");
  }

  const { rows } = readSnapshotRows(opts.snapshot);
  const total = rows.length;
  const chunk = Math.ceil(total / opts.workers);

  console.log(`snapshot: ${opts.snapshot}`);
  console.log(`total: ${total}`);
  console.log(`workers: ${opts.workers}`);
  console.log(`chunk: ${chunk}`);
  console.log(`output: ${opts.output}`);
  console.log(`tickArrayWindow: ${opts.tickArrayWindow}`);
  console.log(`tickArrayLimit: ${opts.tickArrayLimit}`);
  if (opts.minLiquidityUsd) {
    console.log(`minLiquidityUsd: ${opts.minLiquidityUsd}`);
  }
  console.log("");

  const partPaths = [];
  const workers = [];
  for (let i = 0; i < opts.workers; i += 1) {
    const offset = i * chunk;
    if (offset >= total) break;
    const limit = Math.min(chunk, total - offset);
    const partName = opts.output.replace(/\.json$/i, `.part${String(i + 1).padStart(2, "0")}.json`);
    partPaths.push(partName);
    const args = [
      path.join(__dirname, "recompute_clmm_priceimpact_native.js"),
      "--snapshot",
      opts.snapshot,
      "--offset",
      String(offset),
      "--limit",
      String(limit),
      "--tick-array-window",
      String(opts.tickArrayWindow),
      "--tick-array-limit",
      String(opts.tickArrayLimit),
      "--state-batch-size",
      String(opts.stateBatchSize),
      "--concurrency",
      "1",
      "--output",
      partName,
      "--write",
    ];
    if (opts.minLiquidityUsd) {
      args.push("--min-liquidity-usd", String(opts.minLiquidityUsd));
    }
    workers.push(spawnWorker(args));
  }

  await Promise.all(workers);

  const basePath = path.join(DATA_DIR, opts.snapshot);
  const outPath = path.join(DATA_DIR, opts.output);
  fs.writeFileSync(outPath, fs.readFileSync(basePath));
  for (const partName of partPaths) {
    const partPath = path.join(DATA_DIR, partName);
    mergeSnapshots(outPath, partPath, outPath);
  }
  console.log(`merged fastpass into ${outPath}`);

  if (!opts.retry) return;

  const retryName = opts.output.replace(/\.json$/i, ".retry.json");
  const retryArgs = [
    path.join(__dirname, "recompute_clmm_priceimpact_native.js"),
    "--snapshot",
    opts.snapshot,
    "--retry-from",
    opts.output,
    "--retry-only-failed",
    "--tick-array-window",
    String(opts.retryWindow),
    "--tick-array-limit",
    String(opts.retryLimit),
    "--state-batch-size",
    String(opts.stateBatchSize),
    "--concurrency",
    "1",
    "--output",
    retryName,
    "--write",
  ];
  if (opts.minLiquidityUsd) {
    retryArgs.push("--min-liquidity-usd", String(opts.minLiquidityUsd));
  }
  await spawnWorker(retryArgs);
  mergeSnapshots(outPath, path.join(DATA_DIR, retryName), outPath);
  console.log(`merged retry into ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
