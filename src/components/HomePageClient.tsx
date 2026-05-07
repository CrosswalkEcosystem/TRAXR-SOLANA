"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SiteFooter from "@/components/SiteFooter";
import { TraxrDashboard } from "@/components/TraxrDashboard";
import dynamic from "next/dynamic";
import { TraxrScoreResult } from "@/lib/types";

const TraxrHeroLabGraph = dynamic(
  () => import("@/components/TraxrTrajectoryLab").then((m) => m.TraxrTrajectoryLab),
  {
    ssr: false,
    loading: () => (
      <div className="h-[210px] opacity-70 sm:h-[250px] lg:h-[320px]" />
    ),
  },
);

const featureEnabled =
  (process.env.NEXT_PUBLIC_TRAXR_ENABLED ?? "true") === "true";
const HERO_WORDS = ["Depth", "Stability", "Risk"] as const;
const INITIAL_DATASET_LIMIT = 400;
const LOAD_MORE_LIMIT = 800;

type HomeDatasetKey =
  | "amm"
  | "clmm"
  | "cpmm"
  | "other"
  | "orca"
  | "pumpswap"
  | "meteora"
  | "meteora-dammv2";

const DATASET_DISPLAY_LABEL: Record<HomeDatasetKey, string> = {
  amm: "Raydium AMM",
  clmm: "Raydium CLMM",
  cpmm: "Raydium CPMM",
  other: "Raydium Others",
  orca: "Orca",
  pumpswap: "PumpSwap",
  meteora: "Meteora DLMM",
  "meteora-dammv2": "Meteora DAMM v2",
};

