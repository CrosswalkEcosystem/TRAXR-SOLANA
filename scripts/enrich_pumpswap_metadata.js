#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { Connection, PublicKey } = require("@solana/web3.js");
const { publicKey } = require("@metaplex-foundation/umi");
const { deserializeMetadata } = require("@metaplex-foundation/mpl-token-metadata");

const DEFAULT_SNAPSHOT =
  "data/pumpswap.live.json_2026-04-01T103238869Z.json";
const DEFAULT_OUTPUT =
  "data/pumpswap.live.json_2026-04-01T103238869Z.metadata.json";
const DEFAULT_CACHE = "data/pumpswap.mint_metadata.json";
const DEFAULT_DELAY_MS = 150;
const DEFAULT_LOG_EVERY = 500;
const DEFAULT_FLUSH_EVERY = 1000;
const DEFAULT_RPC_TIMEOUT_MS = 15000;
const DEFAULT_OFFCHAIN_TIMEOUT_MS = 10000;

const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || process.env.SOLANA_RPC_URL;
const DEFAULT_RPC_KEY =
  process.env.NODEZERO_RPC_KEY || process.env.SOLANA_RPC_API_KEY;

const METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

function parseArgs(argv) {
  const snapshotIndex = argv.indexOf("--snapshot");
  const outputIndex = argv.indexOf("--output");
  const cacheIndex = argv.indexOf("--cache");
  const delayIndex = argv.indexOf("--delay-ms");
  const logEveryIndex = argv.indexOf("--log-every");
  const flushEveryIndex = argv.indexOf("--flush-every");
  const rpcIndex = argv.indexOf("--rpc");
  const rpcKeyIndex = argv.indexOf("--rpc-key");
  const rpcTimeoutIndex = argv.indexOf("--rpc-timeout-ms");
  const offchainTimeoutIndex = argv.indexOf("--offchain-timeout-ms");
  return {
    snapshot:
      snapshotIndex >= 0 && argv[snapshotIndex + 1]
        ? argv[snapshotIndex + 1]
        : DEFAULT_SNAPSHOT,
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : DEFAULT_OUTPUT,
    cache:
      cacheIndex >= 0 && argv[cacheIndex + 1]
        ? argv[cacheIndex + 1]
        : DEFAULT_CACHE,
    delayMs:
      delayIndex >= 0 && argv[delayIndex + 1]
        ? Math.max(0, Number(argv[delayIndex + 1]))
        : DEFAULT_DELAY_MS,
    logEvery:
      logEveryIndex >= 0 && argv[logEveryIndex + 1]
        ? Math.max(1, Number(argv[logEveryIndex + 1]))
        : DEFAULT_LOG_EVERY,
    flushEvery:
      flushEveryIndex >= 0 && argv[flushEveryIndex + 1]
        ? Math.max(1, Number(argv[flushEveryIndex + 1]))
        : DEFAULT_FLUSH_EVERY,
    rpc:
      rpcIndex >= 0 && argv[rpcIndex + 1] ? argv[rpcIndex + 1] : DEFAULT_RPC_URL,
    rpcKey:
      rpcKeyIndex >= 0 && argv[rpcKeyIndex + 1]
        ? argv[rpcKeyIndex + 1]
        : DEFAULT_RPC_KEY,
    rpcTimeoutMs:
      rpcTimeoutIndex >= 0 && argv[rpcTimeoutIndex + 1]
        ? Math.max(1000, Number(argv[rpcTimeoutIndex + 1]))
        : DEFAULT_RPC_TIMEOUT_MS,
    offchainTimeoutMs:
      offchainTimeoutIndex >= 0 && argv[offchainTimeoutIndex + 1]
        ? Math.max(1000, Number(argv[offchainTimeoutIndex + 1]))
        : DEFAULT_OFFCHAIN_TIMEOUT_MS,
  };
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(__dirname, "..", p);
}

function resolveExistingPath(p) {
  const direct = resolvePath(p);
  if (fs.existsSync(direct)) return direct;
  if (p.startsWith("data/")) {
    const stripped = p.slice(5);
    const alt = resolvePath(stripped);
    if (fs.existsSync(alt)) return alt;
  } else {
    const prefixed = resolvePath(path.join("data", p));
    if (fs.existsSync(prefixed)) return prefixed;
  }
  return direct;
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(/\0/g, "").trim() : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label || "operation"} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

function buildConnection(rpcUrl, rpcKey) {
  if (!rpcUrl) throw new Error("Missing RPC URL");
  const headers = rpcKey ? { "x-api-key": rpcKey } : undefined;
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: headers,
  });
}

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

