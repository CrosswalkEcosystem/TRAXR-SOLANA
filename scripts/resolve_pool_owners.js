#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const DEFAULT_INPUT = "pumpfun.search_unrestricted.2char.complete.json";

const PROGRAM_LABELS = new Map([
  ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", "pumpswap"],
  ["675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", "raydium-amm"],
  ["CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C", "raydium-cpmm"],
  ["9W959DqEETiGZocYWCQPaJ6sFCvP9d9G8VKF7d6b7e3f", "raydium-clmm"],
]);

function parseArgs(argv) {
  const inputIndex = argv.indexOf("--input");
  const outputIndex = argv.indexOf("--output");
  const batchIndex = argv.indexOf("--batch-size");
  return {
    input:
      inputIndex >= 0 && argv[inputIndex + 1] ? argv[inputIndex + 1] : DEFAULT_INPUT,
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : "pumpfun.pool_owners.json",
    batchSize:
      batchIndex >= 0 && argv[batchIndex + 1]
        ? Math.max(10, Number(argv[batchIndex + 1]))
        : 100,
  };
}

function readInput(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(payload)) return [];
  const out = [];
  for (const row of payload) {
    if (row && typeof row.pool_address === "string") out.push(row.pool_address);
    if (row && typeof row.raydium_pool === "string") out.push(row.raydium_pool);
  }
  return [...new Set(out)];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const inputPath = path.isAbsolute(opts.input)
    ? opts.input
    : path.join(__dirname, "..", opts.input);
  const outputPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(__dirname, "..", opts.output);

  const rpcUrl =
    process.env.NODEZERO_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const apiKey = process.env.NODEZERO_RPC_KEY || "";

  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: apiKey ? { "x-api-key": apiKey } : undefined,
  });

  const addresses = readInput(inputPath);
  console.log(`[owners] input=${inputPath} pools=${addresses.length}`);

  const owners = new Map();
  const byProgram = new Map();

  for (let i = 0; i < addresses.length; i += opts.batchSize) {
    const chunk = addresses.slice(i, i + opts.batchSize);
    const infos = await connection.getMultipleAccountsInfo(
      chunk.map((a) => new PublicKey(a)),
      { commitment: "confirmed" },
    );
    for (let j = 0; j < chunk.length; j += 1) {
      const info = infos[j];
      if (!info) continue;
      const owner = info.owner.toBase58();
      owners.set(chunk[j], owner);
      byProgram.set(owner, (byProgram.get(owner) || 0) + 1);
    }
    if ((i + opts.batchSize) % 1000 === 0) {
      console.log(
        `[owners] ${Math.min(i + opts.batchSize, addresses.length)}/${addresses.length}`,
      );
    }
  }

  const summary = Array.from(byProgram.entries())
    .map(([program, count]) => ({
      program,
      label: PROGRAM_LABELS.get(program) || "unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      { total: addresses.length, summary, owners: Object.fromEntries(owners) },
      null,
      2,
    ),
  );
  console.log(`[owners] wrote ${outputPath}`);
  console.log(summary.slice(0, 10));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
