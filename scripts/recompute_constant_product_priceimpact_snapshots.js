#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const FILE_RE =
  /^(amm|cpmm)\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const TRADE_SIZE_USD = 1_000;

function parseArgs(argv) {
  const snapshotIndex = argv.indexOf("--snapshot");
  return {
    dryRun: !argv.includes("--write"),
    latest: argv.includes("--latest") || snapshotIndex === -1,
    snapshot:
      snapshotIndex >= 0 && argv[snapshotIndex + 1]
        ? argv[snapshotIndex + 1]
        : null,
  };
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") return Number(value);
  return null;
}

function listSnapshots() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => FILE_RE.test(name))
    .map((name) => {
      const match = name.match(FILE_RE);
      return {
        name,
        fullPath: path.join(DATA_DIR, name),
        dataset: match[1],
        stamp: match[2],
      };
    })
    .sort((a, b) => a.stamp.localeCompare(b.stamp));
}

function pickSnapshots(opts) {
  const snapshots = listSnapshots();
  if (!snapshots.length) throw new Error(`No AMM/CPMM snapshots found in ${DATA_DIR}`);
  if (opts.snapshot) {
    const found = snapshots.find((s) => s.name === opts.snapshot);
    if (!found) throw new Error(`Snapshot not found: ${opts.snapshot}`);
    return [found];
  }
  if (opts.latest) {
    const latestByDataset = new Map();
    for (const snap of snapshots) latestByDataset.set(snap.dataset, snap);
    return Array.from(latestByDataset.values()).sort((a, b) =>
      a.dataset.localeCompare(b.dataset),
    );
  }
  return snapshots;
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
    reserveA <= 0 ||
    reserveB === null ||
    reserveB <= 0 ||
    priceBPerA === null ||
    priceBPerA <= 0 ||
    tvlUsd === null ||
    tvlUsd <= 0
  ) {
    return null;
  }

  const denominator = reserveA * priceBPerA + reserveB;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;

  const tokenBUsd = tvlUsd / denominator;
  const tokenAUsd = tokenBUsd * priceBPerA;
  if (!Number.isFinite(tokenAUsd) || tokenAUsd <= 0) return null;
  if (!Number.isFinite(tokenBUsd) || tokenBUsd <= 0) return null;

  const feeFraction =
    feePct !== null && Number.isFinite(feePct) ? Math.max(0, feePct / 100) : 0;

  const tradeAIn = TRADE_SIZE_USD / tokenAUsd;
  const tradeBIn = TRADE_SIZE_USD / tokenBUsd;

  function simulate(inputAmount, inputReserve, outputReserve, idealRate) {
    if (!Number.isFinite(inputAmount) || inputAmount <= 0) return null;
    const effectiveIn = inputAmount * (1 - feeFraction);
    if (!Number.isFinite(effectiveIn) || effectiveIn <= 0) return null;
    const k = inputReserve * outputReserve;
    const newInputReserve = inputReserve + effectiveIn;
    if (!Number.isFinite(newInputReserve) || newInputReserve <= 0) return null;
    const newOutputReserve = k / newInputReserve;
    const actualOut = outputReserve - newOutputReserve;
    const idealOut = effectiveIn * idealRate;
    if (!Number.isFinite(actualOut) || actualOut <= 0) return null;
    if (!Number.isFinite(idealOut) || idealOut <= 0) return null;
    return Math.max(0, ((idealOut - actualOut) / idealOut) * 100);
  }

  const aToB = simulate(tradeAIn, reserveA, reserveB, priceBPerA);
  const bToA = simulate(tradeBIn, reserveB, reserveA, 1 / priceBPerA);
  const impacts = [aToB, bToA].filter((value) => value !== null && Number.isFinite(value));
  return impacts.length ? Math.max(...impacts) : null;
}

function estimatePriceImpact(entry) {
  const raw =
    toNumber(entry?.feeRate) ??
    toNumber(entry?.config?.tradeFeeRate) ??
    null;
  const feePct = raw === null ? null : raw <= 1 ? raw * 100 : raw / 10000;
  return estimateConstantProductPriceImpactPct({
    reserveA: toNumber(entry?.mintAmountA),
    reserveB: toNumber(entry?.mintAmountB),
    priceBPerA: toNumber(entry?.price),
    tvlUsd: toNumber(entry?.tvl),
    feePct,
  });
}

function runSnapshot(file, dryRun) {
  const rows = JSON.parse(fs.readFileSync(file.fullPath, "utf8"));
  let changed = 0;
  let updated = 0;

  for (const entry of rows) {
    const next = estimatePriceImpact(entry);
    const prev = toNumber(entry.priceImpactPct);
    if (typeof next === "number" && Number.isFinite(next)) {
      updated += 1;
      if (prev === null || Math.abs(prev - next) > 1e-12) {
        changed += 1;
        entry.priceImpactPct = next;
      }
    }
  }

  if (!dryRun && changed > 0) {
    fs.writeFileSync(file.fullPath, JSON.stringify(rows, null, 2));
  }

  console.log(
    `${file.name}: rows=${rows.length}, updated=${updated}, changed=${changed}`,
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const snapshots = pickSnapshots(opts);
  console.log(
    `${opts.dryRun ? "[DRY RUN]" : "[WRITE]"} Recomputing constant-product price impact for ${snapshots.length} snapshot file(s)`,
  );
  for (const file of snapshots) runSnapshot(file, opts.dryRun);
}

main();
