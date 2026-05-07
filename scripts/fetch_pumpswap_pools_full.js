#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bs58 = require("bs58");
const { Connection, PublicKey } = require("@solana/web3.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
);
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const DEFAULT_OUTPUT = "pumpswap.live.json";
const TICKS_PER_ARRAY = 60;

const SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS = new Map([
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"],
  ["Es9vMFrzaCERmJfrF4H2FYD8nM5G4s46HoPazTA7kGEX", "USDT"],
  ["USD1xq2z7r5sF2pA4Y9W2T3C8v1D6n4p3mB6q1z2x3y", "USD1"],
  ["2b1kV6DkU4s6CwR7x6ub2E3rP6m3QjT1j2m8yQwX1m8y", "PYUSD"],
]);

function parseArgs(argv) {
  const outputIndex = argv.indexOf("--output");
  const sizeIndex = argv.indexOf("--data-size");
  const sizeListIndex = argv.indexOf("--data-size-list");
  const batchIndex = argv.indexOf("--batch-size");
  const throttleIndex = argv.indexOf("--throttle-ms");
  const stampIndex = argv.indexOf("--stamp");
  const gpaIndex = argv.indexOf("--gpa-rpc");
  const dataIndex = argv.indexOf("--data-rpc");
  const concurrencyIndex = argv.indexOf("--concurrency");
  const minLiquidityIndex = argv.indexOf("--min-liquidity-usd");
  const solUsdIndex = argv.indexOf("--sol-usd");
  const decimalsCacheIndex = argv.indexOf("--decimals-cache");
  const poolIndexIndex = argv.indexOf("--pool-index");
  const feeRateIndex = argv.indexOf("--fee-rate");
  const feePctIndex = argv.indexOf("--fee-pct");
  const cacheDecimals = argv.includes("--cache-decimals");
  const solCacheIndex = argv.indexOf("--sol-usd-cache");
  const solCacheTtlIndex = argv.indexOf("--sol-usd-cache-ttl");
  const onlyNew = argv.includes("--only-new");
  const diffIndex = argv.indexOf("--diff-from");
  const refreshFromIndex = argv.indexOf("--refresh-from");
  return {
    output:
      outputIndex >= 0 && argv[outputIndex + 1]
        ? argv[outputIndex + 1]
        : DEFAULT_OUTPUT,
    dataSize:
      sizeIndex >= 0 && argv[sizeIndex + 1]
        ? Number(argv[sizeIndex + 1])
        : 211,
    dataSizeList:
      sizeListIndex >= 0 && argv[sizeListIndex + 1]
        ? argv[sizeListIndex + 1]
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isFinite(n) && n > 0)
        : [211, 301],
    batchSize:
      batchIndex >= 0 && argv[batchIndex + 1]
        ? Math.max(10, Number(argv[batchIndex + 1]))
        : 50,
    throttleMs:
      throttleIndex >= 0 && argv[throttleIndex + 1]
        ? Math.max(0, Number(argv[throttleIndex + 1]))
        : 500,
    stamp:
      stampIndex >= 0 && argv[stampIndex + 1]
        ? argv[stampIndex + 1]
        : null,
    gpaRpc:
      gpaIndex >= 0 && argv[gpaIndex + 1] ? argv[gpaIndex + 1] : null,
    dataRpc:
      dataIndex >= 0 && argv[dataIndex + 1] ? argv[dataIndex + 1] : null,
    concurrency:
      concurrencyIndex >= 0 && argv[concurrencyIndex + 1]
        ? Math.max(1, Number(argv[concurrencyIndex + 1]))
        : 3,
    minLiquidityUsd:
      minLiquidityIndex >= 0 && argv[minLiquidityIndex + 1]
        ? Math.max(0, Number(argv[minLiquidityIndex + 1]))
        : 0,
    solUsd:
      solUsdIndex >= 0 && argv[solUsdIndex + 1]
        ? Number(argv[solUsdIndex + 1])
        : null,
    decimalsCache:
      decimalsCacheIndex >= 0 && argv[decimalsCacheIndex + 1]
        ? argv[decimalsCacheIndex + 1]
        : path.join(DATA_DIR, "pumpswap.mint_decimals.json"),
    poolIndex:
      poolIndexIndex >= 0 && argv[poolIndexIndex + 1]
        ? argv[poolIndexIndex + 1]
        : path.join(DATA_DIR, "pumpswap.pool_index.json"),
    feeRate: (() => {
      if (feeRateIndex >= 0 && argv[feeRateIndex + 1]) {
        const val = Number(argv[feeRateIndex + 1]);
        return Number.isFinite(val) ? val : null;
      }
      if (feePctIndex >= 0 && argv[feePctIndex + 1]) {
        const val = Number(argv[feePctIndex + 1]);
        return Number.isFinite(val) ? val / 100 : null;
      }
      if (process.env.PUMPSWAP_FEE_RATE) {
        const val = Number(process.env.PUMPSWAP_FEE_RATE);
        return Number.isFinite(val) ? val : null;
      }
      if (process.env.PUMPSWAP_FEE_PCT) {
        const val = Number(process.env.PUMPSWAP_FEE_PCT);
        return Number.isFinite(val) ? val / 100 : null;
      }
      return null;
    })(),
    cacheDecimals,
    solUsdCache:
      solCacheIndex >= 0 && argv[solCacheIndex + 1]
        ? argv[solCacheIndex + 1]
        : path.join(DATA_DIR, "pumpswap.sol_usd.json"),
    solUsdCacheTtlMs:
      solCacheTtlIndex >= 0 && argv[solCacheTtlIndex + 1]
        ? Math.max(0, Number(argv[solCacheTtlIndex + 1])) * 1000
        : 3600_000,
    onlyNew,
    diffFrom:
      diffIndex >= 0 && argv[diffIndex + 1] ? argv[diffIndex + 1] : null,
    refreshFrom:
      refreshFromIndex >= 0 && argv[refreshFromIndex + 1]
        ? argv[refreshFromIndex + 1]
        : null,
  };
}

