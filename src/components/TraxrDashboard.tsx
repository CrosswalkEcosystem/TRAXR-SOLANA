"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TraxrScoreResult } from "@/lib/types";
import { TraxrPoolCard } from "./TraxrPoolCard";
import { TraxrTrustMap } from "./TraxrTrustMap";
import { TraxrConsole } from "./TraxrConsole";
import { TraxrLiquidityChart } from "./TraxrLiquidityChart";
import { TraxrCompareModal } from "./TraxrCompareModal";
import { TraxrTrendModal } from "./TraxrTrendModal";
import { PoolCombobox } from "./PoolCombobox";
import { RollingStats } from "./RollingStats";
import { getSignalCoverage } from "@/lib/signalCoverage";

type DashboardDatasetKey =
  | "amm"
  | "clmm"
  | "cpmm"
  | "other"
  | "orca"
  | "pumpswap"
  | "meteora"
  | "meteora-dammv2";

type Props = {
  pools: TraxrScoreResult[];
  groupKey: "raydium" | "orca" | "meteora" | "pumpswap";
  onGroupChange: (key: "raydium" | "orca" | "meteora" | "pumpswap") => void;
  datasetKey: DashboardDatasetKey;
  onDatasetChange: (key: DashboardDatasetKey) => void;
  totalPools: number;
  loading: boolean;
  logs: string[];
  datasetSummary?: {
    totalLiquidityUsd?: number;
    totalVolume24hUsd?: number;
    elevatedPools?: number;
    warningPools?: number;
    programs?: number;
    medianScore?: number;
    hasVolume24h?: boolean;
    hasVolume7d?: boolean;
    hasPriceRange24h?: boolean;
    hasFeeApr24h?: boolean;
    hasFeeApr7d?: boolean;
    snapshotIso?: string | null;
  };
};

