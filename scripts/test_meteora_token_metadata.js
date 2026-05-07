#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { createUmi } = require("@metaplex-foundation/umi-bundle-defaults");
const {
  mplTokenMetadata,
  findMetadataPda,
  safeFetchMetadataFromSeeds,
} = require("@metaplex-foundation/mpl-token-metadata");
const { publicKey } = require("@metaplex-foundation/umi");

const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const SNAPSHOT_PATTERN =
  /^meteora\.dlmm\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;

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
  const opts = {
    poolId: null,
    snapshot: null,
    rpcUrl: DEFAULT_RPC_URL,
    includeOffchain: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--pool" && argv[i + 1]) {
      opts.poolId = argv[++i];
    } else if (arg === "--snapshot" && argv[i + 1]) {
      opts.snapshot = argv[++i];
    } else if (arg === "--rpc-url" && argv[i + 1]) {
      opts.rpcUrl = argv[++i];
    } else if (arg === "--no-offchain") {
      opts.includeOffchain = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  npm run test:meteora:metadata
  npm run test:meteora:metadata -- --pool <POOL_ID>
  npm run test:meteora:metadata -- --snapshot <FILENAME>
  npm run test:meteora:metadata -- --no-offchain

Defaults:
  rpc-url: ${DEFAULT_RPC_URL}
  snapshot: latest meteora.dlmm.live.json_<timestamp>.json

Required env:
  NODEZERO_RPC_KEY
`);
}

function pickLatestSnapshot(dataDir) {
  const matches = fs
    .readdirSync(dataDir)
    .map((name) => {
      const match = name.match(SNAPSHOT_PATTERN);
      if (!match) return null;
      return { name, ts: match[1] };
    })
    .filter(Boolean)
    .sort((a, b) => b.ts.localeCompare(a.ts));
  if (!matches.length) {
    throw new Error(`No Meteora snapshot files found in ${dataDir}`);
  }
  return matches[0].name;
}

function loadPoolRow(opts) {
  const dataDir = path.resolve(__dirname, "..", "data");
  const snapshotName = opts.snapshot || pickLatestSnapshot(dataDir);
  const snapshotPath = path.join(dataDir, snapshotName);
  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  const row =
    (opts.poolId
      ? rows.find(
          (entry) =>
            entry?.address === opts.poolId ||
            entry?.poolId === opts.poolId ||
            entry?.id === opts.poolId,
        )
      : rows[0]) || null;
  if (!row) {
    throw new Error(
      opts.poolId
        ? `Pool ${opts.poolId} not found in ${snapshotName}`
        : `No rows found in ${snapshotName}`,
    );
  }
  return { row, snapshotName };
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim() : null;
}

async function fetchOffchainJson(uri) {
  if (!uri) return null;
  const response = await fetch(uri, {
    headers: { "user-agent": "traxr-solana/metadata-test" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function resolveMintMetadata(umi, mint, includeOffchain) {
  const metadataPda = findMetadataPda(umi, { mint: publicKey(mint) });
  const metadata = await safeFetchMetadataFromSeeds(umi, { mint: publicKey(mint) });
  if (!metadata) {
    return {
      mint,
      metadataPda: String(metadataPda[0] || metadataPda),
      found: false,
      onchain: null,
      offchain: null,
      offchainError: null,
    };
  }

  const onchain = {
    name: cleanText(metadata.name),
    symbol: cleanText(metadata.symbol),
    uri: cleanText(metadata.uri),
    sellerFeeBasisPoints:
      metadata.sellerFeeBasisPoints &&
      typeof metadata.sellerFeeBasisPoints.basisPoints === "bigint"
        ? Number(metadata.sellerFeeBasisPoints.basisPoints)
        : null,
    tokenStandard: metadata.tokenStandard ?? null,
  };

  let offchain = null;
  let offchainError = null;
  if (includeOffchain && onchain.uri) {
    try {
      const json = await fetchOffchainJson(onchain.uri);
      offchain = {
        name: cleanText(json?.name),
        symbol: cleanText(json?.symbol),
        image: cleanText(json?.image),
        description: cleanText(json?.description),
      };
    } catch (error) {
      offchainError = error instanceof Error ? error.message : String(error);
    }
  }

  return {
    mint,
    metadataPda: String(metadataPda[0] || metadataPda),
    found: true,
    onchain,
    offchain,
    offchainError,
  };
}

async function main() {
  initEnv();
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.NODEZERO_RPC_KEY;
  if (!apiKey) {
    throw new Error("Missing NODEZERO_RPC_KEY in environment or .env.local");
  }

  const { row, snapshotName } = loadPoolRow(opts);
  const poolId = row.address || row.poolId || row.id || null;
  const pairName = row.raw?.name || [row.raw?.mint_x_symbol, row.raw?.mint_y_symbol].filter(Boolean).join("-") || "n/a";
  const mintA = row.mintA || row.raw?.mint_x || null;
  const mintB = row.mintB || row.raw?.mint_y || null;
  if (!mintA || !mintB) {
    throw new Error(`Pool ${poolId || "unknown"} does not expose mintA/mintB`);
  }

  const umi = createUmi(opts.rpcUrl, {
    commitment: "confirmed",
    httpHeaders: { "x-api-key": apiKey },
  }).use(mplTokenMetadata());

  console.log("=== Meteora Token Metadata Test ===");
  console.log(`RPC URL:   ${opts.rpcUrl}`);
  console.log(`Snapshot:  ${snapshotName}`);
  console.log(`Pool ID:   ${poolId}`);
  console.log(`Pair:      ${pairName}`);
  console.log("");

  const [tokenA, tokenB] = await Promise.all([
    resolveMintMetadata(umi, mintA, opts.includeOffchain),
    resolveMintMetadata(umi, mintB, opts.includeOffchain),
  ]);

  for (const [label, token] of [
    ["Token A", tokenA],
    ["Token B", tokenB],
  ]) {
    console.log(`${label}`);
    console.log(`  mint:         ${token.mint}`);
    console.log(`  metadata PDA: ${token.metadataPda}`);
    console.log(`  found:        ${token.found ? "yes" : "no"}`);
    if (token.onchain) {
      console.log(`  onchain name: ${token.onchain.name || "n/a"}`);
      console.log(`  onchain sym:  ${token.onchain.symbol || "n/a"}`);
      console.log(`  onchain uri:  ${token.onchain.uri || "n/a"}`);
      console.log(
        `  token std:    ${token.onchain.tokenStandard != null ? String(token.onchain.tokenStandard) : "n/a"}`,
      );
    }
    if (token.offchain) {
      console.log(`  offchain nm:  ${token.offchain.name || "n/a"}`);
      console.log(`  offchain sym: ${token.offchain.symbol || "n/a"}`);
      console.log(`  image:        ${token.offchain.image || "n/a"}`);
    } else if (token.offchainError) {
      console.log(`  offchain err: ${token.offchainError}`);
    }
    console.log("");
  }

  console.log("If a token has metadata + image here, we can enrich Meteora logos during fetch by mint.");
}

main().catch((error) => {
  console.error("");
  console.error("Test failed:");
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
