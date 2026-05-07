import { TraxrBadge } from "./TraxrBadge";
import { TraxrBreakdown } from "./TraxrBreakdown";
import { TraxrWarnings } from "./TraxrWarnings";
import { TraxrScoreResult } from "@/lib/types";
import Image from "next/image";
import TokenLogo from "@/components/TokenLogo";

type Props = {
  pool: TraxrScoreResult;
  datasetSummary?: {
    hasVolume24h?: boolean;
    hasVolume7d?: boolean;
    hasPriceRange24h?: boolean;
    hasFeeApr24h?: boolean;
    hasFeeApr7d?: boolean;
  };
  onCompare?: () => void;
  onTrend?: () => void;
};

function band(score: number) {
  if (score >= 80) return "Low Risk";
  if (score >= 40) return "Moderate";
  return "Elevated";
}

function estimateImpactPct(liquidityUsd: number) {
  if (!liquidityUsd || liquidityUsd <= 0) return 5;
  const tradeSizeUsd = 1000;
  const ratio = tradeSizeUsd / Math.max(liquidityUsd, tradeSizeUsd);
  return Math.min(5, Math.sqrt(ratio) * 100);
}

// TRAXR pool card shows score, CTS nodes, and Solana-oriented metrics.
export function TraxrPoolCard({ pool, datasetSummary, onCompare, onTrend }: Props) {
  const m: any = pool.metrics || pool;

  const nameA = tokenDisplay({
    mint: m.mintA,
    tokenName: m.tokenAName,
    tokenSymbol: m.tokenASymbol,
    tokenAddress: m.mintA,
  });

  const nameB = tokenDisplay({
    mint: m.mintB,
    tokenName: m.tokenBName,
    tokenSymbol: m.tokenBSymbol,
    tokenAddress: m.mintB,
  });

  const pairLine = nameB ? `${nameA} / ${nameB}` : nameA;
  const poolAddress = m.poolId;
  const tokenALogo =
    typeof m.tokenALogo === "string" && m.tokenALogo.trim().length > 0
      ? m.tokenALogo
      : null;
  const tokenBLogo =
    typeof m.tokenBLogo === "string" && m.tokenBLogo.trim().length > 0
      ? m.tokenBLogo
      : null;

  const liquidityUsd =
    typeof m.liquidityUsd === "number" ? m.liquidityUsd : 0;
  const vol24Usd =
    typeof m.volume24hUsd === "number" ? m.volume24hUsd : null;
  const vol7Usd =
    typeof m.volume7dUsd === "number" ? m.volume7dUsd : null;
  const priceMin =
    typeof m.priceMin24h === "number" ? m.priceMin24h : null;
  const priceMax =
    typeof m.priceMax24h === "number" ? m.priceMax24h : null;
  const feeApr24h =
    typeof m.feeApr24h === "number" ? m.feeApr24h : null;
  const feeApr7d =
    typeof m.feeApr7d === "number" ? m.feeApr7d : null;
  const feePct = typeof m.feePct === "number" ? m.feePct : null;
  const feeDisplay = feePct === null ? "Unknown" : `${feePct.toFixed(2)}%`;
  const priceImpactValue =
    typeof m.priceImpactPct === "number" ? m.priceImpactPct : null;
  const impactProxyPct = estimateImpactPct(liquidityUsd);
  const priceImpact =
    priceImpactValue === null
      ? `${impactProxyPct.toFixed(2)}% (est. $1k)`
      : `${priceImpactValue.toFixed(2)}%`;
  const utilizationPct =
    liquidityUsd > 0 && vol24Usd !== null
      ? (vol24Usd / liquidityUsd) * 100
      : null;
  const priceRangePct =
    priceMin !== null && priceMax !== null && priceMin > 0 && priceMax >= priceMin
      ? ((priceMax - priceMin) / priceMin) * 100
      : null;
  const showVolume7d = datasetSummary?.hasVolume7d ?? vol7Usd !== null;
  const showPriceRange = datasetSummary?.hasPriceRange24h ?? priceRangePct !== null;
  const showFeeApr24h = datasetSummary?.hasFeeApr24h ?? feeApr24h !== null;
  const showFeeApr7d = datasetSummary?.hasFeeApr7d ?? feeApr7d !== null;

  const explorerUrl = poolAddress
    ? `https://solscan.io/address/${poolAddress}`
    : null;

  return (
    <div className="grid gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur lg:grid-cols-3">
      {/* Header */}
      <div className="lg:col-span-3 flex flex-wrap items-center gap-3 overflow-hidden">
        <div className="shrink-0 text-xs uppercase tracking-[0.26em] text-white/60">
          TRAXR SCORE
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex shrink-0 items-center -space-x-2">
            <TokenLogo
              src={tokenALogo}
              label={m.tokenASymbol || m.tokenAName || "A"}
              className="h-8 w-8"
            />
            {nameB ? (
              <TokenLogo
                src={tokenBLogo}
                label={m.tokenBSymbol || m.tokenBName || "B"}
                className="h-8 w-8"
              />
            ) : null}
          </div>
          <div className="truncate whitespace-nowrap text-sm sm:text-base font-semibold text-white">
            {pairLine}
          </div>
        </div>
        {onCompare || onTrend ? (
          <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2">
            {onTrend ? (
              <button
                type="button"
                onClick={onTrend}
                className="flex-1 sm:flex-none rounded-full border border-amber-400/40 bg-amber-500/10 px-3 sm:px-4 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-100 shadow-[0_0_14px_rgba(255,200,80,0.2)] transition hover:border-amber-300 hover:text-white"
              >
                Trend
              </button>
            ) : null}
            {onCompare ? (
              <button
                type="button"
                onClick={onCompare}
                className="flex-1 sm:flex-none rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 sm:px-4 py-1.5 text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100 shadow-[0_0_14px_rgba(0,255,255,0.2)] transition hover:border-cyan-300 hover:text-white"
              >
                Compare
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Left column */}
      <div className="space-y-4">
        {/* CTS */}
        <div className="flex items-center justify-start rounded-2xl border border-green/80 px-4 py-4 text-xs uppercase tracking-[0.2em] text-white/60">
          <div className="flex items-center gap-3">
            <Image
              src={`/images/cts${Math.max(1, Math.min(6, pool.ctsNodes))}.png`}
              alt={`CTS ${pool.ctsNodes}`}
              width={112}
              height={112}
              className="h-20 w-20 object-contain drop-shadow-[0_0_22px_rgba(0,255,140,0.45)]"
            />
            <div className="flex flex-col">
              <span className="text-white/70">CTS Nodes</span>
              <span className="text-white text-base font-semibold tracking-[0.18em]">
                {pool.ctsNodes}
              </span>
            </div>
          </div>
        </div>

        {/* Score */}
        <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-black/30 p-3">
          <TraxrBadge score={pool.score} size="sm" />
          <div className="flex flex-col gap-1">
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-lg font-semibold text-white hover:text-cyan-200 underline-offset-4 hover:underline"
              >
                View on Solscan
              </a>
            ) : (
              <div className="text-lg font-semibold text-white">
                Pool program
              </div>
            )}
            <div className="text-sm text-white/60">
              {band(pool.score)} | {m.poolType ?? "Pool type unknown"}
            </div>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 text-sm text-white/70">
          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
              TVL
            </div>
            <div className="text-sm sm:text-base font-semibold text-white">
              {liquidityUsd.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })}{" "}
              USD
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
              24h Volume
            </div>
            <div className="text-sm sm:text-base font-semibold text-white">
              {vol24Usd === null
                ? "N/A"
                : `${vol24Usd.toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })} USD`}
            </div>
          </div>

          {showVolume7d && (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                7d Volume
              </div>
              <div className="text-sm sm:text-base font-semibold text-white">
                {vol7Usd === null
                  ? "N/A"
                  : `${vol7Usd.toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })} USD`}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
              Fee
            </div>
            <div className="text-sm sm:text-base font-semibold text-white">
              {feeDisplay}
            </div>
          </div>

          {showPriceRange && (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                24h Range
              </div>
              <div className="text-sm sm:text-base font-semibold text-white">
                {priceRangePct === null ? "N/A" : `${priceRangePct.toFixed(2)}%`}
              </div>
            </div>
          )}

          {utilizationPct !== null && (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                Utilization
              </div>
              <div className="text-sm sm:text-base font-semibold text-white">
                {utilizationPct.toFixed(2)}%
              </div>
            </div>
          )}

          {showFeeApr24h && (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                Fee APR (24h)
              </div>
              <div className="text-sm sm:text-base font-semibold text-white">
                {feeApr24h === null ? "N/A" : `${feeApr24h.toFixed(2)}%`}
              </div>
            </div>
          )}

          {showFeeApr7d && (
            <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
                Fee APR (7d)
              </div>
              <div className="text-sm sm:text-base font-semibold text-white">
                {feeApr7d === null ? "N/A" : `${feeApr7d.toFixed(2)}%`}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">
              Price Impact ($1k)
            </div>
            <div className="text-sm sm:text-base font-semibold text-white">
              {priceImpact}
            </div>
          </div>
        </div>
      </div>

      {/* Right column */}
      <div className="lg:col-span-2">
        <TraxrBreakdown
          nodes={pool.nodes}
          impactMeta={{
            pct: priceImpactValue === null ? impactProxyPct : priceImpactValue,
            estimated: priceImpactValue === null,
          }}
        />
      </div>

      {/* Warnings */}
      <div className="lg:col-span-3">
        <TraxrWarnings warnings={pool.warnings} />
      </div>
    </div>
  );
}

function tokenDisplay(opts: {
  mint?: string;
  tokenName?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
}) {
  const { mint, tokenName, tokenSymbol, tokenAddress } = opts;
  if (!mint && !tokenName && !tokenSymbol) return null;
  if (mint === "SINGLE") return null;
  const cleanSymbol = typeof tokenSymbol === "string" ? tokenSymbol.trim() : "";
  const cleanName = typeof tokenName === "string" ? tokenName.trim() : "";
  const isBadSymbol = cleanSymbol.length <= 2 || /^[0]+$/.test(cleanSymbol);
  const isBadName = cleanName.length <= 2 || /^[0]+$/.test(cleanName);
  const base = isBadSymbol
    ? cleanName.length >= 4 && !isBadName
      ? cleanName
      : mint || "Token"
    : cleanSymbol || (isBadName ? mint || "Token" : cleanName) || "Token";
  const address = tokenAddress || mint;

  if (address && address.length > 12) {
    const short = `${address.slice(0, 4)}...${address.slice(-4)}`;
    return `${base} (${short})`;
  }

  return base;
}