// Main TRAXR dashboard; consumes pre-scored pools from cache/endpoint.
export function TraxrDashboard({
  pools,
  groupKey,
  onGroupChange,
  datasetKey,
  onDatasetChange,
  totalPools,
  loading,
  logs,
  datasetSummary,
}: Props) {
  const stickyTopClass =
    "top-[calc(4.15rem+env(safe-area-inset-top))] sm:top-[calc(4.6rem+env(safe-area-inset-top))]";
  const searchRowRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [compareOpen, setCompareOpen] = useState(false);
  const [trendOpen, setTrendOpen] = useState(false);
  const [selectedFresh, setSelectedFresh] = useState<TraxrScoreResult | null>(null);
  const [searchResults, setSearchResults] = useState<TraxrScoreResult[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [compactSticky, setCompactSticky] = useState(false);
  const sorted = useMemo(
    () => [...pools].sort((a, b) => b.score - a.score),
    [pools],
  );

  const queryTrimmed = query.trim();
  const usingSearch = queryTrimmed.length >= 2;
  const signalCoverage = getSignalCoverage(datasetKey);
  const raydiumTabs = [
    { key: "amm", label: "AMM" },
    { key: "clmm", label: "CLMM" },
    { key: "cpmm", label: "CPMM" },
    { key: "other", label: "Others" },
  ] as const;
  const meteoraTabs = [
    { key: "meteora", label: "DLMM" },
    { key: "meteora-dammv2", label: "DAMM v2" },
  ] as const;
  const groupDisplayLabel =
    groupKey === "raydium"
      ? "Raydium"
      : groupKey === "meteora"
        ? "Meteora"
        : groupKey === "orca"
          ? "Orca"
          : "PumpSwap";
  const currentDatasetTabs =
    groupKey === "raydium"
      ? raydiumTabs
      : groupKey === "meteora"
        ? meteoraTabs
        : null;
  const datasetDisplayLabel =
    datasetKey === "amm"
      ? "AMM"
      : datasetKey === "clmm"
        ? "CLMM"
        : datasetKey === "cpmm"
          ? "CPMM"
          : datasetKey === "other"
            ? "Others"
            : datasetKey === "orca"
              ? "Orca"
              : datasetKey === "pumpswap"
                ? "PumpSwap"
                : datasetKey === "meteora"
                  ? "DLMM"
                  : "DAMM v2";

  useEffect(() => {
    const updateSticky = () => {
      if (!searchRowRef.current) return;
      const headerOffset = window.innerWidth >= 640 ? 118 : 108;
      const { bottom } = searchRowRef.current.getBoundingClientRect();
      setCompactSticky(bottom <= headerOffset);
    };

    updateSticky();
    window.addEventListener("scroll", updateSticky, { passive: true });
    window.addEventListener("resize", updateSticky);
    return () => {
      window.removeEventListener("scroll", updateSticky);
      window.removeEventListener("resize", updateSticky);
    };
  }, []);

  useEffect(() => {
    if (!usingSearch) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const handler = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/traxr/search?q=${encodeURIComponent(queryTrimmed)}&limit=200&dataset=${encodeURIComponent(datasetKey)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSearchResults(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handler);
    };
  }, [datasetKey, queryTrimmed, usingSearch]);

  const filtered = useMemo(
    () => (usingSearch ? searchResults ?? [] : sorted),
    [searchResults, sorted, usingSearch],
  );

  const [selectedPoolId, setSelectedPoolId] = useState(
    () => filtered[0]?.poolId,
  );
  const selectedBase =
    filtered.find((p) => p.poolId === selectedPoolId) || filtered[0];
  const selected =
    selectedFresh && selectedFresh.poolId === selectedBase?.poolId
      ? selectedFresh
      : selectedBase;

  useEffect(() => {
    if (!filtered.length) return;
    if (!selectedPoolId || !filtered.some((p) => p.poolId === selectedPoolId)) {
      setSelectedPoolId(filtered[0].poolId);
    }
  }, [filtered, selectedPoolId]);

  useEffect(() => {
    if (!selectedBase?.poolId) {
      setSelectedFresh(null);
      return;
    }
    let cancelled = false;
    fetch(
      `/api/traxr/pools/${encodeURIComponent(selectedBase.poolId)}?dataset=${encodeURIComponent(datasetKey)}`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setSelectedFresh(json && typeof json === "object" ? (json as TraxrScoreResult) : null);
        }
      })
      .catch(() => {
        if (!cancelled) setSelectedFresh(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBase?.poolId, datasetKey]);

  const handleSelect = useCallback(
    (p: TraxrScoreResult) => {
      setSelectedPoolId(p.poolId);
      requestAnimationFrame(() => {
        document
          .getElementById("traxr-selected-card")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [],
  );

  const handleComboboxChange = useCallback((poolId: string) => {
    setSelectedPoolId(poolId);
    requestAnimationFrame(() => {
      document
        .getElementById("traxr-selected-card")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const renderGroupButtons = (compact = false) =>
    (
      [
        { key: "raydium", label: "Raydium" },
        { key: "orca", label: "Orca" },
        { key: "meteora", label: "Meteora" },
        { key: "pumpswap", label: "PumpSwap" },
      ] as const
    ).map((item) => (
      <button
        key={item.key}
        type="button"
        onClick={() => onGroupChange(item.key)}
        className={`min-w-0 rounded-full border uppercase transition ${
          compact
            ? "min-h-7 px-2.5 py-1 text-[0.5rem] tracking-[0.14em] sm:min-h-7 sm:px-3 sm:text-[0.56rem] sm:tracking-[0.18em]"
            : "min-h-8 px-1.5 py-1.5 text-[0.56rem] tracking-[0.1em] sm:min-h-9 sm:px-3.5 sm:py-2 sm:text-[0.68rem] sm:tracking-[0.16em] lg:min-h-9 lg:px-4 lg:text-[0.66rem]"
        } ${
          groupKey === item.key
            ? "border-cyan-300/58 bg-cyan-400/[0.12] text-cyan-50 shadow-[0_0_0_1px_rgba(103,232,249,0.14),0_6px_18px_rgba(34,211,238,0.08)]"
            : "border-white/7 bg-white/[0.045] text-white/62 hover:border-white/14 hover:bg-white/[0.08] hover:text-white/88"
        }`}
      >
        {item.label}
      </button>
    ));

  const renderDatasetButtons = (compact = false) =>
    currentDatasetTabs ? (
      currentDatasetTabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onDatasetChange(tab.key)}
          className={`min-w-0 rounded-full border uppercase transition ${
            compact
              ? "min-h-7 px-2 py-1 text-[0.48rem] tracking-[0.14em] sm:min-h-7 sm:px-2.5 sm:text-[0.54rem] sm:tracking-[0.16em]"
              : "min-h-7 px-1.5 py-1 text-[0.54rem] tracking-[0.08em] sm:min-h-8 sm:px-2.5 sm:text-[0.62rem] sm:tracking-[0.18em] lg:min-h-8 lg:px-2.5 lg:text-[0.58rem] lg:tracking-[0.16em]"
          } ${
            datasetKey === tab.key
              ? "border-emerald-300/45 bg-emerald-400/[0.1] text-emerald-100 shadow-[0_0_0_1px_rgba(110,231,183,0.12)]"
              : "border-white/7 bg-white/[0.035] text-white/56 hover:border-white/14 hover:bg-white/[0.06] hover:text-white/82"
          }`}
        >
          {tab.label}
        </button>
      ))
    ) : (
      <span className="text-[0.52rem] uppercase tracking-[0.16em] text-white/34 sm:text-[0.56rem]">
        {groupDisplayLabel} live
      </span>
    );

  return (
    <div className="space-y-5 sm:space-y-6">
      <div
        className={`fixed inset-x-0 z-40 px-6 transition-all duration-200 sm:px-10 lg:px-16 ${
          compactSticky
            ? `pointer-events-auto ${stickyTopClass} translate-y-0 scale-100 opacity-100`
            : `pointer-events-none ${stickyTopClass} -translate-y-3 scale-[0.985] opacity-0`
        }`}
      >
        <div className="mx-auto max-w-6xl rounded-[1.35rem] border border-cyan-300/14 bg-[linear-gradient(180deg,rgba(8,16,27,0.96),rgba(10,20,33,0.93))] px-3 py-2 shadow-[0_18px_48px_rgba(0,8,18,0.36)] backdrop-blur-xl sm:px-4 sm:py-3">
          <div className="hidden lg:flex lg:flex-col lg:gap-2.5">
            <div className="flex items-center gap-3">
              <div className="flex flex-nowrap gap-1.5">{renderGroupButtons(true)}</div>
              <div className="flex items-center gap-2 text-[0.5rem] uppercase tracking-[0.24em] text-white/30">
                <span>{groupDisplayLabel} / family</span>
                <div className="h-px w-14 bg-gradient-to-r from-emerald-300/28 to-transparent" />
              </div>
              <div className="flex min-w-0 flex-nowrap gap-1.5">{renderDatasetButtons(true)}</div>
            </div>
            <div className="grid items-center gap-2.5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)]">
              <div className="relative min-w-0">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cyan-300/90">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4.5 w-4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search token, pool, or address"
                  className="w-full rounded-full border border-cyan-300/14 bg-black/34 py-2.5 pl-10 pr-4 text-[0.92rem] text-white outline-none ring-2 ring-transparent focus:border-cyan-400/60 focus:ring-cyan-400/30"
                />
              </div>
              <PoolCombobox
                pools={filtered}
                value={selected?.poolId || ""}
                onChange={handleComboboxChange}
                accent="cyan"
                placeholder="Select pool"
                className="w-full"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 lg:hidden">
            <div className="grid grid-cols-4 gap-1.5">{renderGroupButtons(true)}</div>
            <div
              className="grid gap-1.5"
              style={{
                gridTemplateColumns: currentDatasetTabs
                  ? `repeat(${currentDatasetTabs.length}, minmax(0, 1fr))`
                  : "minmax(0,1fr)",
              }}
            >
              {renderDatasetButtons(true)}
            </div>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(240px,0.9fr)]">
              <div className="relative min-w-0">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-cyan-300/90">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4.5 w-4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search token, pool, or address"
                  className="w-full rounded-full border border-cyan-300/14 bg-black/34 py-2.5 pl-10 pr-4 text-[0.9rem] text-white outline-none ring-2 ring-transparent focus:border-cyan-400/60 focus:ring-cyan-400/30"
                />
              </div>
              <PoolCombobox
                pools={filtered}
                value={selected?.poolId || ""}
                onChange={handleComboboxChange}
                accent="cyan"
                placeholder="Select pool"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </div>

      <div
        id="pool-search"
        className="scroll-mt-36 relative overflow-hidden flex flex-col gap-4 rounded-[2rem] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(18,31,49,0.88),rgba(12,21,34,0.82))] p-4 shadow-[0_18px_60px_rgba(0,18,38,0.16)] sm:p-5 lg:p-6"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(80,170,255,0.08),transparent_22%),radial-gradient(circle_at_10%_100%,rgba(40,120,220,0.06),transparent_28%)]" />
        <div className="relative rounded-[1.5rem] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(10,20,33,0.72),rgba(10,18,30,0.38))] p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="text-[0.78rem] uppercase tracking-[0.34em] text-cyan-100/78">
                Pool Inteligence
              </div>
              <div className="text-[0.72rem] uppercase tracking-[0.3em] text-white/56">
                Dataset Controls
              </div>
              <div className="max-w-3xl text-sm leading-6 text-white/58">
                Select the venue first. Pool family stays fixed beneath it so
                dataset switching never shifts the explorer layout.
              </div>
            </div>

            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
              <div className="grid grid-cols-4 gap-1.5 sm:gap-2 lg:flex lg:flex-nowrap lg:gap-2">
                {renderGroupButtons()}
              </div>

              <div className="hidden min-w-0 lg:flex lg:flex-1 lg:items-center lg:justify-end lg:gap-2">
                {currentDatasetTabs ? (
                  <>
                    <span className="shrink-0 text-[0.54rem] uppercase tracking-[0.28em] text-white/32">
                      {groupDisplayLabel} / pool family
                    </span>
                    <div className="h-px min-w-10 flex-1 bg-gradient-to-r from-emerald-300/24 via-white/10 to-transparent" />
                    <div className="flex flex-nowrap gap-1.5">{renderDatasetButtons()}</div>
                  </>
                ) : (
                  <span className="text-[0.58rem] uppercase tracking-[0.18em] text-white/34">
                    {groupDisplayLabel} uses a single live dataset.
                  </span>
                )}
              </div>
            </div>

            <div className="min-h-[4.5rem] rounded-[1.1rem] border border-white/7 bg-white/[0.02] px-3 py-2.5 sm:min-h-[4.6rem] lg:hidden">
              {currentDatasetTabs ? (
                <div className="flex h-full flex-col justify-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.54rem] uppercase tracking-[0.28em] text-white/32">
                      {groupDisplayLabel} / pool family
                    </span>
                    <div className="h-px flex-1 bg-gradient-to-r from-emerald-300/24 via-white/10 to-transparent" />
                  </div>
                  <div
                    className="grid gap-1.5"
                    style={{
                      gridTemplateColumns: `repeat(${currentDatasetTabs.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {renderDatasetButtons()}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center text-[0.58rem] uppercase tracking-[0.18em] text-white/34 sm:text-[0.62rem]">
                  <span>{groupDisplayLabel} uses a single live dataset.</span>
                </div>
              )}
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            <div className="flex flex-col gap-1.5">
              <div className="text-xs uppercase tracking-[0.26em] text-white/60">
                Explorer Search
              </div>
            </div>

            <div
              ref={searchRowRef}
              className="grid gap-3 xl:grid-cols-[minmax(0,1.22fr)_minmax(420px,0.78fr)]"
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-cyan-300/88">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search token, pool, or address"
                  className="w-full rounded-full border border-cyan-300/18 bg-black/34 pl-12 pr-5 py-3.5 text-[1rem] text-white outline-none ring-2 ring-transparent focus:border-cyan-400/60 focus:ring-cyan-400/30 sm:py-4 sm:text-[1.04rem]"
                />
              </div>
              <div className="min-w-0">
                <PoolCombobox
                  pools={filtered}
                  value={selected?.poolId || ""}
                  onChange={handleComboboxChange}
                  accent="cyan"
                  placeholder="Select pool"
                  className="w-full"
                />
              </div>
            </div>

            <div className="grid gap-x-4 gap-y-1 text-[0.66rem] uppercase tracking-[0.16em] text-white/46 sm:flex sm:flex-wrap sm:items-center sm:text-[0.72rem] sm:tracking-[0.18em]">
              <span className="hidden text-cyan-100/78 sm:inline">Dataset-first mode</span>
              <span className="hidden text-white/20 sm:inline">/</span>
              <span>{groupDisplayLabel}</span>
              <span className="hidden text-white/20 sm:inline">/</span>
              <span>Dataset: {datasetDisplayLabel}</span>
              <span className="hidden text-white/20 sm:inline">/</span>
              {usingSearch ? (
                <span>{searching ? "Searching pools" : `${filtered.length} matches`}</span>
              ) : (
                <span>Type to filter results</span>
              )}
            </div>
          </div>
        </div>

        <div className="relative rounded-[1.5rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.5),rgba(8,14,26,0.28))] px-4 py-3 sm:px-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="text-[0.68rem] uppercase tracking-[0.26em] text-white/52 sm:text-[0.72rem]">
                Signal Coverage
              </div>
              <div className="mt-1 text-[1.02rem] font-medium text-white/86">
                {signalCoverage.label}
              </div>
              <div className="mt-1 text-xs text-white/56">
                Stored volatility in payloads from{" "}
                <span className="text-white/78">
                  {signalCoverage.storedVolatilityStartedAt}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-2 lg:items-end">
              <span
                className={`inline-flex w-fit rounded-full px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.2em] ${
                  signalCoverage.exactImpact === "active"
                    ? "border border-emerald-300/24 bg-emerald-500/12 text-emerald-100"
                    : "border border-amber-300/24 bg-amber-500/12 text-amber-100"
                }`}
              >
                {signalCoverage.exactImpactLabel}
              </span>
              <div className="max-w-[34rem] text-xs leading-5 text-white/50 lg:text-right">
                {signalCoverage.note}
              </div>
            </div>
          </div>
        </div>

        <div className="relative border-t border-white/8 pt-3 sm:pt-4">
          {loading ? (
            <div className="flex min-h-[120px] flex-col items-center justify-center gap-3 text-center transition-all duration-300 ease-out">
              <div className="relative h-10 w-10">
                <div className="absolute inset-0 rounded-full border border-cyan-300/14" />
                <div className="absolute inset-0 animate-spin rounded-full border-2 border-cyan-300/70 border-t-transparent" />
              </div>
              <div className="text-[0.72rem] uppercase tracking-[0.28em] text-cyan-100/82">
                Refreshing dataset
              </div>
              <div className="max-w-2xl text-sm text-white/54">
                Loading the next pool universe into the explorer surface.
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 text-[0.58rem] uppercase tracking-[0.18em] text-white/46 sm:text-[0.62rem]">
                {logs.slice(0, 3).map((line, idx) => (
                  <span
                    key={`${line}-${idx}`}
                    className="rounded-full border border-white/8 bg-white/[0.03] px-2.5 py-1"
                  >
                    {line.replace(/^\[TRAXR-SOLANA\]\s*/, "")}
                  </span>
                ))}
              </div>
            </div>
          ) : pools.length > 0 ? (
            <div className="transition-all duration-300 ease-out">
              <RollingStats
                pools={pools}
                totalCount={totalPools}
                summary={datasetSummary}
                snapshotIso={datasetSummary?.snapshotIso ?? undefined}
                compact
              />
            </div>
          ) : (
            <div className="flex min-h-[150px] flex-col items-center justify-center gap-3 text-center text-white/58">
              <div className="text-[0.72rem] uppercase tracking-[0.28em] text-white/44">
                No snapshot loaded
              </div>
              <div className="max-w-xl text-sm">
                Run `npm run fetch:solana` to refresh local cache and load
                pools into the explorer surface.
              </div>
            </div>
          )}
        </div>
      </div>

      {loading ? null : selected ? (
        <>
          <div id="traxr-selected-card">
            <TraxrPoolCard
              pool={selected}
              datasetSummary={datasetSummary}
              onCompare={() => setCompareOpen(true)}
              onTrend={() => setTrendOpen(true)}
            />
          </div>
          <TraxrConsole pool={selected} />
          <TraxrTrustMap pools={filtered} selected={selected} onSelect={handleSelect} />
          <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/90 shadow-[0_0_30px_rgba(0,0,0,0.35)]">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.26em] text-white/60">
                  Liquidity across pools
                </div>
                <div className="text-sm text-white/60">
                  Top pools by estimated liquidity (current view)
                </div>
              </div>
            </div>
            <TraxrLiquidityChart pools={filtered} />
          </div>
        </>
      ) : (
        <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-white/70">
          No pools available in TRAXR-SOLANA cache.
        </div>
      )}

      <TraxrCompareModal
        open={compareOpen}
        pools={filtered}
        initialLeftId={selected?.poolId}
        datasetKey={datasetKey}
        onClose={() => setCompareOpen(false)}
      />
      <TraxrTrendModal
        open={trendOpen}
        pool={selected}
        datasetKey={datasetKey}
        onClose={() => setTrendOpen(false)}
      />
    </div>
  );
}
