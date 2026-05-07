#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");
const crypto = require("crypto");
const bs58 = require("bs58");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
);
const DEFAULT_OUTPUT = "pumpswap.pools.test.json";

function parseArgs(argv) {
  const limitIndex = argv.indexOf("--limit");
  const outputIndex = argv.indexOf("--output");
  const sizeIndex = argv.indexOf("--data-size");
  const fullIndex = argv.indexOf("--full");
  return {
    limit:
      limitIndex >= 0 && argv[limitIndex + 1]
        ? Number(argv[limitIndex + 1])
        : null,
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : DEFAULT_OUTPUT,
    dataSize:
      sizeIndex >= 0 && argv[sizeIndex + 1]
        ? Number(argv[sizeIndex + 1])
        : 211, // 8 discriminator + 203 bytes (Pool)
    full: fullIndex >= 0,
  };
}

function readPubkey(buf, offset) {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

function readU64LE(buf, offset) {
  if (typeof buf.readBigUInt64LE === "function") {
    return buf.readBigUInt64LE(offset).toString();
  }
  // fallback for older Node
  const low = buf.readUInt32LE(offset);
  const high = buf.readUInt32LE(offset + 4);
  return (BigInt(high) << 32n | BigInt(low)).toString();
}

function decodePoolAccount(data) {
  let offset = 0;
  if (data.length >= 211) {
    // Assume Anchor 8-byte discriminator
    offset = 8;
  }
  if (data.length < offset + 1 + 2 + 32 * 6 + 8) {
    return null;
  }

  const pool_bump = data.readUInt8(offset);
  offset += 1;
  const index = data.readUInt16LE(offset);
  offset += 2;
  const creator = readPubkey(data, offset);
  offset += 32;
  const base_mint = readPubkey(data, offset);
  offset += 32;
  const quote_mint = readPubkey(data, offset);
  offset += 32;
  const lp_mint = readPubkey(data, offset);
  offset += 32;
  const pool_base_token_account = readPubkey(data, offset);
  offset += 32;
  const pool_quote_token_account = readPubkey(data, offset);
  offset += 32;
  const lp_supply = readU64LE(data, offset);

  return {
    pool_bump,
    index,
    creator,
    base_mint,
    quote_mint,
    lp_mint,
    pool_base_token_account,
    pool_quote_token_account,
    lp_supply,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rpcUrl =
    process.env.PUMPSWAP_RPC_URL ||
    process.env.NODEZERO_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const apiKey = process.env.NODEZERO_RPC_KEY || "";

  if (!apiKey && rpcUrl.includes("nodezero")) {
    throw new Error("Missing NODEZERO_RPC_KEY");
  }

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: apiKey ? { "x-api-key": apiKey } : undefined,
  });

  const discriminator = crypto
    .createHash("sha256")
    .update("account:Pool")
    .digest()
    .subarray(0, 8);
  const discriminatorBase58 = bs58.encode(discriminator);

  console.log(`[pumpswap] rpc=${rpcUrl}`);
  async function fetchProgramAccounts(filters) {
    return connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
      filters,
    });
  }

  let accounts = [];
  console.log("[pumpswap] fetching program accounts...");
  try {
    accounts = await fetchProgramAccounts([
      { memcmp: { offset: 0, bytes: discriminatorBase58 } },
      { dataSize: opts.dataSize },
    ]);
    console.log(`[pumpswap] program accounts fetched: ${accounts.length}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("scan aborted")) {
      console.warn("[pumpswap] scan aborted, falling back to sharded index scan");
      const indexOffset = 8 + 1; // discriminator + pool_bump
      for (let i = 0; i < 256; i += 1) {
        const shardByte = bs58.encode(Buffer.from([i]));
        const shardAccounts = await fetchProgramAccounts([
          { memcmp: { offset: 0, bytes: discriminatorBase58 } },
          { dataSize: opts.dataSize },
          { memcmp: { offset: indexOffset, bytes: shardByte } },
        ]);
        if (shardAccounts.length) {
          accounts.push(...shardAccounts);
        }
    if (!opts.full && opts.limit && accounts.length >= opts.limit * 5) break;
  }
  console.log(`[pumpswap] program accounts fetched (sharded): ${accounts.length}`);
    } else {
      throw err;
    }
  }

  const rows = [];
  let skipped = 0;
  const sizeBuckets = new Map();
  const batchSize = 100;
  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    const infos = await connection.getMultipleAccountsInfo(
      batch.map((acc) => acc.pubkey),
      { commitment: "confirmed" },
    );
    for (let j = 0; j < batch.length; j += 1) {
      const info = infos[j];
      if (!info) {
        skipped += 1;
        continue;
      }
      const len = info.data.length;
      sizeBuckets.set(len, (sizeBuckets.get(len) || 0) + 1);
      const decoded = decodePoolAccount(info.data);
      if (!decoded) {
        skipped += 1;
        continue;
      }
      rows.push({
        pool_id: batch[j].pubkey.toBase58(),
        ...decoded,
      });
      if (opts.limit && rows.length >= opts.limit) break;
    }
    if (opts.limit && rows.length >= opts.limit) break;
  }

  const topSizes = Array.from(sizeBuckets.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  console.log(`[pumpswap] decoded=${rows.length} skipped=${skipped}`);
  console.log(
    `[pumpswap] account sizes (top5): ${topSizes
      .map(([size, count]) => `${size}:${count}`)
      .join(", ")}`,
  );
  if (rows.length) {
    console.log("[pumpswap] sample:", rows[0]);
  }

  const outPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(DATA_DIR, opts.output);
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`[pumpswap] wrote ${rows.length} pools to ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
