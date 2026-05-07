#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  const minIndex = argv.indexOf("--min-liquidity-usd");
  const tvlFieldIndex = argv.indexOf("--tvl-field");
  return {
    input:
      inputIndex >= 0 && argv[inputIndex + 1] ? argv[inputIndex + 1] : null,
    output:
      outputIndex >= 0 && argv[outputIndex + 1] ? argv[outputIndex + 1] : null,
    minLiquidityUsd:
      minIndex >= 0 && argv[minIndex + 1]
        ? Math.max(0, Number(argv[minIndex + 1]))
        : 0,
    tvlField:
      tvlFieldIndex >= 0 && argv[tvlFieldIndex + 1]
        ? argv[tvlFieldIndex + 1]
        : "tvl",
  };
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolvePath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(__dirname, "..", p);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input || !opts.output) {
    console.error(
      "Usage: node scripts/filter_snapshot_by_tvl.js --input <file> --output <file> --min-liquidity-usd 1000",
    );
    process.exit(1);
  }
  const inputPath = resolvePath(opts.input);
  const outputPath = resolvePath(opts.output);
  const raw = fs.readFileSync(inputPath, "utf8");
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) {
    throw new Error("Input JSON must be an array");
  }

  const filtered = rows.filter((row) => {
    const tvl = toNumber(row?.[opts.tvlField]);
    if (!tvl || !Number.isFinite(tvl)) return false;
    if (opts.minLiquidityUsd > 0 && tvl < opts.minLiquidityUsd) return false;
    return true;
  });

  fs.writeFileSync(outputPath, JSON.stringify(filtered, null, 2));
  console.log(
    `[filter] input=${inputPath} rows=${rows.length} output=${outputPath} kept=${filtered.length} minLiquidityUsd=${opts.minLiquidityUsd}`,
  );
}

main();
