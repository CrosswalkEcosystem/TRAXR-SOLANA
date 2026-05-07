#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const ENDPOINT = "https://swap-api.pump.fun/v1/coins/market-activity/batch";

function parseArgs(argv) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  const chunkIndex = argv.indexOf("--chunk-size");
  const intervalsIndex = argv.indexOf("--intervals");
  const metricsIndex = argv.indexOf("--metrics");
  const sleepIndex = argv.indexOf("--sleep-ms");
  return {
    input:
      inputIndex >= 0 && argv[inputIndex + 1] ? argv[inputIndex + 1] : null,
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : "pumpfun.market-activity.json",
    chunkSize:
      chunkIndex >= 0 && argv[chunkIndex + 1]
        ? Math.max(1, Number(argv[chunkIndex + 1]))
        : 60,
    intervals:
      intervalsIndex >= 0 && argv[intervalsIndex + 1]
        ? argv[intervalsIndex + 1].split(",").map((s) => s.trim()).filter(Boolean)
        : ["5m", "1h", "6h", "24h"],
    metrics:
      metricsIndex >= 0 && argv[metricsIndex + 1]
        ? argv[metricsIndex + 1].split(",").map((s) => s.trim()).filter(Boolean)
        : [
            "numTxs",
            "volumeUSD",
            "numUsers",
            "numBuys",
            "numSells",
            "buyVolumeUSD",
            "sellVolumeUSD",
            "numBuyers",
            "numSellers",
            "priceChangePercent",
          ],
    sleepMs:
      sleepIndex >= 0 && argv[sleepIndex + 1]
        ? Math.max(0, Number(argv[sleepIndex + 1]))
        : 250,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readInputList(inputPath) {
  if (!inputPath) return null;
  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.addresses)) return data.addresses;
  return null;
}

async function fetchBatch(payload, attempt = 0) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://pump.fun",
      accept: "*/*",
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) return res.json();
  if (res.status === 429 && attempt < 6) {
    const delay = 500 * 2 ** attempt;
    console.warn(`[pumpfun] 429 retry in ${delay}ms`);
    await sleep(delay);
    return fetchBatch(payload, attempt + 1);
  }
  const text = await res.text().catch(() => "");
  throw new Error(`HTTP ${res.status}: ${text}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input) throw new Error("--input is required");

  const raw = readInputList(opts.input);
  let addresses = raw;
  if (Array.isArray(raw) && raw.length && typeof raw[0] === "object") {
    addresses = raw
      .map((row) => row.mint || row.coinMint || row.address || row.pool_address)
      .filter(Boolean);
  }
  if (!addresses || !addresses.length) {
    throw new Error("No addresses found in input");
  }

  const outPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(DATA_DIR, opts.output);

  const out = {
    intervals: opts.intervals,
    metrics: opts.metrics,
    results: {},
    invalid: [],
  };

  const validAddresses = addresses.filter(
    (addr) => typeof addr === "string" && addr.length >= 32 && addr.length <= 44,
  );
  const invalidAddresses = addresses.filter((addr) => !validAddresses.includes(addr));
  if (invalidAddresses.length) {
    out.invalid.push(...invalidAddresses);
  }
  console.log(
    `[pumpfun] addresses total=${addresses.length} valid=${validAddresses.length} invalid=${invalidAddresses.length}`,
  );

  const chunkSize = Math.min(opts.chunkSize, 50);
  for (let i = 0; i < validAddresses.length; i += chunkSize) {
    const chunk = validAddresses.slice(i, i + chunkSize);
    const payload = {
      addresses: chunk,
      intervals: opts.intervals,
      metrics: opts.metrics,
    };
    const data = await fetchBatch(payload);
    Object.assign(out.results, data);
    if ((i + chunkSize) % 500 === 0) {
      console.log(
        `[pumpfun] batches ${Math.min(i + chunkSize, validAddresses.length)}/${validAddresses.length}`,
      );
    }
    await sleep(opts.sleepMs);
  }

  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`[pumpfun] wrote ${Object.keys(out.results).length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
