#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const BN = require("bn.js");
const Decimal = require("decimal.js");
const { Connection, PublicKey } = require("@solana/web3.js");
const { ReadOnlyWallet, Percentage } = require("@orca-so/common-sdk");
const {
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
  UseFallbackTickArray,
  WhirlpoolContext,
  buildWhirlpoolClient,
  swapQuoteByInputToken,
} = require("@orca-so/whirlpools-sdk");

const DATA_DIR = path.join(__dirname, "..", "data");
const ORCA_FILE_RE =
  /^orca\.live\.json_(\d{4}-\d{2}-\d{2}T\d{6}\d{3}Z)\.json$/i;
const DEFAULT_RPC_URL =
  process.env.NODEZERO_RPC_URL || "https://nodezero.crosswalk.pro/rpc-internal";
const TRADE_SIZE_USD = 1_000;
const RPC_TIMEOUT_MS = 15_000;
const MIN_TVL_USD = 1_000;
const MIN_VOLUME24H_USD = 250;
const INTER_POOL_DELAY_MS = 150;

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
  const opts = {
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
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  return opts;
}

function printHelp() {
  console.log(`Usage:
  npm run repair:orca-impact
  npm run repair:orca-impact -- --latest
  npm run repair:orca-impact -- --snapshot orca.live.json_<timestamp>.json
  npm run repair:orca-impact -- --pool <POOL_ID>
  npm run repair:orca-impact:write -- --latest

Defaults:
  latest snapshot only
  trade size = $${TRADE_SIZE_USD}
  rpc-url = ${DEFAULT_RPC_URL}

Required env:
  NODEZERO_RPC_KEY
`);
}

function formatMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function decimalPow10(exp) {
  return new Decimal(10).pow(exp);
}

function amountToBn(amount, decimals) {
  return new BN(
    new Decimal(amount).mul(decimalPow10(decimals)).floor().toFixed(0),
  );
}

function bnToDecimal(amount, decimals) {
  return new Decimal(amount.toString()).div(decimalPow10(decimals));
}

