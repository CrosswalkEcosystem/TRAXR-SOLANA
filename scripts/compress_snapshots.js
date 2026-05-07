#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATASET_REGEX =
  /^(amm\.live\.json|clmm\.live\.json|cpmm\.live\.json|orca\.live\.json|pumpswap\.live\.json|meteora\.dlmm\.live\.json|meteora\.dammv2\.live\.json|other\.live\.json)_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const LEGACY_REGEX = /^solanaPools_.*\.json$/i;

function parseArgs(argv) {
  const readValue = (flag) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : null;
  };
  const keepLatest = Number.parseInt(readValue("--keep-latest") || "1", 10);
  return {
    keepLatest: Number.isFinite(keepLatest) && keepLatest >= 0 ? keepLatest : 1,
    dryRun: argv.includes("--dry-run"),
  };
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

function getSnapshotStamp(name, stat) {
  const datasetMatch = name.match(DATASET_REGEX);
  if (datasetMatch) {
    const parsed = parseTimestampSlug(datasetMatch[2]);
    if (parsed !== null) return parsed;
  }
  const geckoMatch = name.match(
    /solanaPools_(?:gecko_)?(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)/i,
  );
  if (geckoMatch) {
    const raw = geckoMatch[1];
    const iso =
      `${raw.slice(0, 4)}-${raw.slice(5, 7)}-${raw.slice(8, 10)}` +
      `T${raw.slice(11, 13)}:${raw.slice(13, 15)}:${raw.slice(15, 17)}.` +
      `${raw.slice(17, 20)}Z`;
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const legacyMatch = /^solanaPools_(\d{8})_(\d{6})Z\.json$/i.exec(name);
  if (legacyMatch) {
    const date = legacyMatch[1];
    const time = legacyMatch[2];
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`;
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return stat.mtimeMs;
}

function gzipFile(source, target) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(source);
    const output = fs.createWriteStream(target);
    const gzip = zlib.createGzip({ level: 9 });
    input.on("error", reject);
    output.on("error", reject);
    output.on("finish", resolve);
    input.pipe(gzip).pipe(output);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(`Missing data directory: ${DATA_DIR}`);
  }

  const files = fs.readdirSync(DATA_DIR);
  const candidates = [];
  const keepByKey = new Map();
  let alreadyCompressed = 0;

  for (const name of files) {
    if (name.endsWith(".gz")) {
      if (DATASET_REGEX.test(name.slice(0, -3)) || LEGACY_REGEX.test(name.slice(0, -3))) {
        alreadyCompressed += 1;
      }
      continue;
    }
    if (!DATASET_REGEX.test(name) && !LEGACY_REGEX.test(name)) continue;
    const fullPath = path.join(DATA_DIR, name);
    const stat = fs.statSync(fullPath);
    candidates.push({
      name,
      fullPath,
      stampMs: getSnapshotStamp(name, stat),
      key: DATASET_REGEX.test(name)
        ? name.replace(/_\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z\.json$/i, "")
        : "legacy",
    });
  }

  for (const entry of candidates) {
    const list = keepByKey.get(entry.key) ?? [];
    list.push(entry);
    keepByKey.set(entry.key, list);
  }

  const keepSet = new Set();
  for (const [key, list] of keepByKey.entries()) {
    list.sort((a, b) => b.stampMs - a.stampMs);
    list.slice(0, opts.keepLatest).forEach((entry) => keepSet.add(entry.fullPath));
    keepByKey.set(key, list);
  }

  let compressed = 0;
  let skipped = 0;
  let deleted = 0;

  for (const entry of candidates) {
    if (keepSet.has(entry.fullPath)) {
      skipped += 1;
      continue;
    }
    const gzPath = `${entry.fullPath}.gz`;
    if (fs.existsSync(gzPath)) {
      if (!opts.dryRun) {
        fs.unlinkSync(entry.fullPath);
      }
      deleted += 1;
      continue;
    }
    if (opts.dryRun) {
      console.log(`[dry-run] compress ${entry.name}`);
      continue;
    }
    await gzipFile(entry.fullPath, gzPath);
    fs.unlinkSync(entry.fullPath);
    compressed += 1;
  }

  console.log("=== Snapshot Compression ===");
  console.log(`Data dir:      ${DATA_DIR}`);
  console.log(`Keep latest:   ${opts.keepLatest}`);
  console.log(`Dry run:       ${opts.dryRun ? "yes" : "no"}`);
  console.log(`Candidates:    ${candidates.length}`);
  console.log(`Already gz:    ${alreadyCompressed}`);
  console.log(`Compressed:    ${compressed}`);
  console.log(`Deleted-only:  ${deleted}`);
  console.log(`Kept (json):   ${keepSet.size}`);
  console.log(`Skipped:       ${skipped}`);
}

main().catch((error) => {
  console.error("");
  console.error("Snapshot compression failed:");
  console.error(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
