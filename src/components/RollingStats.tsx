"use client";

import { useEffect, useMemo, useState } from "react";

/* ---------------------------------- */
/* Count-up hook                      */
/* ---------------------------------- */

function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.floor(eased * target));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [target, duration]);

  return value;
}

/* ---------------------------------- */
/* Stat bubble                        */
/* ---------------------------------- */

function formatCompact(value: number, terse = false) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: terse ? 0 : 1,
  }).format(value);
}

function Bubble({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: number | null;
  compact?: boolean;
}) {
  const animated = useCountUp(value ?? 0);
  const display = value === null ? "N/A" : formatCompact(animated, compact);
  const isLong = display.length >= 7;

  return (
    <div
      className={[
        "relative isolate z-0 flex w-full flex-col items-center justify-center overflow-hidden px-3 py-2 transition",
        compact
          ? "min-w-0 justify-self-center rounded-[1rem] border border-white/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0.01))] px-1 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:border-cyan-300/18"
          : "rounded-2xl border border-white/10 bg-white/5 hover:z-30 hover:border-cyan-400/40 hover:shadow-[0_0_18px_rgba(0,255,255,0.15)]",
      ].join(" ")}
      style={{
        width: compact ? "96px" : undefined,
        minWidth: compact ? "96px" : undefined,
        minHeight: compact ? "74px" : undefined,
        maxWidth: compact ? "96px" : undefined,
      }}
    >
      {compact && (
        <>
          <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/24 to-transparent" />
          <div className="pointer-events-none absolute top-2 h-1.5 w-1.5 rounded-full bg-cyan-200/35 blur-[1px]" />
        </>
      )}
      <div
        className={[
          "relative w-full overflow-hidden px-1 text-center font-semibold leading-none tabular-nums",
          compact
            ? isLong
              ? "text-[0.78rem] tracking-[-0.05em] text-cyan-100 sm:text-[0.84rem] lg:text-[0.98rem]"
              : "text-[0.88rem] tracking-[-0.05em] text-cyan-100 sm:text-[0.92rem] lg:text-[1.08rem]"
            : isLong
              ? "text-base tracking-tight text-cyan-300 sm:text-lg"
              : "text-lg tracking-tight text-cyan-300 sm:text-xl",
        ].join(" ")}
      >
        <span className="whitespace-nowrap">{display}</span>
      </div>

      <div
        className={[
          "relative flex items-center gap-1 uppercase",
          compact
            ? "mt-1 text-[0.38rem] tracking-[0.18em] text-white/42 sm:text-[0.4rem] lg:text-[0.48rem]"
            : "text-[9px] tracking-wider text-white/60 sm:text-[10px]",
        ].join(" ")}
      >
        <span>{label}</span>
      </div>
    </div>
  );
}