function listOrcaSnapshots() {
  return fs
    .readdirSync(DATA_DIR)
    .filter((name) => ORCA_FILE_RE.test(name))
    .map((name) => {
      const match = name.match(ORCA_FILE_RE);
      return {
        name,
        fullPath: path.join(DATA_DIR, name),
        stamp: match ? match[1] : "",
      };
    })
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

function pickSnapshots(opts) {
  const snapshots = listOrcaSnapshots();
  if (!snapshots.length) throw new Error(`No Orca snapshot files found in ${DATA_DIR}`);
  if (opts.snapshot) {
    const found = snapshots.find((file) => file.name === opts.snapshot);
    if (!found) throw new Error(`Snapshot not found: ${opts.snapshot}`);
    return [found];
  }
  if (opts.latest) return [snapshots[0]];
  return snapshots;
}

function deriveSpotPrice(pool) {
  return toNumber(pool?.price);
}

function deriveTokenUsd(pool, spotPrice) {
  const tvlUsd = toNumber(pool?.tvlUsdc ?? pool?.tvl);
  const reserveA = toNumber(pool?.tokenBalanceA ?? pool?.mintAmountA ?? pool?.reserveA);
  const reserveB = toNumber(pool?.tokenBalanceB ?? pool?.mintAmountB ?? pool?.reserveB);
  const decimalsA = Number(
    pool?.tokenA?.decimals ?? pool?.decimalsA ?? pool?.tokenADecimals ?? 6,
  );
  const decimalsB = Number(
    pool?.tokenB?.decimals ?? pool?.decimalsB ?? pool?.tokenBDecimals ?? 6,
  );

  if (
    tvlUsd !== null &&
    tvlUsd > 0 &&
    reserveA !== null &&
    reserveA > 0 &&
    reserveB !== null &&
    reserveB > 0 &&
    spotPrice !== null &&
    spotPrice > 0
  ) {
    const reserveANormalized = reserveA / 10 ** decimalsA;
    const reserveBNormalized = reserveB / 10 ** decimalsB;
    if (reserveANormalized > 0 && reserveBNormalized > 0) {
      const denominator = reserveANormalized * spotPrice + reserveBNormalized;
      if (Number.isFinite(denominator) && denominator > 0) {
        const tokenBUsd = tvlUsd / denominator;
        const tokenAUsd = tokenBUsd * spotPrice;
        return {
          tokenAUsd,
          tokenBUsd,
          decimalsA,
          decimalsB,
        };
      }
      return {
        tokenAUsd: null,
        tokenBUsd: null,
        decimalsA,
        decimalsB,
      };
    }
  }

  const symbolA = String(pool?.tokenA?.symbol ?? pool?.tokenASymbol ?? "").toUpperCase();
  const symbolB = String(pool?.tokenB?.symbol ?? pool?.tokenBSymbol ?? "").toUpperCase();
  const mintA = String(pool?.tokenMintA ?? pool?.mintA ?? "");
  const mintB = String(pool?.tokenMintB ?? pool?.mintB ?? "");
  const isSolA = symbolA === "SOL" || mintA === "So11111111111111111111111111111111111111112";
  const isSolB = symbolB === "SOL" || mintB === "So11111111111111111111111111111111111111112";
  const solUsdGuess = 94;

  if (spotPrice !== null && spotPrice > 0 && isSolA) {
    return {
      tokenAUsd: solUsdGuess,
      tokenBUsd: solUsdGuess / spotPrice,
      decimalsA,
      decimalsB,
    };
  }
  if (spotPrice !== null && spotPrice > 0 && isSolB) {
    return {
      tokenAUsd: solUsdGuess * spotPrice,
      tokenBUsd: solUsdGuess,
      decimalsA,
      decimalsB,
    };
  }

  return {
    tokenAUsd: null,
    tokenBUsd: null,
    decimalsA,
    decimalsB,
  };
}

function isViableOrcaPool(pool) {
  const tvlUsd = toNumber(pool?.tvlUsdc ?? pool?.tvl);
  const vol24Usd = toNumber(pool?.stats?.["24h"]?.volume);
  const spotPrice = deriveSpotPrice(pool);
  const poolId = getPoolId(pool);
  const mintA = pool?.tokenMintA ?? pool?.mintA;
  const mintB = pool?.tokenMintB ?? pool?.mintB;
  const decimalsA = pool?.tokenA?.decimals ?? pool?.decimalsA ?? pool?.tokenADecimals;
  const decimalsB = pool?.tokenB?.decimals ?? pool?.decimalsB ?? pool?.tokenBDecimals;

  if (!poolId) return { ok: false, reason: "missing pool id" };
  if (!mintA || !mintB) return { ok: false, reason: "missing token mint" };
  if (!Number.isFinite(spotPrice) || spotPrice <= 0) {
    return { ok: false, reason: "missing spot price" };
  }
  if (!Number.isFinite(tvlUsd) || tvlUsd < MIN_TVL_USD) {
    return { ok: false, reason: `tvl below ${MIN_TVL_USD}` };
  }
  if (!Number.isFinite(vol24Usd) || vol24Usd < MIN_VOLUME24H_USD) {
    return { ok: false, reason: `24h volume below ${MIN_VOLUME24H_USD}` };
  }
  if (!Number.isFinite(Number(decimalsA)) || !Number.isFinite(Number(decimalsB))) {
    return { ok: false, reason: "missing token decimals" };
  }
  return { ok: true, reason: null };
}

function getPoolId(pool) {
  return pool?.address || pool?.id || pool?.poolId || null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function buildClient(rpcUrl) {
  const apiKey = process.env.NODEZERO_RPC_KEY;
  if (!apiKey) throw new Error("Missing NODEZERO_RPC_KEY");
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    httpHeaders: {
      "x-api-key": apiKey,
    },
  });
  const wallet = new ReadOnlyWallet(PublicKey.default);
  const ctx = WhirlpoolContext.from(connection, wallet);
  return buildWhirlpoolClient(ctx);
}

