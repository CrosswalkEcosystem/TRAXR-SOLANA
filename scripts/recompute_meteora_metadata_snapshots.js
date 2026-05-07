#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const {
  mplTokenMetadata,
  safeFetchMetadataFromSeeds,
} = require("@metaplex-foundation/mpl-token-metadata");
const { publicKey } = require("@metaplex-foundation/umi");

const DATA_DIR = path.join(__dirname, "..", "data");
const METEORA_FILE_RE =
  /^(meteora\.(?:dlmm|dammv2)\.live\.json)_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const INTER_MINT_DELAY_MS = 150;

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
    noOffchain: argv.includes("--no-offchain"),
  };
}

function printHelp() {
  console.log(`Usage:
  npm run repair:meteora-metadata
  npm run repair:meteora-metadata -- --latest
  npm run repair:meteora-metadata -- --snapshot meteora.dlmm.live.json_<timestamp>.json
  npm run repair:meteora-metadata -- --snapshot meteora.dammv2.live.json_<timestamp>.json
  npm run repair:meteora-metadata -- --pool <POOL_ID>
  npm run repair:meteora-metadata:write -- --latest

Defaults:
  latest snapshot only
  rpc-url = ${DEFAULT_RPC_URL}
  inter-mint delay = ${INTER_MINT_DELAY_MS}ms

Required env:
  NODEZERO_RPC_KEY
`);
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
        dataset: match ? match[1] : "",
        stamp: match ? match[2] : "",
      };
    })
    .sort((a, b) => {
      if (a.stamp === b.stamp) return a.dataset.localeCompare(b.dataset);
      return b.stamp.localeCompare(a.stamp);
    });
}

function pickSnapshots(opts) {
  const snapshots = listSnapshots();
  if (!snapshots.length) {
    throw new Error(`No Meteora DLMM or DAMM v2 snapshot files found in ${DATA_DIR}`);
  }
  if (opts.snapshot) {
    const found = snapshots.find((file) => file.name === opts.snapshot);
    if (!found) throw new Error(`Snapshot not found: ${opts.snapshot}`);
    return [found];
  }
  if (opts.latest) return [snapshots[0]];
  return snapshots;
}