function readPubkey(buf, offset) {
  return new PublicKey(buf.subarray(offset, offset + 32)).toBase58();
}

function readU64LE(buf, offset) {
  if (typeof buf.readBigUInt64LE === "function") {
    return buf.readBigUInt64LE(offset).toString();
  }
  const low = buf.readUInt32LE(offset);
  const high = buf.readUInt32LE(offset + 4);
  return (BigInt(high) << 32n | BigInt(low)).toString();
}

function decodePoolAccount(data) {
  let offset = 0;
  if (data.length >= 211) {
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

function decodeTokenAccount(data) {
  if (!data) return null;
  if (data.length === 8) {
    return { amount: readU64LE(data, 0) };
  }
  if (data.length < 165) return null;
  const mint = readPubkey(data, 0);
  const amount = readU64LE(data, 64);
  return { mint, amount };
}

function decodeMintAccount(data) {
  if (!data) return null;
  if (data.length === 1) {
    return { decimals: data.readUInt8(0) };
  }
  if (data.length < 82) return null;
  const decimals = data.readUInt8(44);
  return { decimals };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePath(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.join(__dirname, "..", p);
}

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadPoolIndex(indexPath) {
  const data = readJsonIfExists(indexPath);
  if (!data || typeof data !== "object") return new Map();
  const pools = data.pools && typeof data.pools === "object" ? data.pools : data;
  return new Map(Object.entries(pools));
}

function savePoolIndex(indexPath, indexMap) {
  const pools = {};
  for (const [key, value] of indexMap.entries()) pools[key] = value;
  const payload = {
    updatedAt: new Date().toISOString(),
    pools,
  };
  fs.writeFileSync(indexPath, JSON.stringify(payload, null, 2));
}

async function fetchMultipleAccounts(
  connection,
  pubkeys,
  label,
  throttleMs,
  config,
) {
  const maxRetries = 8;
  let attempt = 0;
  while (true) {
    try {
      return await connection.getMultipleAccountsInfo(pubkeys, {
        commitment: "confirmed",
        ...(config || {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("429") || attempt >= maxRetries) {
        throw err;
      }
      const delay = Math.max(throttleMs, 500) * 2 ** attempt;
      console.warn(`[pumpswap] ${label} rate limited, retrying in ${delay}ms`);
      await sleep(delay);
      attempt += 1;
    }
  }
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? null;
}

async function fetchProgramAccounts(connection, discriminatorBase58, dataSize) {
  return connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    dataSlice: { offset: 0, length: 0 },
    filters: [
      { memcmp: { offset: 0, bytes: discriminatorBase58 } },
      { dataSize },
    ],
  });
}

async function fetchProgramAccountsSharded(connection, discriminatorBase58, dataSize) {
  const accounts = [];
  const indexOffset = 8 + 1;
  for (let i = 0; i < 256; i += 1) {
    const shardByte = bs58.encode(Buffer.from([i]));
    const shardAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { memcmp: { offset: 0, bytes: discriminatorBase58 } },
        { dataSize },
        { memcmp: { offset: indexOffset, bytes: shardByte } },
      ],
    });
    if (shardAccounts.length) accounts.push(...shardAccounts);
    if ((i + 1) % 32 === 0) {
      console.log(`[pumpswap] shard ${i + 1}/256 accounts=${accounts.length}`);
    }
  }
  return accounts;
}

async function fetchProgramAccountsMultiSize(connection, discriminatorBase58, sizes) {
  const all = [];
  for (const size of sizes) {
    const accounts = await fetchProgramAccounts(connection, discriminatorBase58, size);
    if (accounts.length) {
      for (const acc of accounts) all.push(acc);
      console.log(`[pumpswap] program accounts size=${size} count=${accounts.length}`);
    }
  }
  return all;
}

async function fetchProgramAccountsShardedMultiSize(connection, discriminatorBase58, sizes) {
  const all = [];
  for (const size of sizes) {
    const accounts = await fetchProgramAccountsSharded(connection, discriminatorBase58, size);
    if (accounts.length) {
      for (const acc of accounts) all.push(acc);
      console.log(`[pumpswap] program accounts (sharded) size=${size} count=${accounts.length}`);
    }
  }
  return all;
}

function writeJson(filePath, payload) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function findLatestSnapshot(prefix) {
  const entries = fs
    .readdirSync(DATA_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort();
  return entries.length ? path.join(DATA_DIR, entries[entries.length - 1]) : null;
}

function loadKnownPoolIds(filePath) {
  try {
    if (!filePath) return new Set();
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(__dirname, "..", filePath);
    if (!fs.existsSync(fullPath)) return new Set();
    const data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    if (!Array.isArray(data)) return new Set();
    return new Set(data.map((row) => row.id).filter(Boolean));
  } catch {
    return new Set();
  }
}

function extractSolUsdCandidates(rows) {
  const candidates = [];
  for (const row of rows) {
    if (!row) continue;
    let mintA = null;
    let mintB = null;
    let price = null;
    if (row.tokenMintA && row.tokenMintB) {
      mintA = row.tokenMintA;
      mintB = row.tokenMintB;
      price = toNumber(row.price);
    } else if (row.mintA && row.mintB) {
      mintA = row.mintA.address;
      mintB = row.mintB.address;
      price = toNumber(row.price);
    }
    if (!mintA || !mintB || !price || price <= 0) continue;
    const aSol = mintA === SOL_MINT;
    const bSol = mintB === SOL_MINT;
    const aStable = STABLE_MINTS.has(mintA);
    const bStable = STABLE_MINTS.has(mintB);
    if (aSol && bStable && price > 10 && price < 500) candidates.push(price);
    if (bSol && aStable) {
      const implied = 1 / price;
      if (Number.isFinite(implied) && implied > 10 && implied < 500) {
        candidates.push(implied);
      }
    }
    if (candidates.length >= 50) break;
  }
  return candidates;
}

function computeSolUsdFallback() {
  const sources = [
    findLatestSnapshot("orca.live.json_"),
    findLatestSnapshot("amm.live.json_"),
    findLatestSnapshot("cpmm.live.json_"),
  ].filter(Boolean);
  for (const file of sources) {
    try {
      const rows = JSON.parse(fs.readFileSync(file, "utf8"));
      const candidates = extractSolUsdCandidates(rows);
      if (candidates.length) {
        return { solUsd: median(candidates), source: path.basename(file) };
      }
    } catch {
      continue;
    }
  }
  return { solUsd: null, source: null };
}

function loadSolUsdCache(cachePath, maxAgeMs) {
  const payload = readJsonIfExists(cachePath);
  if (!payload || typeof payload !== "object") return null;
  const ts = typeof payload.updatedAt === "string" ? Date.parse(payload.updatedAt) : NaN;
  if (!Number.isFinite(ts)) return null;
  if (maxAgeMs > 0 && Date.now() - ts > maxAgeMs) return null;
  if (typeof payload.solUsd !== "number" || !Number.isFinite(payload.solUsd)) return null;
  return payload;
}

function saveSolUsdCache(cachePath, solUsd, source) {
  writeJson(cachePath, {
    solUsd,
    source,
    updatedAt: new Date().toISOString(),
  });
}

async function processBatches(items, batchSize, concurrency, fn) {
  let index = 0;
  let inFlight = 0;
  return new Promise((resolve, reject) => {
    const next = () => {
      if (index >= items.length && inFlight === 0) return resolve();
      while (inFlight < concurrency && index < items.length) {
        const start = index;
        const batch = items.slice(start, start + batchSize);
        index += batchSize;
        inFlight += 1;
        fn(batch, start)
          .then(() => {
            inFlight -= 1;
            next();
          })
          .catch(reject);
      }
    };
    next();
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rpcUrl =
    opts.gpaRpc ||
    process.env.PUMPSWAP_RPC_URL ||
    process.env.NODEZERO_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    "https://api.mainnet-beta.solana.com";
  const dataRpcUrl =
    opts.dataRpc ||
    process.env.PUMPSWAP_DATA_RPC_URL ||
    process.env.NODEZERO_RPC_URL ||
    process.env.SOLANA_RPC_URL ||
    rpcUrl;

  const apiKey = process.env.NODEZERO_RPC_KEY || "";
  const gpaHeaders =
    rpcUrl.includes("nodezero") && apiKey ? { "x-api-key": apiKey } : undefined;
  const dataHeaders =
    dataRpcUrl.includes("nodezero") && apiKey ? { "x-api-key": apiKey } : undefined;

  const gpaConnection = new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: gpaHeaders,
  });
  const dataConnection = new Connection(dataRpcUrl, {
    commitment: "confirmed",
    httpHeaders: dataHeaders,
  });

  const discriminator = crypto
    .createHash("sha256")
    .update("account:Pool")
    .digest()
    .subarray(0, 8);
  const discriminatorBase58 = bs58.encode(discriminator);

  console.log(`[pumpswap] gpaRpc=${rpcUrl}`);
  console.log(`[pumpswap] dataRpc=${dataRpcUrl}`);
  console.log("[pumpswap] fetching program accounts...");
  let accounts = [];
  try {
    accounts = await fetchProgramAccountsMultiSize(
      gpaConnection,
      discriminatorBase58,
      opts.dataSizeList.length ? opts.dataSizeList : [opts.dataSize],
      );
      console.log(`[pumpswap] program accounts fetched: ${accounts.length}`);
    } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("scan aborted")) {
      console.warn("[pumpswap] scan aborted, falling back to sharded scan");
      accounts = await fetchProgramAccountsShardedMultiSize(
        gpaConnection,
        discriminatorBase58,
        opts.dataSizeList.length ? opts.dataSizeList : [opts.dataSize],
      );
      console.log(`[pumpswap] program accounts fetched (sharded): ${accounts.length}`);
    } else {
      throw err;
    }
  }

  const knownIds = loadKnownPoolIds(opts.diffFrom);
  if (knownIds.size) {
    const before = accounts.length;
    accounts = accounts.filter((acc) => !knownIds.has(acc.pubkey.toBase58()));
    console.log(
      `[pumpswap] diff-from: ${knownIds.size} known pools, remaining ${accounts.length}/${before}`,
    );
  }

  const poolIndexPath = resolvePath(opts.poolIndex);
  const poolIndex = loadPoolIndex(poolIndexPath);
  const poolRows = [];
  const tokenAccounts = new Set();
  const mintAccounts = new Set();
  const sizeBuckets = new Map();

  let refreshIds = null;
  if (opts.refreshFrom) {
    const refreshPath = resolvePath(opts.refreshFrom);
    const refreshRows = readJsonIfExists(refreshPath);
    if (Array.isArray(refreshRows)) {
      refreshIds = refreshRows
        .map((row) => row && row.id)
        .filter((id) => typeof id === "string");
      console.log(
        `[pumpswap] refresh-from: ${refreshIds.length} pool ids from ${refreshPath}`,
      );
    } else {
      console.warn(
        `[pumpswap] refresh-from ignored, invalid JSON: ${refreshPath}`,
      );
    }
  }

  const accountIds = accounts.map((acc) => acc.pubkey.toBase58());
  const newPoolIds = accountIds.filter((id) => !poolIndex.has(id));
  if (newPoolIds.length) {
    console.log(`[pumpswap] new pools detected: ${newPoolIds.length}`);
  }

  const selectedIds = new Set(refreshIds ?? accountIds);
  for (const id of newPoolIds) selectedIds.add(id);
  const missingIds = [];
  for (const id of selectedIds) {
    if (!poolIndex.has(id)) missingIds.push(id);
  }

  console.log("[pumpswap] decoding pool accounts...");
  const batchSize = opts.batchSize;
  const decodeTargets = missingIds.length
    ? missingIds.map((id) => new PublicKey(id))
    : [];
  for (let i = 0; i < decodeTargets.length; i += batchSize) {
    const batch = decodeTargets.slice(i, i + batchSize);
    const infos = await fetchMultipleAccounts(
      dataConnection,
      batch,
      "pool accounts",
      opts.throttleMs,
      null,
    );
    for (let j = 0; j < batch.length; j += 1) {
      const info = infos[j];
      if (!info) continue;
      const len = info.data.length;
      sizeBuckets.set(len, (sizeBuckets.get(len) || 0) + 1);
      const decoded = decodePoolAccount(info.data);
      if (!decoded) continue;
      const poolId = batch[j].toBase58();
      poolIndex.set(poolId, { pool_id: poolId, ...decoded });
    }
    if ((i + batchSize) % 2000 === 0) {
      console.log(
        `[pumpswap] decoded pools=${Math.min(
          i + batchSize,
          decodeTargets.length,
        )}/${decodeTargets.length}`,
      );
    }
    await sleep(opts.throttleMs);
  }

  for (const id of selectedIds) {
    const row = poolIndex.get(id);
    if (row) {
      poolRows.push(row);
      tokenAccounts.add(row.pool_base_token_account);
      tokenAccounts.add(row.pool_quote_token_account);
      mintAccounts.add(row.base_mint);
      mintAccounts.add(row.quote_mint);
      mintAccounts.add(row.lp_mint);
    }
  }

  savePoolIndex(poolIndexPath, poolIndex);

  console.log(`[pumpswap] pools selected: ${poolRows.length}`);
  console.log(
    `[pumpswap] account sizes (top5): ${Array.from(sizeBuckets.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([size, count]) => `${size}:${count}`)
      .join(", ")}`,
  );
  console.log(
    `[pumpswap] token accounts=${tokenAccounts.size} mint accounts=${mintAccounts.size}`,
  );

  const tokenAccountMap = new Map();
  const tokenAccountList = Array.from(tokenAccounts);
  console.log("[pumpswap] fetching token account balances...");
  const tokenSlice = { dataSlice: { offset: 64, length: 8 } };
  await processBatches(
    tokenAccountList,
    batchSize,
    opts.concurrency,
    async (chunk, start) => {
      const infos = await fetchMultipleAccounts(
        dataConnection,
        chunk.map((key) => new PublicKey(key)),
        "token accounts",
        opts.throttleMs,
        tokenSlice,
      );
      for (let j = 0; j < chunk.length; j += 1) {
        const info = infos[j];
        if (!info) continue;
        const decoded = decodeTokenAccount(info.data);
        if (!decoded) continue;
        tokenAccountMap.set(chunk[j], decoded.amount);
      }
      if ((start + batchSize) % 5000 === 0) {
        console.log(
          `[pumpswap] token accounts fetched ${Math.min(
            start + batchSize,
            tokenAccountList.length,
          )}/${tokenAccountList.length}`,
        );
      }
      await sleep(opts.throttleMs);
    },
  );

  const mintMap = new Map();
  const decimalsCache = opts.cacheDecimals ? readJsonIfExists(opts.decimalsCache) : null;
  if (decimalsCache && typeof decimalsCache === "object") {
    for (const [mint, decimals] of Object.entries(decimalsCache)) {
      if (typeof decimals === "number") mintMap.set(mint, decimals);
    }
  }

  const mintList = Array.from(mintAccounts).filter((mint) => !mintMap.has(mint));
  console.log(
    `[pumpswap] fetching mint decimals (uncached=${mintList.length})...`,
  );
  const mintSlice = { dataSlice: { offset: 44, length: 1 } };
  await processBatches(
    mintList,
    batchSize,
    opts.concurrency,
    async (chunk, start) => {
      const infos = await fetchMultipleAccounts(
        dataConnection,
        chunk.map((key) => new PublicKey(key)),
        "mint accounts",
        opts.throttleMs,
        mintSlice,
      );
      for (let j = 0; j < chunk.length; j += 1) {
        const info = infos[j];
        if (!info) continue;
        const decoded = decodeMintAccount(info.data);
        if (!decoded) continue;
        mintMap.set(chunk[j], decoded.decimals);
      }
      if ((start + batchSize) % 5000 === 0) {
        console.log(
          `[pumpswap] mint accounts fetched ${Math.min(
            start + batchSize,
            mintList.length,
          )}/${mintList.length}`,
        );
      }
      await sleep(opts.throttleMs);
    },
  );

  if (opts.cacheDecimals) {
    const payload = {};
    for (const [mint, decimals] of mintMap.entries()) {
      payload[mint] = decimals;
    }
    writeJson(opts.decimalsCache, payload);
    console.log(`[pumpswap] decimals cache updated: ${opts.decimalsCache}`);
  }

  console.log("[pumpswap] building dataset...");
  const solCandidates = [];
  const dataset = [];
  for (const pool of poolRows) {
    const decimalsA = mintMap.get(pool.base_mint) ?? 0;
    const decimalsB = mintMap.get(pool.quote_mint) ?? 0;
    const baseAmountRaw = tokenAccountMap.get(pool.pool_base_token_account);
    const quoteAmountRaw = tokenAccountMap.get(pool.pool_quote_token_account);
    if (!baseAmountRaw || !quoteAmountRaw) continue;
    const reserveA = Number(baseAmountRaw) / 10 ** decimalsA;
    const reserveB = Number(quoteAmountRaw) / 10 ** decimalsB;
    const price = reserveA > 0 ? reserveB / reserveA : null;

    const symbolA =
      pool.base_mint === SOL_MINT ? "WSOL" : STABLE_MINTS.get(pool.base_mint) ?? "";
    const symbolB =
      pool.quote_mint === SOL_MINT ? "WSOL" : STABLE_MINTS.get(pool.quote_mint) ?? "";

    if (price && price > 0) {
      const aSol = pool.base_mint === SOL_MINT;
      const bSol = pool.quote_mint === SOL_MINT;
      const aStable = STABLE_MINTS.has(pool.base_mint);
      const bStable = STABLE_MINTS.has(pool.quote_mint);
      if (aSol && bStable && price > 10 && price < 500) solCandidates.push(price);
      if (bSol && aStable) {
        const implied = 1 / price;
        if (Number.isFinite(implied) && implied > 10 && implied < 500) {
          solCandidates.push(implied);
        }
      }
    }

    dataset.push({
      type: "Standard",
      programId: PROGRAM_ID.toBase58(),
      id: pool.pool_id,
      mintA: {
        chainId: 101,
        address: pool.base_mint,
        programId: TOKEN_PROGRAM_ID,
        logoURI: "",
        symbol: symbolA,
        name: symbolA || "",
        decimals: decimalsA,
        tags: [],
        extensions: {},
      },
      mintB: {
        chainId: 101,
        address: pool.quote_mint,
        programId: TOKEN_PROGRAM_ID,
        logoURI: "",
        symbol: symbolB,
        name: symbolB || "",
        decimals: decimalsB,
        tags: [],
        extensions: {},
      },
      price: price ?? null,
      mintAmountA: reserveA,
      mintAmountB: reserveB,
      feeRate: opts.feeRate ?? null,
      openTime: "0",
      tvl: 0,
      day: {},
      week: {},
      month: {},
      pooltype: ["Pumpswap", "Cpmm"],
      rewardDefaultInfos: [],
      farmUpcomingCount: 0,
      farmOngoingCount: 0,
      farmFinishedCount: 0,
      lpMint: {
        chainId: 101,
        address: pool.lp_mint,
        programId: TOKEN_PROGRAM_ID,
        logoURI: "",
        symbol: "",
        name: "",
        decimals: mintMap.get(pool.lp_mint) ?? 0,
        tags: [],
        extensions: {},
      },
      lpPrice: null,
      lpAmount: null,
      burnPercent: 0,
      launchMigratePool: false,
      tips: [],
    });
  }

  let solUsd = median(solCandidates);
  let solUsdSource = "pumpswap";

  if (!solUsd) {
    const cached = loadSolUsdCache(opts.solUsdCache, opts.solUsdCacheTtlMs);
    if (cached) {
      solUsd = cached.solUsd;
      solUsdSource = cached.source ?? "cache";
    }
  }
  if (!solUsd && Number.isFinite(opts.solUsd)) {
    solUsd = opts.solUsd;
    solUsdSource = "manual";
  }
  if (!solUsd) {
    const fallback = computeSolUsdFallback();
    solUsd = fallback.solUsd;
    solUsdSource = fallback.source ?? "none";
  }
  if (solUsd) {
    saveSolUsdCache(opts.solUsdCache, solUsd, solUsdSource);
  }
  console.log(
    `[pumpswap] solUsd estimate=${solUsd ?? "n/a"} source=${solUsdSource} candidates=${solCandidates.length}`,
  );

  const filtered = [];
  const incremental = opts.onlyNew ? readJsonIfExists(opts.output) : null;
  const seenIds = new Set();
  if (incremental && Array.isArray(incremental)) {
    for (const row of incremental) {
      if (row && typeof row.id === "string") seenIds.add(row.id);
    }
  }

  for (const row of dataset) {
    const reserveA = toNumber(row.mintAmountA) ?? 0;
    const reserveB = toNumber(row.mintAmountB) ?? 0;
    const price = toNumber(row.price);
    if (!price || price <= 0) continue;
    const baseMint = row.mintA.address;
    const quoteMint = row.mintB.address;
    const baseStable = STABLE_MINTS.has(baseMint);
    const quoteStable = STABLE_MINTS.has(quoteMint);
    const baseSol = baseMint === SOL_MINT;
    const quoteSol = quoteMint === SOL_MINT;

    let tvlUsd = null;
    if (quoteStable) {
      tvlUsd = reserveA * price + reserveB;
    } else if (baseStable) {
      tvlUsd = reserveA + reserveB * (1 / price);
    } else if (quoteSol && solUsd) {
      tvlUsd = solUsd * (reserveA * price + reserveB);
    } else if (baseSol && solUsd) {
      tvlUsd = solUsd * (reserveA + reserveB * (1 / price));
    }
    if (tvlUsd !== null && Number.isFinite(tvlUsd)) row.tvl = tvlUsd;
    if (opts.minLiquidityUsd > 0) {
      if (!row.tvl || row.tvl < opts.minLiquidityUsd) continue;
    }
    if (opts.onlyNew && seenIds.has(row.id)) continue;
    filtered.push(row);
  }

  const stamp =
    opts.stamp ||
    new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const baseOutPath = path.isAbsolute(opts.output)
    ? opts.output
    : path.join(__dirname, "..", opts.output);
  const outPath = opts.onlyNew
    ? baseOutPath
    : baseOutPath.endsWith(".live.json")
      ? baseOutPath.replace(/\.live\.json$/i, `.live.json_${stamp}.json`)
      : baseOutPath.endsWith(".json")
        ? baseOutPath.replace(/\.json$/i, `_${stamp}.json`)
        : `${baseOutPath}_${stamp}.json`;

  if (opts.onlyNew && incremental && Array.isArray(incremental)) {
    const merged = incremental.concat(filtered);
    fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
    console.log(
      `[pumpswap] wrote ${merged.length} pools to ${outPath} (+${filtered.length} new)`,
    );
  } else {
    fs.writeFileSync(outPath, JSON.stringify(filtered, null, 2));
    console.log(`[pumpswap] wrote ${filtered.length} pools to ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