function loadCache(cachePath) {
  try {
    if (!fs.existsSync(cachePath)) return new Map();
    const raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (!raw || typeof raw !== "object") return new Map();
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function saveCache(cachePath, cache) {
  const out = {};
  for (const [mint, entry] of cache.entries()) out[mint] = entry;
  fs.writeFileSync(cachePath, JSON.stringify(out, null, 2));
}

async function fetchOffchainMetadataJson(uri, timeoutMs) {
  if (!uri) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 0);
  let response;
  try {
    response = await fetch(uri, {
      headers: { "user-agent": "traxr-solana/pumpswap-metadata" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function resolveMintMetadata(connection, mint, cache, opts) {
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

  if (cache.has(mint)) return cache.get(mint);

  const promise = (async () => {
    try {
      const pda = findMetadataPda(mint);
      const account = await withTimeout(
        connection.getAccountInfo(pda),
        opts.rpcTimeoutMs,
        "getAccountInfo",
      );
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
          const offchain = await fetchOffchainMetadataJson(
            uri,
            opts.offchainTimeoutMs,
          );
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
  })();

  cache.set(mint, promise);
  return promise;
}

function applyMetadata(row, tokenA, tokenB) {
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
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    const prev = row[key] ?? null;
    const next = value ?? null;
    if (prev !== next) {
      row[key] = next;
      changed = true;
    }
  }
  return changed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const snapshotPath = resolveExistingPath(opts.snapshot);
  const outputPath = resolvePath(opts.output);
  const cachePath = resolvePath(opts.cache);

  if (!fs.existsSync(snapshotPath)) {
    const dir = path.dirname(snapshotPath);
    const candidates = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((name) => name.startsWith("pumpswap.live.json_"))
          .slice(-10)
      : [];
    throw new Error(
      `Snapshot not found: ${snapshotPath}. Candidates: ${candidates.join(", ")}`,
    );
  }

  const rows = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  if (!Array.isArray(rows)) throw new Error("Snapshot JSON must be an array");

  const cache = loadCache(cachePath);
  const connection = buildConnection(opts.rpc, opts.rpcKey);

  const mints = [];
  const seen = new Set();
  for (const row of rows) {
    for (const mint of [row?.mintA?.address, row?.mintB?.address]) {
      if (mint && !seen.has(mint)) {
        seen.add(mint);
        mints.push(mint);
      }
    }
  }

  let resolved = 0;
  let failed = 0;
  const total = mints.length;
  for (let i = 0; i < mints.length; i += 1) {
    const mint = mints[i];
    let cachedHit = false;
    const cached = cache.get(mint);
    let metadata;
    if (cached && typeof cached.then !== "function") {
      metadata = cached;
      cachedHit = true;
    } else {
      metadata = await resolveMintMetadata(connection, mint, cache, opts);
    }
    if (metadata?.found) resolved += 1;
    else failed += 1;
    if ((i + 1) % opts.logEvery === 0 || i + 1 === total) {
      console.log(
        `[pumpswap] progress ${i + 1}/${total} resolved=${resolved} failed=${failed}`,
      );
    }
    if ((i + 1) % opts.flushEvery === 0 || i + 1 === total) {
      const interim = new Map();
      for (const [key, entry] of cache.entries()) {
        try {
          const resolvedEntry = await entry;
          interim.set(key, resolvedEntry);
        } catch (error) {
          interim.set(key, {
            mint: key,
            name: null,
            symbol: null,
            logo: null,
            uri: null,
            found: false,
            reason: error instanceof Error ? error.message : String(error),
            lastCheckedAt: new Date().toISOString(),
          });
        }
      }
      saveCache(cachePath, interim);
      console.log(`[pumpswap] cache flushed (${interim.size} mints)`);
    }
    if (!cachedHit && opts.delayMs > 0 && i + 1 < mints.length) {
      await sleep(opts.delayMs);
    }
  }

  const finalCache = new Map();
  for (const [mint, entry] of cache.entries()) {
    const resolvedEntry = await entry;
    finalCache.set(mint, resolvedEntry);
  }
  saveCache(cachePath, finalCache);

  let updated = 0;
  for (const row of rows) {
    const tokenA = finalCache.get(row?.mintA?.address) || {
      name: null,
      symbol: null,
      logo: null,
    };
    const tokenB = finalCache.get(row?.mintB?.address) || {
      name: null,
      symbol: null,
      logo: null,
    };
    if (applyMetadata(row, tokenA, tokenB)) updated += 1;
  }

  fs.writeFileSync(outputPath, JSON.stringify(rows, null, 2));
  console.log(
    `[pumpswap] metadata enrichment done: pools=${rows.length} uniqueMints=${mints.length} resolved=${resolved} failed=${failed} rowsUpdated=${updated}`,
  );
  console.log(`[pumpswap] wrote ${outputPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
