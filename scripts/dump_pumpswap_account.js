#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");

function parseArgs(argv) {
  const addrIndex = argv.indexOf("--address");
  const outputIndex = argv.indexOf("--output");
  return {
    address:
      addrIndex >= 0 && argv[addrIndex + 1] ? argv[addrIndex + 1] : null,
    output:
      outputIndex >= 0 && argv[outputIndex + 1] ? argv[outputIndex + 1] : null,
  };
}

function hexDump(buf) {
  return buf.toString("hex");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.address) throw new Error("--address is required");

  const rpcUrl =
    process.env.NODEZERO_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const apiKey = process.env.NODEZERO_RPC_KEY || "";

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: apiKey ? { "x-api-key": apiKey } : undefined,
  });

  const pubkey = new PublicKey(opts.address);
  const info = await connection.getAccountInfo(pubkey, { commitment: "confirmed" });
  if (!info) {
    console.log("not found");
    return;
  }
  const data = info.data;
  const out = {
    address: pubkey.toBase58(),
    owner: info.owner.toBase58(),
    dataLen: data.length,
    dataBase64: data.toString("base64"),
    dataHex: hexDump(data),
  };

  if (opts.output) {
    const outPath = path.isAbsolute(opts.output)
      ? opts.output
      : path.join(__dirname, "..", opts.output);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(`[dump] wrote ${outPath}`);
  } else {
    console.log(JSON.stringify(out, null, 2));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
