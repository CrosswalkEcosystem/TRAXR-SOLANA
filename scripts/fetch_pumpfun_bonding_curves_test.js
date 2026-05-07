#!/usr/bin/env node
"use strict";

const bs58 = require("bs58");
const { Connection, PublicKey } = require("@solana/web3.js");

const PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);
const DISCRIMINATOR = Buffer.from([23, 183, 248, 55, 96, 216, 172, 96]);
const DEFAULT_LIMIT = 20;

function parseArgs(argv) {
  const limitIndex = argv.indexOf("--limit");
  const gpaIndex = argv.indexOf("--gpa-rpc");
  const dataIndex = argv.indexOf("--data-rpc");
  const batchIndex = argv.indexOf("--batch-size");
  const throttleIndex = argv.indexOf("--throttle-ms");
  return {
    limit:
      limitIndex >= 0 && argv[limitIndex + 1]
        ? Math.max(1, Number(argv[limitIndex + 1]))
        : DEFAULT_LIMIT,
    gpaRpc:
      gpaIndex >= 0 && argv[gpaIndex + 1] ? argv[gpaIndex + 1] : null,
    dataRpc:
      dataIndex >= 0 && argv[dataIndex + 1] ? argv[dataIndex + 1] : null,
    batchSize:
      batchIndex >= 0 && argv[batchIndex + 1]
        ? Math.max(10, Number(argv[batchIndex + 1]))
        : 100,
    throttleMs:
      throttleIndex >= 0 && argv[throttleIndex + 1]
        ? Math.max(0, Number(argv[throttleIndex + 1]))
        : 200,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readU64LE(buf, offset) {
  if (typeof buf.readBigUInt64LE === "function") {
    return buf.readBigUInt64LE(offset).toString();
  }
  const low = buf.readUInt32LE(offset);
  const high = buf.readUInt32LE(offset + 4);
  return (BigInt(high) << 32n | BigInt(low)).toString();
}

function readPubkey(buf, offset) {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

function decodeOptionBool(buf, offset) {
  if (offset + 1 >= buf.length) return null;
  const tag = buf.readUInt8(offset);
  if (tag === 0) return null;
  return buf.readUInt8(offset + 1) !== 0;
}

function decodeBondingCurve(data) {
  if (!data || data.length < 80) return null;
  const disc = data.subarray(0, 8);
  if (!disc.equals(DISCRIMINATOR)) return null;

  let offset = 8;
  const virtualTokenReserves = readU64LE(data, offset);
  offset += 8;
  const virtualSolReserves = readU64LE(data, offset);
  offset += 8;
  const realTokenReserves = readU64LE(data, offset);
  offset += 8;
  const realSolReserves = readU64LE(data, offset);
  offset += 8;
  const tokenTotalSupply = readU64LE(data, offset);
  offset += 8;
  const complete = data.readUInt8(offset) !== 0;
  offset += 1;
  const creator = readPubkey(data, offset);
  offset += 32;
  const isMayhemMode = offset < data.length ? data.readUInt8(offset) !== 0 : null;
  offset += 1;
  const isCashbackCoin = decodeOptionBool(data, offset);

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
    creator,
    isMayhemMode,
    isCashbackCoin,
    dataLen: data.length,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const gpaRpc =
    opts.gpaRpc ||
    process.env.PUMPFUN_GPA_RPC ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const dataRpc =
    opts.dataRpc ||
    process.env.PUMPFUN_DATA_RPC ||
    process.env.NODEZERO_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    gpaRpc;
  const apiKey = process.env.NODEZERO_RPC_KEY || "";

  const gpaConnection = new Connection(gpaRpc, {
    commitment: "confirmed",
    httpHeaders:
      gpaRpc.includes("nodezero") && apiKey ? { "x-api-key": apiKey } : undefined,
  });
  const dataConnection = new Connection(dataRpc, {
    commitment: "confirmed",
    httpHeaders:
      dataRpc.includes("nodezero") && apiKey ? { "x-api-key": apiKey } : undefined,
  });

  const discriminatorBase58 = bs58.encode(DISCRIMINATOR);
  console.log(`[pumpfun] gpaRpc=${gpaRpc}`);
  console.log(`[pumpfun] dataRpc=${dataRpc}`);
  console.log("[pumpfun] fetching bonding curves...");

  const accounts = await gpaConnection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    dataSlice: { offset: 0, length: 0 },
    filters: [{ memcmp: { offset: 0, bytes: discriminatorBase58 } }],
  });

  console.log(`[pumpfun] program accounts fetched: ${accounts.length}`);

  const sample = [];
  const batchSize = opts.batchSize;
  for (let i = 0; i < accounts.length; i += batchSize) {
    const batch = accounts.slice(i, i + batchSize);
    const infos = await dataConnection.getMultipleAccountsInfo(
      batch.map((acc) => acc.pubkey),
      {
        commitment: "confirmed",
        dataSlice: { offset: 0, length: 96 },
      },
    );
    for (let j = 0; j < batch.length; j += 1) {
      const info = infos[j];
      if (!info) continue;
      const decoded = decodeBondingCurve(info.data);
      if (!decoded) continue;
      sample.push({ bondingCurve: batch[j].pubkey.toBase58(), ...decoded });
      if (sample.length >= opts.limit) break;
    }
    if (sample.length >= opts.limit) break;
    await sleep(opts.throttleMs);
  }

  console.log(`[pumpfun] decoded=${sample.length}`);
  if (sample.length) {
    console.log(`[pumpfun] sample=${JSON.stringify(sample[0], null, 2)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