function CompactMetricCell({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  const animated = useCountUp(value ?? 0);
  const display = value === null ? "N/A" : formatCompact(animated, true);
  const isLong = display.length >= 6;

  return (
    <div className="relative flex min-h-[68px] flex-col items-center justify-center px-2 py-3 text-center sm:min-h-[74px]">
      <div className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/12 to-transparent" />
      <div className="pointer-events-none absolute top-2 h-1.5 w-1.5 rounded-full bg-cyan-200/28 blur-[1px]" />
      <div
        className={[
          "font-semibold leading-none tracking-[-0.04em] text-cyan-100 tabular-nums",
          isLong ? "text-[1rem] sm:text-[1.08rem]" : "text-[1.12rem] sm:text-[1.24rem]",
        ].join(" ")}
      >
        {display}
      </div>
      <div className="mt-2 text-[0.52rem] uppercase tracking-[0.2em] text-white/38 sm:text-[0.56rem]">
        {label}
      </div>
    </div>
  );
}

/* ---------------------------------- */
/* Rolling stats HUD                  */
/* ---------------------------------- */

export function RollingStats({
  pools,
  totalCount,
  summary,
  snapshotIso,
  compact = false,
}: {
  pools: {
    warnings?: string[];
    score?: number;
    poolId?: string;
    metrics?: {
      poolId?: string;
      poolProgramId?: string | null;
      volume24hUsd?: number | null;
    };
  }[];
  totalCount?: number;
  summary?: {
    totalLiquidityUsd?: number;
    totalVolume24hUsd?: number;
    elevatedPools?: number;
    warningPools?: number;
    programs?: number;
    hasVolume24h?: boolean;
  };
  snapshotIso?: string | null;
  compact?: boolean;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const totalPools = totalCount ?? pools.length;

  const scores = useMemo(
    () => pools.map((p) => p.score ?? 100).sort((a, b) => a - b),
    [pools],
  );

  const cutoff = scores[Math.floor(scores.length * 0.25)] ?? 0;

  const elevated =
    summary?.elevatedPools ??
    pools.filter((p) => (p.score ?? 100) <= cutoff).length;

  const signals =
    summary?.warningPools ??
    pools.filter(
      (p) => (p.warnings ?? []).some((w) => !w.toLowerCase().startsWith("info")),
    ).length;

  const programs =
    summary?.programs ??
    new Set(
      pools
        .map((p) => p.metrics?.poolProgramId || p.poolId || p.metrics?.poolId)
        .filter(Boolean),
    ).size;

  const hasVolume24h =
    summary?.hasVolume24h ??
    pools.some(
      (p) =>
        typeof p.metrics?.volume24hUsd === "number" &&
        Number.isFinite(p.metrics.volume24hUsd),
    );

  const items = [
    {
      key: "pools",
      label: "Pools",
      value: totalPools,
      description:
        "Solana pools included in the current indexed snapshot (source-backed, not full network coverage).",
    },
    {
      key: "tvl",
      label: "TVL",
      value: Math.round(summary?.totalLiquidityUsd ?? 0),
      description:
        "Total value locked across pools in this dataset (USD).",
    },
    {
      key: "volume",
      label: "24h Vol",
      value: hasVolume24h
        ? Math.round(summary?.totalVolume24hUsd ?? 0)
        : null,
      description:
        "Total 24h swap volume across pools in this dataset (USD).",
    },
    {
      key: "signals",
      label: "Signals",
      value: signals,
      description:
        "Pools with at least one warning emitted by the scoring engine for this snapshot.",
    },
    {
      key: "elevated",
      label: "Elevated",
      value: elevated,
      description:
        "Bottom quartile by score within this dataset. Relative positioning only, not an absolute verdict.",
    },
    {
      key: "programs",
      label: "Programs",
      value: programs,
      description:
        "Unique pool program IDs resolved in the snapshot.",
    },
  ];

  return (
    <section className="relative w-full overflow-visible px-0 py-0">
      {compact ? (
        <div className="overflow-hidden">
          <div className="grid grid-cols-3 divide-x divide-y divide-white/6 sm:grid-cols-6 sm:divide-y-0">
            {items.map((item) => (
              <CompactMetricCell
                key={item.key}
                label={item.label}
                value={item.value}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap justify-center gap-2.5">
          {items.map((item) => (
            <Bubble
              key={item.key}
              label={item.label}
              value={item.value}
            />
          ))}
        </div>
      )}

      <div
        className={[
          "mt-2.5",
          compact
            ? "flex flex-col items-center gap-1.5 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left"
            : "flex flex-col items-center gap-3",
        ].join(" ")}
      >
        <div
          className={[
            "text-white/45",
            compact
              ? "text-[0.5rem] tracking-[0.04em] text-white/30 sm:text-[0.54rem] lg:text-[0.6rem]"
              : "text-center text-[9px] sm:text-[10px]",
          ].join(" ")}
      >
          Snapshot of ~{totalPools.toLocaleString()} pools | Solana |{" "}
          {snapshotIso ? `As of ${new Date(snapshotIso).toLocaleString()}` : "Indexed + normalized data"}
        </div>
        <button
          type="button"
          onClick={() => setShowInfo(true)}
          className={[
            "transition",
            compact
              ? "px-1 py-0.5 text-[0.5rem] uppercase tracking-[0.18em] text-white/42 hover:text-cyan-100 sm:text-[0.54rem]"
              : "border border-white/10 bg-white/5 px-2.5 py-[6px] text-[10px] uppercase tracking-wide text-white/60 hover:border-cyan-400/40 hover:text-white/80",
          ].join(" ")}
        >
          info
        </button>
      </div>

      {showInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0b1220]/95 p-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">What the bubbles mean</h3>
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-white/70 hover:border-cyan-400/40 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-white/80">
              {items.map((item) => (
                <div key={item.key}>
                  <span className="font-semibold text-cyan-200">{item.label}:</span>{" "}
                  {item.description}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