function getPoolId(pool) {
  return pool?.address || pool?.poolId || pool?.id || null;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim() : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

async function fetchOffchainJson(uri) {
  if (!uri) return null;
  const response = await fetch(uri, {
    headers: { "user-agent": "traxr-solana/meteora-metadata-repair" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function buildUmi(rpcUrl) {
  const apiKey = process.env.NODEZERO_RPC_KEY;
  if (!apiKey) throw new Error("Missing NODEZERO_RPC_KEY");
  return createUmi(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: { "x-api-key": apiKey },
  }).use(mplTokenMetadata());
}

async function resolveMintMetadata(umi, mint, includeOffchain, cache) {
  if (!mint) {
    return {
      mint: null,
      name: null,
      symbol: null,
      logo: null,
      uri: null,
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
      };
    }

    const uri = cleanText(metadata.uri);
    let logo = null;
    let offchainReason = null;
    if (includeOffchain && uri) {
      try {
        const offchain = await fetchOffchainJson(uri);
        logo = cleanText(offchain?.image) || null;
      } catch (error) {
        offchainReason = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      mint,
      name: cleanText(metadata.name),
      symbol: cleanText(metadata.symbol),
      logo,
      uri,
      found: true,
      reason: offchainReason,
    };
  })().catch((error) => ({
    mint,
    name: null,
    symbol: null,
    logo: null,
    uri: null,
    found: false,
    reason: error instanceof Error ? error.message : String(error),
  }));

  cache.set(mint, promise);
  return promise;
}

function applyMetadataToRow(row, tokenA, tokenB) {
  let changed = false;
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

  for (const [key, next] of Object.entries(updates)) {
    const prev = row[key] ?? null;
    if ((prev || null) !== (next || null)) {
      row[key] = next;
      changed = true;
    }
  }
  return changed;
}

async function processSnapshot(fileInfo, opts, umi) {
  const startedAt = Date.now();
  const raw = JSON.parse(fs.readFileSync(fileInfo.fullPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`${fileInfo.name} is not a JSON array`);
  }

  const rows = opts.poolId
    ? raw.filter((entry) => getPoolId(entry) === opts.poolId)
    : raw;
  if (!rows.length) {
    throw new Error(
      opts.poolId
        ? `Pool ${opts.poolId} not found in ${fileInfo.name}`
        : `No pools in ${fileInfo.name}`,
    );
  }

  const uniqueMints = [];
  const seenMints = new Set();
  for (const row of rows) {
    for (const mint of [row.mintA || row.raw?.mint_x, row.mintB || row.raw?.mint_y]) {
      if (mint && !seenMints.has(mint)) {
        seenMints.add(mint);
        uniqueMints.push(mint);
      }
    }
  }

  const cache = new Map();
  const reasons = new Map();
  let resolved = 0;

  for (let i = 0; i < uniqueMints.length; i += 1) {
    const mint = uniqueMints[i];
    const mintStart = Date.now();
    const metadata = await resolveMintMetadata(umi, mint, !opts.noOffchain, cache);
    if (metadata.found) {
      resolved += 1;
    } else {
      const key = metadata.reason || "unknown";
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }
    console.log(
      `${fileInfo.name} :: mint ${mint} :: ${metadata.logo || "no-logo"} :: ${formatMs(Date.now() - mintStart)}${metadata.reason ? ` :: ${metadata.reason}` : ""}`,
    );
    if (i + 1 < uniqueMints.length) {
      await sleep(INTER_MINT_DELAY_MS);
    }
  }

  let changedRows = 0;
  let rowsWithLogos = 0;
  for (const row of rows) {
    const tokenA = await cache.get(row.mintA || row.raw?.mint_x) ||
      {
        name: null,
        symbol: null,
        logo: null,
      };
    const tokenB = await cache.get(row.mintB || row.raw?.mint_y) ||
      {
        name: null,
        symbol: null,
        logo: null,
      };
    if (applyMetadataToRow(row, tokenA, tokenB)) {
      changedRows += 1;
    }
    if ((row.tokenALogo && String(row.tokenALogo).trim()) || (row.tokenBLogo && String(row.tokenBLogo).trim())) {
      rowsWithLogos += 1;
    }
  }

  if (!opts.dryRun && changedRows > 0) {
    fs.writeFileSync(fileInfo.fullPath, JSON.stringify(raw, null, 2));
  }

  return {
    file: fileInfo.name,
    rows: rows.length,
    uniqueMints: uniqueMints.length,
    resolved,
    changedRows,
    rowsWithLogos,
    elapsedMs: Date.now() - startedAt,
    reasons,
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
  const umi = buildUmi(opts.rpcUrl);
  const files = pickSnapshots(opts);
  const allReasons = new Map();
  const startedAt = Date.now();

  console.log(
    `${opts.dryRun ? "[DRY RUN]" : "[WRITE]"} Meteora metadata/logo recompute`,
  );
  console.log(`RPC URL: ${opts.rpcUrl}`);
  console.log(`Snapshots: ${files.map((f) => f.name).join(", ")}`);
  if (opts.poolId) console.log(`Pool filter: ${opts.poolId}`);
  console.log(`Offchain JSON fetch: ${opts.noOffchain ? "disabled" : "enabled"}`);
  console.log("");

  for (const file of files) {
    const result = await processSnapshot(file, opts, umi);
    console.log("");
    console.log(
      `Summary ${result.file}: rows=${result.rows}, uniqueMints=${result.uniqueMints}, resolved=${result.resolved}, changedRows=${result.changedRows}, rowsWithLogos=${result.rowsWithLogos}, elapsed=${formatMs(result.elapsedMs)}`,
    );
    for (const [reason, count] of result.reasons.entries()) {
      allReasons.set(reason, (allReasons.get(reason) || 0) + count);
    }
    console.log("");
  }

  console.log(`Total elapsed: ${formatMs(Date.now() - startedAt)}`);
  if (allReasons.size) {
    console.log("Metadata issues:");
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