export default function HomePageClient() {
  const [pools, setPools] = useState<TraxrScoreResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalPools, setTotalPools] = useState(0);
  const [summary, setSummary] = useState<{
    totalLiquidityUsd: number;
    totalVolume24hUsd: number;
    elevatedPools: number;
    warningPools: number;
    programs: number;
    medianScore: number;
    hasVolume24h: boolean;
    hasVolume7d: boolean;
    hasPriceRange24h: boolean;
    hasFeeApr24h: boolean;
    hasFeeApr7d: boolean;
    snapshotIso?: string | null;
  } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [groupKey, setGroupKey] = useState<
    "raydium" | "orca" | "meteora" | "pumpswap"
  >("raydium");
  const [datasetKey, setDatasetKey] = useState<HomeDatasetKey>("amm");
  const [heroWordIndex, setHeroWordIndex] = useState(0);
  const [heroGraphWordIndex, setHeroGraphWordIndex] = useState(0);
  const [heroWordVisible, setHeroWordVisible] = useState(true);
  const [showHeroArrow, setShowHeroArrow] = useState(true);
  const contentSectionRef = useRef<HTMLElement | null>(null);
  const currentHeroWord = HERO_WORDS[heroWordIndex];
  const currentHeroGraphWord = HERO_WORDS[heroGraphWordIndex];

  const beginDatasetTransition = useCallback((nextDataset: HomeDatasetKey) => {
    setLoading(true);
    setPools([]);
    setTotalPools(0);
    setSummary(null);
    setError(null);
    setLogs([
      `[TRAXR-SOLANA] Loading ${DATASET_DISPLAY_LABEL[nextDataset]} pools...`,
      "[TRAXR-SOLANA] Normalizing pools...",
      "[TRAXR-SOLANA] Scoring pools...",
    ]);
    setDatasetKey(nextDataset);
  }, []);

  const handleDatasetChange = useCallback(
    (nextDataset: HomeDatasetKey) => {
      if (nextDataset === datasetKey) return;
      beginDatasetTransition(nextDataset);
    },
    [beginDatasetTransition, datasetKey],
  );

  const handleGroupChange = useCallback(
    (nextGroup: "raydium" | "orca" | "meteora" | "pumpswap") => {
      if (nextGroup === groupKey) return;
      setGroupKey(nextGroup);
      if (nextGroup === "orca") {
        beginDatasetTransition("orca");
        return;
      }
      if (nextGroup === "pumpswap") {
        beginDatasetTransition("pumpswap");
        return;
      }
      if (nextGroup === "meteora") {
        beginDatasetTransition("meteora");
        return;
      }
      beginDatasetTransition("amm");
    },
    [beginDatasetTransition, groupKey],
  );

  useEffect(() => {
    let isMounted = true;

    async function loadPools() {
      setLoading(true);
      setPools([]);
      setTotalPools(0);
      setSummary(null);
      setError(null);
      setLogs([
        `[TRAXR-SOLANA] Loading ${DATASET_DISPLAY_LABEL[datasetKey]} pools...`,
        "[TRAXR-SOLANA] Normalizing pools...",
        "[TRAXR-SOLANA] Scoring pools...",
      ]);

      try {
        const res = await fetch(
          `/api/traxr/dataset?name=${datasetKey}&limit=${INITIAL_DATASET_LIMIT}&offset=0&summary=true`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const payload = typeof json === "object" && json ? json : {};
        const nextPools = Array.isArray(payload.pools) ? payload.pools : [];
        const total =
          typeof payload.total === "number"
            ? payload.total
            : nextPools.length;
        const nextSummary =
          typeof payload.summary === "object" && payload.summary
            ? payload.summary
            : null;
        const snapshotIso =
          typeof payload.snapshotIso === "string"
            ? payload.snapshotIso
            : nextSummary?.snapshotIso ?? null;

        if (!isMounted) return;
        setPools(nextPools);
        setTotalPools(total);
        setSummary(
          nextSummary
            ? { ...nextSummary, snapshotIso }
            : snapshotIso
              ? {
                  totalLiquidityUsd: 0,
                  totalVolume24hUsd: 0,
                  elevatedPools: 0,
                  warningPools: 0,
                  programs: 0,
                  medianScore: 0,
                  hasVolume24h: false,
                  hasVolume7d: false,
                  hasPriceRange24h: false,
                  hasFeeApr24h: false,
                  hasFeeApr7d: false,
                  snapshotIso,
                }
              : null,
        );
        setLogs((prev) => [
          ...prev,
          `[TRAXR-SOLANA] Loaded ${nextPools.length} pools`,
        ]);
      } catch (e: unknown) {
        if (!isMounted) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message || "Failed to load pools");
        setLogs((prev) => [...prev, `[TRAXR-SOLANA] Error: ${message}`]);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadPools();
    return () => {
      isMounted = false;
    };
  }, [datasetKey]);

  useEffect(() => {
    let fadeTimeout: ReturnType<typeof setTimeout> | null = null;
    let stepTimeout: ReturnType<typeof setTimeout> | null = null;
    let syncTimeout: ReturnType<typeof setTimeout> | null = null;
    let current = 0;
    const holdExtensionMs = 3000;
    const fadeLeadMs = 1000;

    const runCycle = () => {
      fadeTimeout = setTimeout(() => {
        setHeroWordVisible(false);
      }, 5200 + holdExtensionMs - fadeLeadMs);
      stepTimeout = setTimeout(() => {
        const nextIndex = (current + 1) % HERO_WORDS.length;
        current = nextIndex;
        setHeroGraphWordIndex(nextIndex);
        syncTimeout = setTimeout(() => {
          setHeroWordIndex(nextIndex);
          setHeroWordVisible(true);
        }, 760);
        runCycle();
      }, 5200 + holdExtensionMs);
    };

    runCycle();
    return () => {
      if (fadeTimeout) clearTimeout(fadeTimeout);
      if (stepTimeout) clearTimeout(stepTimeout);
      if (syncTimeout) clearTimeout(syncTimeout);
    };
  }, []);

  useEffect(() => {
    const updateArrow = () => {
      const contentTop =
        contentSectionRef.current?.getBoundingClientRect().top ??
        Number.POSITIVE_INFINITY;
      setShowHeroArrow(contentTop > window.innerHeight);
    };
    updateArrow();
    window.addEventListener("scroll", updateArrow, { passive: true });
    window.addEventListener("resize", updateArrow);
    return () => {
      window.removeEventListener("scroll", updateArrow);
      window.removeEventListener("resize", updateArrow);
    };
  }, []);

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    const nextOffset = pools.length;
    try {
      const res = await fetch(
        `/api/traxr/dataset?name=${datasetKey}&limit=${LOAD_MORE_LIMIT}&offset=${nextOffset}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const payload = typeof json === "object" && json ? json : {};
      const nextPools = Array.isArray(payload.pools) ? payload.pools : [];
      setPools((prev) => [...prev, ...nextPools]);
    } catch {}
    setLoadingMore(false);
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-6 py-7 sm:px-10 sm:py-8 lg:px-16">
      <div className="pointer-events-none absolute inset-0 gridlines opacity-34" />

      <div className="relative mx-auto flex max-w-6xl flex-col text-white">
        <section className="relative flex min-h-[100svh] items-center overflow-hidden px-1 py-2 sm:py-4 lg:items-center lg:pt-1.5 lg:pb-2">
          <div className="relative w-full -translate-y-[11svh] lg:grid lg:min-h-[360px] lg:translate-y-0 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center lg:gap-8">
            <div className="relative z-10 flex w-full max-w-4xl flex-col items-center gap-5 px-2 text-center text-white/84 sm:px-3 lg:w-full lg:max-w-none lg:-translate-y-8 lg:items-start lg:px-0 lg:text-left">
              <h1 className="max-w-4xl text-[clamp(2.5rem,10.4vw,4.7rem)] font-bold leading-[0.94] tracking-[0.001em] text-white">
                See pool <span className="text-cyan-300">risk</span> first
              </h1>
              <p className="max-w-3xl pt-1 text-[clamp(1.18rem,2.45vw,1.98rem)] leading-[1.36] text-white/72">
                Know the risk before you trade.
              </p>
              <p className="pt-2 text-[0.78rem] tracking-[0.12em] text-cyan-300/90">
                Know Your Pool.
              </p>
            </div>
            <div className="relative mx-auto mt-3 h-[220px] w-full max-w-[640px] sm:h-[270px] lg:mt-0 lg:h-[360px] lg:w-full lg:max-w-none lg:-translate-y-8">
              <TraxrHeroLabGraph
                preview
                heroShowcase
                heroKeyword={currentHeroGraphWord}
              />
              <div className="pointer-events-none mt-4 text-center text-[0.88rem] uppercase tracking-[0.16em] lg:absolute lg:right-6 lg:top-3 lg:mt-0 lg:text-right lg:text-[1.32rem] lg:tracking-[0.2em]">
                <div
                  className={`text-white/55 transition-opacity duration-500 ${
                    heroWordVisible ? "opacity-100" : "opacity-0"
                  }`}
                >
                  {currentHeroWord}
                </div>
                <div className="mt-0.5 text-[0.5em] tracking-[0.12em] text-white/46 lg:mt-1 lg:text-[0.52em] lg:tracking-[0.14em]">
                  Measured on-chain
                </div>
              </div>
            </div>
          </div>
          <div
            className={`pointer-events-none fixed bottom-4 left-1/2 z-30 -translate-x-1/2 transition-opacity duration-300 sm:bottom-6 ${
              showHeroArrow ? "opacity-100" : "opacity-0"
            }`}
          >
            <span
              className="block text-[1.15rem] leading-none text-white/70"
              style={{ animation: "heroArrowFloat 2.4s ease-in-out infinite" }}
            >
              ˅
            </span>
          </div>
        </section>

        <section
          ref={contentSectionRef}
          className="relative z-10 flex flex-col gap-3 pb-2 sm:gap-4"
        >
          {error && !loading ? (
            <div className="rounded-3xl border border-red-500/40 bg-red-500/10 p-6 text-red-100">
              Failed to load pools: {error}
            </div>
          ) : null}
          {featureEnabled ? (
            <>
              <TraxrDashboard
                pools={pools}
                groupKey={groupKey}
                onGroupChange={handleGroupChange}
                datasetKey={datasetKey}
                onDatasetChange={handleDatasetChange}
                totalPools={totalPools}
                datasetSummary={summary ?? undefined}
                loading={loading}
                logs={logs}
              />
              {!loading && !error && totalPools > pools.length && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    className="mt-2 rounded-full border border-cyan-300/40 bg-cyan-500/10 px-5 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    {loadingMore ? "Loading more..." : "Load more pools"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-white/70">
              TRAXR-SOLANA is disabled by flag.
            </div>
          )}

          <SiteFooter />
        </section>
      </div>
      <style jsx>{`
        @keyframes heroArrowFloat {
          0%,
          100% {
            transform: translateY(0);
            opacity: 0.42;
            text-shadow: 0 0 7px rgba(125, 211, 252, 0.24);
          }
          50% {
            transform: translateY(5px);
            opacity: 0.72;
            text-shadow: 0 0 11px rgba(125, 211, 252, 0.36);
          }
        }
      `}</style>
    </main>
  );
}