async function quoteImpact(pool, client) {
  const poolId = getPoolId(pool);
  if (!poolId) return { value: null, reason: "missing pool id" };

  try {
    const whirlpool = await withTimeout(
      client.getPool(new PublicKey(poolId)),
      RPC_TIMEOUT_MS,
    );
    const poolData = whirlpool.getData();
    const decimalsA = Number(
      pool?.tokenA?.decimals ?? pool?.decimalsA ?? pool?.tokenADecimals ?? 6,
    );
    const decimalsB = Number(
      pool?.tokenB?.decimals ?? pool?.decimalsB ?? pool?.tokenBDecimals ?? 6,
    );
    const liveSpotPrice = PriceMath.sqrtPriceX64ToPrice(
      poolData.sqrtPrice,
      decimalsA,
      decimalsB,
    ).toNumber();
    if (!Number.isFinite(liveSpotPrice) || liveSpotPrice <= 0) {
      return { value: null, reason: "missing live spot price" };
    }
    const { tokenAUsd, tokenBUsd } = deriveTokenUsd(pool, liveSpotPrice);
    if (!tokenAUsd || !tokenBUsd) {
      return { value: null, reason: "unable to derive token USD prices" };
    }

    const fetcher = client.getFetcher();
    const mintA = new PublicKey(pool?.tokenMintA ?? pool?.mintA);
    const mintB = new PublicKey(pool?.tokenMintB ?? pool?.mintB);

    const [quoteAToB, quoteBToA] = await Promise.allSettled([
      withTimeout(
        swapQuoteByInputToken(
          whirlpool,
          mintA,
          amountToBn(new Decimal(TRADE_SIZE_USD).div(tokenAUsd), decimalsA),
          Percentage.fromFraction(1, 1000),
          ORCA_WHIRLPOOL_PROGRAM_ID,
          fetcher,
          undefined,
          UseFallbackTickArray.Always,
        ),
        RPC_TIMEOUT_MS,
      ),
      withTimeout(
        swapQuoteByInputToken(
          whirlpool,
          mintB,
          amountToBn(new Decimal(TRADE_SIZE_USD).div(tokenBUsd), decimalsB),
          Percentage.fromFraction(1, 1000),
          ORCA_WHIRLPOOL_PROGRAM_ID,
          fetcher,
          undefined,
          UseFallbackTickArray.Always,
        ),
        RPC_TIMEOUT_MS,
      ),
    ]);

    const impacts = [];
    const reasons = [];

    if (quoteAToB.status === "fulfilled") {
      const actualIn = bnToDecimal(quoteAToB.value.estimatedAmountIn, decimalsA);
      const actualOut = bnToDecimal(quoteAToB.value.estimatedAmountOut, decimalsB);
      const idealOut = actualIn.mul(liveSpotPrice);
      if (idealOut.gt(0)) {
        impacts.push(idealOut.minus(actualOut).abs().div(idealOut).mul(100).toNumber());
      }
    } else {
      reasons.push(
        quoteAToB.reason instanceof Error
          ? quoteAToB.reason.message
          : String(quoteAToB.reason),
      );
    }

    if (quoteBToA.status === "fulfilled") {
      const actualIn = bnToDecimal(quoteBToA.value.estimatedAmountIn, decimalsB);
      const actualOut = bnToDecimal(quoteBToA.value.estimatedAmountOut, decimalsA);
      const idealOut = actualIn.div(liveSpotPrice);
      if (idealOut.gt(0)) {
        impacts.push(idealOut.minus(actualOut).abs().div(idealOut).mul(100).toNumber());
      }
    } else {
      reasons.push(
        quoteBToA.reason instanceof Error
          ? quoteBToA.reason.message
          : String(quoteBToA.reason),
      );
    }

    return {
      value: impacts.length ? Math.max(...impacts) : null,
      reason: impacts.length ? null : reasons[0] ?? "no exact quote",
    };
  } catch (error) {
    return {
      value: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function processSnapshot(fileInfo, opts, client) {
  const startedAt = Date.now();
  const raw = JSON.parse(fs.readFileSync(fileInfo.fullPath, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error(`${fileInfo.name} is not a JSON array`);
  }

  const candidates = opts.poolId
    ? raw.filter((entry) => getPoolId(entry) === opts.poolId)
    : raw;
  if (!candidates.length) {
    throw new Error(
      opts.poolId
        ? `Pool ${opts.poolId} not found in ${fileInfo.name}`
        : `No pools in ${fileInfo.name}`,
    );
  }

  const pools = [];
  let skipped = 0;
  const skipReasons = new Map();
  for (const entry of candidates) {
    const viable = isViableOrcaPool(entry);
    if (opts.poolId || viable.ok) {
      pools.push(entry);
    } else {
      skipped += 1;
      skipReasons.set(viable.reason, (skipReasons.get(viable.reason) || 0) + 1);
    }
  }

  if (!pools.length) {
    return {
      file: fileInfo.name,
      pools: 0,
      candidates: candidates.length,
      skipped,
      changed: 0,
      success: 0,
      failed: 0,
      nonQuotable: 0,
      elapsedMs: Date.now() - startedAt,
      reasons: skipReasons,
    };
  }

  let changed = 0;
  let success = 0;
  let failed = 0;
  let nonQuotable = 0;
  const reasons = new Map();

  for (let idx = 0; idx < pools.length; idx += 1) {
    const entry = pools[idx];
    const quoteStart = Date.now();
    const result = await quoteImpact(entry, client);
    const prev = toNumber(entry.priceImpactPct);
    const next = result.value;
    const shouldWrite =
      (prev === null && next !== null) ||
      (prev !== null && next !== null && Math.abs(prev - next) > 1e-12);

    if (shouldWrite) {
      entry.priceImpactPct = next;
      changed += 1;
    }

    if (next !== null) {
      success += 1;
    } else {
      failed += 1;
      if (
        result.reason &&
        /traversed too many arrays|out of bounds/i.test(result.reason)
      ) {
        nonQuotable += 1;
      }
      const key = result.reason || "unknown";
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }

    const poolId = getPoolId(entry);
    console.log(
      `${fileInfo.name} :: ${poolId} :: ${
        next === null ? "n/a" : `${next.toFixed(6)}%`
      } :: ${formatMs(Date.now() - quoteStart)}${result.reason ? ` :: ${result.reason}` : ""}`,
    );
    if (idx + 1 < pools.length) {
      await sleep(INTER_POOL_DELAY_MS);
    }
  }

  if (!opts.dryRun && changed > 0) {
    fs.writeFileSync(fileInfo.fullPath, JSON.stringify(raw, null, 2));
  }

  return {
    file: fileInfo.name,
    pools: pools.length,
    candidates: candidates.length,
    skipped,
    changed,
    success,
    failed,
    nonQuotable,
    elapsedMs: Date.now() - startedAt,
    reasons: new Map([...reasons, ...skipReasons]),
  };
}

async function main() {
  initEnv();
  const opts = parseArgs(process.argv.slice(2));
  const files = pickSnapshots(opts);
  const client = buildClient(opts.rpcUrl);

  console.log(
    `${opts.dryRun ? "[DRY RUN]" : "[WRITE]"} Orca price impact recompute`,
  );
  console.log(`RPC URL: ${opts.rpcUrl}`);
  console.log(`Trade size: $${TRADE_SIZE_USD}`);
  console.log(`Snapshots: ${files.map((f) => f.name).join(", ")}`);
  if (opts.poolId) {
    console.log(`Pool filter: ${opts.poolId}`);
  }
  console.log("");

  const allReasons = new Map();
  const startedAt = Date.now();

  for (const file of files) {
    const result = await processSnapshot(file, opts, client);
    console.log("");
    console.log(
      `Summary ${result.file}: candidates=${result.candidates}, quoted=${result.pools}, skipped=${result.skipped}, changed=${result.changed}, success=${result.success}, failed=${result.failed}, nonQuotable=${result.nonQuotable}, elapsed=${formatMs(result.elapsedMs)}`,
    );
    for (const [reason, count] of result.reasons.entries()) {
      allReasons.set(reason, (allReasons.get(reason) || 0) + count);
    }
    console.log("");
  }

  console.log(`Total elapsed: ${formatMs(Date.now() - startedAt)}`);
  if (allReasons.size) {
    console.log("Failure reasons:");
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
