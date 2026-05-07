#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");
const { publicKey } = require("@metaplex-foundation/umi");
const { deserializeMetadata } = require("@metaplex-foundation/mpl-token-metadata");

const DEFAULT_SNAPSHOT =
  "data/pumpswap.live.json_2026-04-01T103238869Z.json";
const DEFAULT_OUTPUT = "data/pumpswap.token_metadata.test.json";
const DEFAULT_LIMIT = 20;
const INTER_MINT_DELAY_MS = 150;

const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || process.env.SOLANA_RPC_URL;
const DEFAULT_RPC_KEY =
  process.env.NODEZERO_RPC_KEY || process.env.SOLANA_RPC_API_KEY;

function parseArgs(argv) {
  const snapshotIndex = argv.indexOf("--snapshot");
  const outputIndex = argv.indexOf("--output");
  const limitIndex = argv.indexOf("--limit");
  const offsetIndex = argv.indexOf("--offset");
  const rpcIndex = argv.indexOf("--rpc");
  const rpcKeyIndex = argv.indexOf("--rpc-key");
  return {
    snapshot:
      snapshotIndex >= 0 && argv[snapshotIndex + 1]
        ? argv[snapshotIndex + 1]
        : DEFAULT_SNAPSHOT,
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : DEFAULT_OUTPUT,
    limit:
      limitIndex >= 0 && argv[limitIndex + 1]
        ? Math.max(1, Number(argv[limitIndex + 1]))
        : DEFAULT_LIMIT,
    offset:
      offsetIndex >= 0 && argv[offsetIndex + 1]
        ? Math.max(0, Number(argv[offsetIndex + 1]))
        : 0,
    rpc:
      rpcIndex >= 0 && argv[rpcIndex + 1] ? argv[rpcIndex + 1] : DEFAULT_RPC_URL,
    rpcKey:
      rpcKeyIndex >= 0 && argv[rpcKeyIndex + 1]
        ? argv[rpcKeyIndex + 1]
        : DEFAULT_RPC_KEY,
  };
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(__dirname, "..", p);
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim() : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildConnection(rpcUrl, rpcKey) {
  if (!rpcUrl) throw new Error("Missing RPC URL");
  const headers = rpcKey ? { "x-api-key": rpcKey } : undefined;
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: headers,
  });
}

async function fetchOffchainMetadataJson(uri) {
  if (!uri) return null;
  const response = await fetch(uri, {
    headers: { "user-agent": "traxr-solana/pumpswap-metadata-test" },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

function findMetadataPda(mint) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata", "utf8"),
      METADATA_PROGRAM_ID.toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    METADATA_PROGRAM_ID,
  )[0];
}

async function resolveMintMetadata(connection, mint) {
  if (!mint) {
    return {
      mint: null,
      name: null,
      symbol: null,
      logo: null,
      uri: null,
      found: false,
      reason: "missing mint",
      lastCheckedAt: new Date().toISOString(),
    };
  }

  try {
    const pda = findMetadataPda(mint);
    const account = await connection.getAccountInfo(pda);
    if (!account?.data) {
      return {
        mint,
        name: null,
        symbol: null,
        logo: null,
        uri: null,
        found: false,
        reason: "no onchain metadata",
        lastCheckedAt: new Date().toISOString(),
      };
    }

    const rawAccount = {
      publicKey: publicKey(pda.toBase58()),
      exists: true,
      data: account.data,
      executable: Boolean(account.executable),
      lamports: account.lamports ?? 0,
      owner: publicKey(account.owner.toBase58()),
      rentEpoch: account.rentEpoch ?? 0,
    };
    const metadata = deserializeMetadata(rawAccount);
    const uri = cleanText(metadata.uri);
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
      lastCheckedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      mint,
      name: null,
      symbol: null,
      logo: null,
      uri: null,
      found: false,
      reason: error instanceof Error ? error.message : String(error),
      lastCheckedAt: new Date().toISOString(),
    };
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const snapshotPath = resolvePath(opts.snapshot);
  const outputPath = resolvePath(opts.output);

  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  if (!Array.isArray(rows)) {
    throw new Error("Snapshot JSON must be an array");
  }

  const slice = rows.slice(opts.offset, opts.offset + opts.limit);
  const mints = [];
  const seen = new Set();
  for (const row of slice) {
    for (const mint of [row?.mintA?.address, row?.mintB?.address]) {
      if (mint && !seen.has(mint)) {
        seen.add(mint);
        mints.push(mint);
      }
    }
  }

  const connection = buildConnection(opts.rpc, opts.rpcKey);
  const results = [];
  for (let i = 0; i < mints.length; i += 1) {
    const mint = mints[i];
    const metadata = await resolveMintMetadata(connection, mint);
    results.push(metadata);
    if (i + 1 < mints.length) {
      await sleep(INTER_MINT_DELAY_MS);
    }
  }

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        snapshot: snapshotPath,
        limit: opts.limit,
        offset: opts.offset,
        mints: results.length,
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `[pumpswap] metadata test wrote ${results.length} mints to ${outputPath}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
