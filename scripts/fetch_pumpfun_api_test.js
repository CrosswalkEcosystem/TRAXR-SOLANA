#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_OUTPUT = "pumpfun.api.test.json";

function parseArgs(argv) {
  const outputIndex = argv.indexOf("--output");
  const urlIndex = argv.indexOf("--url");
  return {
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : DEFAULT_OUTPUT,
    url:
      urlIndex >= 0 && argv[urlIndex + 1]
        ? argv[urlIndex + 1]
        : "https://frontend-api-v3.pump.fun/coins",
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jwt = process.env.JWT_SECRET || "";
  if (!jwt) {
    throw new Error("JWT_SECRET is missing");
  }

  const res = await fetch(opts.url, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const outPath = path.isAbsolute(opts.output)
      ? opts.output
      : path.join(DATA_DIR, opts.output);
    fs.writeFileSync(outPath, text);
    console.log(`[pumpfun] wrote raw response to ${outPath}`);
    return;
  }
  const outPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(DATA_DIR, opts.output);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`[pumpfun] wrote ${outPath}`);
  if (Array.isArray(data)) {
    console.log(`[pumpfun] rows=${data.length}`);
  } else if (data && typeof data === "object") {
    const keys = Object.keys(data);
    console.log(`[pumpfun] keys=${keys.slice(0, 10).join(", ")}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
