"use client";

import { TraxrScoreResult } from "@/lib/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { TraxrRadarGraph } from "./TraxrRadarGraph";

type Props = {
  pools: TraxrScoreResult[];
  selected?: TraxrScoreResult | null;
  onSelect?: (pool: TraxrScoreResult) => void;
};

export function TraxrTrustGraphHero({ pools }: { pools: TraxrScoreResult[] }) {
  return (
    <div className="relative h-full overflow-visible">
      <div className="pointer-events-none absolute -inset-x-10 -inset-y-8 bg-[radial-gradient(82%_88%_at_70%_52%,rgba(56,189,248,0.16),rgba(30,58,95,0.08)_44%,rgba(7,13,23,0)_78%)] opacity-80 blur-[1px]" />
      <div
        className="relative h-full"
        style={{
          maskImage:
            "radial-gradient(132% 100% at 70% 52%, black 50%, rgba(0,0,0,0.62) 73%, transparent 100%), linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 11%, black 22%, black 100%)",
          WebkitMaskImage:
            "radial-gradient(132% 100% at 70% 52%, black 50%, rgba(0,0,0,0.62) 73%, transparent 100%), linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.5) 11%, black 22%, black 100%)",
        }}
      >
        <TierGraph pools={pools} mode="hero" />
      </div>
    </div>
  );
}

// TRAXR trust map groups pools strictly by CTS tier; no redistribution.
export function TraxrTrustMap({ pools, selected, onSelect }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const tiers = Array.from({ length: 6 }, (_, i) => i + 1);

  const uniquePools = useMemo(
    () => Array.from(new Map(pools.map((p) => [p.poolId, p])).values()),
    [pools],
  );

  const byTier = useMemo(() => {
    const map = new Map<number, TraxrScoreResult[]>();
    tiers.forEach((t) => map.set(t, []));
    uniquePools.forEach((pool) => {
      const tier = Math.max(1, Math.min(6, pool.ctsNodes || Math.round(pool.score / 20)));
      const list = map.get(tier) || [];
      list.push(pool);
      map.set(tier, list);
    });
    return map;
  }, [uniquePools, tiers]);

  const hero = selected || uniquePools[0];
  const getTierItems = (tier: number, limit?: number) => {
    const arr = [...(byTier.get(tier) || [])].sort(
      (a, b) =>
        (b.metrics?.liquidityUsd ?? 0) - (a.metrics?.liquidityUsd ?? 0) ||
        (b.score ?? 0) - (a.score ?? 0),
    );
    return typeof limit === "number" ? arr.slice(0, limit) : arr;
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#0b1220] via-[#0f1b2d] to-[#0f172a] p-4 sm:p-5 lg:p-6 shadow-[0_0_60px_rgba(0,255,255,0.08)] overflow-hidden">
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-cyan-200/70">Trust Map</div>
            <div className="text-sm text-white/70">CTS tiering across Solana pools</div>
          </div>
          <div className="text-xs text-white/60">Top by tier - max 4 each</div>
        </div>
        {hero ? (
          <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/30 p-4 shadow-[0_0_24px_rgba(0,0,0,0.35)] lg:flex-row lg:items-center lg:gap-6">
            <div className="flex-1 space-y-2">
              <div className="text-xs uppercase tracking-[0.24em] text-white/60">Selected pool</div>
              <div className="min-w-0 text-lg font-semibold text-white truncate">
                {poolLabel(hero)}
              </div>
              <div className="flex flex-wrap gap-3 text-xs sm:text-sm text-white/70">
                <span>Score {Math.round(hero.score)}</span>
                <span>
                  24h Vol {" "}
                  {typeof hero.metrics?.volume24hUsd === "number"
                    ? `${hero.metrics.volume24hUsd.toLocaleString("en-US", {
                        maximumFractionDigits: 0,
                      })} USD`
                    : "N/A"}
                </span>
                <span>
                  Liq {" "}
                  {(hero.metrics?.liquidityUsd ?? 0).toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })}{" "}
                  USD
                </span>
              </div>
              <div className="text-[11px] text-white/50">
                Updated {hero.updatedAt ? new Date(hero.updatedAt).toLocaleString() : "n/a"}
              </div>
              <div className="mt-2 text-[11px] text-white/60 leading-relaxed">
                Legend: center number = TRAXR score; vertices = CTS nodes (depth, activity, impact, stability, trust, fee).
              </div>
            </div>
            <div className="flex-1">
              <TraxrRadarGraph nodes={hero.nodes} score={hero.score} size={240} />
            </div>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiers.map((tier) => {
          const items = getTierItems(tier, 4);
          const bg =
            tier >= 5
              ? "border-emerald-400/50"
              : tier >= 3
              ? "border-amber-400/40"
              : "border-red-400/40";
          return (
            <div
              key={tier}
              className={`rounded-2xl border ${bg} bg-white/5 p-3 backdrop-blur overflow-hidden w-full`}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs uppercase tracking-[0.26em] text-white/60">CTS {tier}</div>
                <div className="text-[11px] text-white/40">{items.length ? "Active" : "Empty"}</div>
              </div>
              <div className="space-y-1">
                {items.length === 0 ? (
                  <div className="text-sm text-white/40">No pools in tier</div>
                ) : (
                  items.map((pool, idx) => {
                    const m: any = pool.metrics || {};
                    const liq = m.liquidityUsd ?? 0;
                    const nameA = tokenDisplay({
                      mint: m.mintA,
                      tokenName: m.tokenAName || pool.tokenAName,
                      tokenSymbol: m.tokenASymbol || pool.tokenASymbol,
                      tokenAddress: m.mintA,
                    });
                    const nameB = tokenDisplay({
                      mint: m.mintB,
                      tokenName: m.tokenBName || pool.tokenBName,
                      tokenSymbol: m.tokenBSymbol || pool.tokenBSymbol,
                      tokenAddress: m.mintB,
                    });
                    const key = pool.poolId || `${tier}-${m.mintA || "A"}-${m.mintB || "B"}-${idx}`;
                    return (
                      <div
                        key={key}
                        className="flex w-full cursor-pointer items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-sm text-white transition hover:bg-white/10"
                        onClick={() => {
                          onSelect?.(pool);
                          document
                            .getElementById("traxr-selected-card")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        <span className="flex-1 min-w-0 max-w-[70%] truncate text-white/80">
                          {nameB ? `${nameA}/${nameB}` : nameA}
                        </span>
                        <span className="shrink-0 text-white/60">
                          Liq {liq.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end gap-3">
        <button
          onClick={() => setShowModal(true)}
          className="rounded-full border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 shadow-[0_0_14px_rgba(0,255,255,0.25)] hover:border-cyan-300 hover:text-white transition"
        >
          Show more
        </button>
        <button
          onClick={() => setShowGraph(true)}
          className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100 shadow-[0_0_14px_rgba(0,255,180,0.25)] hover:border-emerald-300 hover:text-white transition"
        >
          TrustGRAPH
        </button>
      </div>
      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
          <div className="relative max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-[#0b1220] p-4 shadow-[0_0_40px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.26em] text-cyan-200/70">
                  All pools by CTS tier
                </div>
                <div className="text-sm text-white/60">Scrollable view and click to select</div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <div className="flex max-h-[70vh] gap-3 overflow-x-auto overflow-y-hidden pr-2">
              {tiers.map((tier) => {
                const items = getTierItems(tier);
                return (
                  <div
                    key={`modal-${tier}`}
                    className="flex min-w-[220px] max-w-[260px] flex-col rounded-2xl border border-white/10 bg-white/5"
                  >
                    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-[#0b1220]/80 px-3 py-2 backdrop-blur">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <img
                          src={`/images/cts${tier}.png`}
                          alt={`CTS ${tier}`}
                          className="h-6 w-6 object-contain"
                        />
                        CTS {tier}
                      </div>
                      <div className="text-[11px] text-white/50">{items.length} pools</div>
                    </div>
                    <div className="flex-1 space-y-2 overflow-y-auto px-3 py-2">
                      {items.map((pool, idx) => {
                        const m: any = pool.metrics || {};
                        const nameA = tokenDisplay({
                          mint: m.mintA,
                          tokenName: m.tokenAName || pool.tokenAName,
                          tokenSymbol: m.tokenASymbol || pool.tokenASymbol,
                          tokenAddress: m.mintA,
                        });
                        const nameB = tokenDisplay({
                          mint: m.mintB,
                          tokenName: m.tokenBName || pool.tokenBName,
                          tokenSymbol: m.tokenBSymbol || pool.tokenBSymbol,
                          tokenAddress: m.mintB,
                        });
                        const liq = m.liquidityUsd ?? 0;
                        return (
                          <div
                            key={`${pool.poolId || idx}-modal`}
                            className="rounded-xl bg-black/30 p-2 text-xs text-white/80 transition hover:bg-white/10 cursor-pointer"
                            onClick={() => {
                              onSelect?.(pool);
                              setShowModal(false);
                              setTimeout(() => {
                                document
                                  .getElementById("traxr-selected-card")
                                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
                              }, 50);
                            }}
                          >
                            <div className="flex flex-col gap-1">
                              <span className="truncate pr-2">{nameB ? `${nameA}/${nameB}` : nameA}</span>
                              <span className="shrink-0 text-white/60">
                                Liq {liq.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
      {showGraph ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur">
          <div className="relative max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-3xl border border-white/10 bg-[#0b1220] p-4 shadow-[0_0_40px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.26em] text-emerald-200/70">
                  TrustGRAPH - pools mapped by CTS tier
                </div>
                <div className="text-sm text-white/60">Size = liquidity | Y = score | X = CTS tier</div>
              </div>
              <button
                onClick={() => setShowGraph(false)}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <div className="max-h-[75vh] overflow-auto rounded-2xl border border-white/10 bg-black/20 p-4">
              <TierGraph pools={uniquePools} />
            </div>
          </div>
        </div>
      ) : null}
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

function poolLabel(p: TraxrScoreResult) {
  const m: any = p.metrics || {};
  const tokA = tokenDisplay({
    mint: m.mintA,
    tokenName: m.tokenAName || p.tokenAName,
    tokenSymbol: m.tokenASymbol || p.tokenASymbol,
    tokenAddress: m.mintA,
  }) || "Unknown";
  const tokB = tokenDisplay({
    mint: m.mintB,
    tokenName: m.tokenBName || p.tokenBName,
    tokenSymbol: m.tokenBSymbol || p.tokenBSymbol,
    tokenAddress: m.mintB,
  });
  return tokB ? `${tokA} / ${tokB}` : tokA;
}

function TierGraph({
  pools,
  mode = "interactive",
}: {
  pools: TraxrScoreResult[];
  mode?: "interactive" | "hero";
}) {
  const heroMode = mode === "hero";
  const hasPools = pools.length > 0;
  const [hovered, setHovered] = useState<{
    label: string;
    lines: string[];
    sx: number;
    sy: number;
  } | null>(null);
  const [showLegendInfo, setShowLegendInfo] = useState(false);
  const [yaw, setYaw] = useState(-0.62);
  const [pitch, setPitch] = useState(0.26);
  const [zoom, setZoom] = useState(heroMode ? 0.96 : 1);
  const [zMetric, setZMetric] = useState<"liquidity" | "volume24h" | "impact">(
    "liquidity",
  );
  const [staticHero, setStaticHero] = useState(false);
  const [animPhase, setAnimPhase] = useState(0);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startYaw: 0,
    startPitch: 0,
  });
  const frameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ dx: number; dy: number } | null>(null);
  const width = heroMode ? 980 : 1100;
  const height = heroMode ? 430 : 640;
  const padding = { left: 70, right: 55, top: 60, bottom: 80 };
  const maxScore = 100;
  const maxLiq = Math.max(...pools.map((p) => p.metrics?.liquidityUsd ?? 0), 1);
  const maxVol = Math.max(...pools.map((p) => p.metrics?.volume24hUsd ?? 0), 1);
  const maxImpact = Math.max(...pools.map((p) => p.metrics?.priceImpactPct ?? 0), 0.1);

  const project = (xNorm: number, yNorm: number, zNorm: number) => {
    const centerX = width * 0.5;
    const centerY = height * 0.6;
    const spanScale = 0.7 + zoom * 0.45;
    const x = (xNorm - 0.5) * (width * 0.56) * spanScale;
    const y = (yNorm - 0.5) * (height * 0.52) * spanScale;
    const z = (zNorm - 0.5) * 360 * spanScale;

    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);

    const xYaw = x * cosYaw + z * sinYaw;
    const zYaw = -x * sinYaw + z * cosYaw;
    const yPitch = y * cosPitch - zYaw * sinPitch;
    const zPitch = y * sinPitch + zYaw * cosPitch;

    const perspective = 980;
    const scale = perspective / Math.max(240, perspective - zPitch);

    return {
      x: centerX + xYaw * scale,
      y: centerY - yPitch * scale,
      depth: zPitch,
      scale,
    };
  };

  const renderPools = heroMode ? pools.slice(0, 180) : pools;
  const points = renderPools.map((p) => {
    const tier = Math.max(1, Math.min(6, p.ctsNodes || Math.round(p.score / 20)));
    const score = p.score ?? 0;
    const liq = p.metrics?.liquidityUsd ?? 0;
    const vol = p.metrics?.volume24hUsd ?? 0;
    const impact = p.metrics?.priceImpactPct ?? 0;
    const zValue =
      zMetric === "liquidity"
        ? liq
        : zMetric === "volume24h"
          ? vol
          : impact;
    const zMax =
      zMetric === "liquidity"
        ? maxLiq
        : zMetric === "volume24h"
          ? maxVol
          : maxImpact;
    const size = Math.max(5, (Math.log10(liq + 1) / Math.log10(maxLiq + 1)) * 22);
    const projected = project((tier - 1) / 5, score / maxScore, zValue / zMax);
    const tierColor =
      tier >= 5
        ? "rgba(52,211,153,0.95)"
        : tier >= 3
          ? "rgba(251,191,36,0.92)"
          : "rgba(248,113,113,0.92)";
    return {
      x: projected.x,
      y: projected.y,
      depth: projected.depth,
      tier,
      score,
      size: size * projected.scale * 0.74,
      label: poolLabel(p),
      liq,
      vol,
      impact,
      color: tierColor,
    };
  }).sort((a, b) => a.depth - b.depth);

  useEffect(() => {
    if (!heroMode) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const lowCpu = (navigator.hardwareConcurrency || 8) <= 4;
    const lowMem =
      typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number" &&
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8) <= 4;
    const update = () => {
      setStaticHero(motion.matches || (lowCpu && lowMem));
    };
    update();
    motion.addEventListener("change", update);
    return () => {
      motion.removeEventListener("change", update);
    };
  }, [heroMode]);

  useEffect(() => {
    if (!heroMode || staticHero) return;
    let raf = 0;
    const started = performance.now();
    const tick = (ts: number) => {
      const t = (ts - started) / 1000;
      setAnimPhase(t);
      setYaw(-0.62 + t * 0.03);
      setPitch(0.26 + Math.sin(t * 0.18) * 0.06);
      setZoom(0.96 + Math.sin(t * 0.24) * 0.04);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [heroMode, staticHero]);

  const tiers = Array.from({ length: 6 }, (_, i) => i + 1);
  const gridYLevels = [0, 25, 50, 75, 100];
  const gridZLevels = [0, 0.33, 0.66, 1];

  const gridLines = useMemo(() => {
    const lines: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = [];
    for (const score of gridYLevels) {
      const yNorm = score / maxScore;
      for (let i = 0; i < tiers.length - 1; i += 1) {
        const a = project(i / 5, yNorm, 0);
        const b = project((i + 1) / 5, yNorm, 0);
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `front-y-${score}-${i}` });
        const c = project(i / 5, yNorm, 1);
        const d = project((i + 1) / 5, yNorm, 1);
        lines.push({ x1: c.x, y1: c.y, x2: d.x, y2: d.y, key: `back-y-${score}-${i}` });
      }
    }
    for (const zNorm of gridZLevels) {
      for (let i = 0; i < tiers.length - 1; i += 1) {
        const a = project(i / 5, 0, zNorm);
        const b = project((i + 1) / 5, 0, zNorm);
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `floor-z-${zNorm}-${i}` });
      }
      for (const score of [0, 0.5, 1]) {
        const a = project(0, score, zNorm);
        const b = project(1, score, zNorm);
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `span-z-${zNorm}-${score}` });
      }
    }
    for (const tier of tiers) {
      const xNorm = (tier - 1) / 5;
      for (const zNorm of [0, 1]) {
        const a = project(xNorm, 0, zNorm);
        const b = project(xNorm, 1, zNorm);
        lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, key: `vert-${tier}-${zNorm}` });
      }
    }
    return lines;
  }, [pitch, yaw, zMetric, zoom]);

  const tierStats = tiers.map((tier) => {
    const tierPools = pools.filter((p) => Math.max(1, Math.min(6, p.ctsNodes || Math.round(p.score / 20))) === tier);
    if (!tierPools.length) return null;
    const avgScore =
      tierPools.reduce((sum, p) => sum + (p.score || 0), 0) / tierPools.length;
    const projected = project((tier - 1) / 5, avgScore / maxScore, 0.5);
    return { tier, avgScore, x: projected.x, y: projected.y };
  }).filter(Boolean) as Array<{ tier: number; avgScore: number; x: number; y: number }>;

  const avgPath =
    tierStats.length > 1
      ? catmullRomToBezier(tierStats.map(({ x, y }) => ({ x, y })))
          .map((c, i) => `${i === 0 ? "M" : "C"} ${c.join(" ")}`)
          .join(" ")
      : "";

  const zMetricLabel =
    zMetric === "liquidity" ? "Liquidity" : zMetric === "volume24h" ? "24h Volume" : "Impact";
  const drawCycleSeconds = 11;
  const lineDrawProgress = heroMode ? (animPhase % drawCycleSeconds) / drawCycleSeconds : 1;

  const axisValue = (point: (typeof points)[number], kind: "tier" | "score" | "z") => {
    if (kind === "tier") return `CTS ${point.tier}`;
    if (kind === "score") return `${point.score.toFixed(1)}`;
    if (zMetric === "impact") return `${point.impact.toFixed(point.impact < 0.1 ? 3 : 2)}%`;
    const value = zMetric === "liquidity" ? point.liq : point.vol;
    return `${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`;
  };

  if (!hasPools) return null;

  return (
    <div className={heroMode ? "relative h-full" : "relative space-y-2"}>
      {heroMode ? null : (
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
          <span className="uppercase tracking-[0.2em] text-white/45">Z axis</span>
          {([
            ["liquidity", "Liquidity"],
            ["volume24h", "24h Volume"],
            ["impact", "Impact"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setZMetric(key)}
              className={`rounded-full border px-3 py-2 uppercase tracking-[0.16em] transition ${
                zMetric === key
                  ? "border-cyan-300/50 bg-cyan-500/15 text-cyan-100"
                  : "border-white/15 bg-white/6 text-white/60 hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
          <button
            onClick={() => {
              setYaw(-0.62);
              setPitch(0.26);
              setZoom(1);
            }}
            className="rounded-full border border-white/20 bg-white/10 px-3 py-2 hover:bg-white/20"
          >
            Reset view
          </button>
          <button
            onClick={() => setZoom((value) => Math.min(2.4, value + 0.18))}
            className="rounded-full border border-white/20 bg-white/10 px-3 py-2 hover:bg-white/20"
          >
            Zoom +
          </button>
          <button
            onClick={() => setZoom((value) => Math.max(0.7, value - 0.18))}
            className="rounded-full border border-white/20 bg-white/10 px-3 py-2 hover:bg-white/20"
          >
            Zoom -
          </button>
          <span className="text-white/50">
            Drag to rotate | Wheel or buttons to zoom | Bubble size = liquidity
          </span>
        </div>
      </div>
      )}
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className={
          heroMode
            ? "h-full w-[108%] -translate-x-[6%] text-white/40 [overflow:visible]"
            : "text-white/60"
        }
        shapeRendering="geometricPrecision"
        style={{
          cursor: heroMode ? "default" : "grab",
          touchAction: heroMode ? "auto" : "none",
          opacity: heroMode ? 0.68 : 1,
          filter: heroMode ? "saturate(0.74) contrast(0.9)" : "none",
        }}
        onPointerDown={(e) => {
          if (heroMode) return;
          dragRef.current = {
            active: true,
            startX: e.clientX,
            startY: e.clientY,
            startYaw: yaw,
            startPitch: pitch,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (heroMode) return;
          if (!dragRef.current.active) return;
          const dx = e.clientX - dragRef.current.startX;
          const dy = e.clientY - dragRef.current.startY;
          pendingMoveRef.current = { dx, dy };
          if (frameRef.current !== null) return;
          frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = null;
            const next = pendingMoveRef.current;
            if (!next) return;
            setYaw(dragRef.current.startYaw + next.dx * 0.0075);
            setPitch(
              Math.max(-0.85, Math.min(0.85, dragRef.current.startPitch - next.dy * 0.0058)),
            );
          });
        }}
        onPointerUp={(e) => {
          if (heroMode) return;
          dragRef.current.active = false;
          pendingMoveRef.current = null;
          if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
          }
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onPointerCancel={(e) => {
          if (heroMode) return;
          dragRef.current.active = false;
          pendingMoveRef.current = null;
          if (frameRef.current !== null) {
            window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
          }
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        }}
        onWheel={(e) => {
          if (heroMode) return;
          e.preventDefault();
          const delta = e.deltaY > 0 ? -0.12 : 0.12;
          setZoom((value) => Math.max(0.7, Math.min(2.4, value + delta)));
        }}
      >
        <defs>
          <radialGradient id="bubble" cx="38%" cy="32%" r="64%">
            <stop offset="0%" stopColor="rgba(220,255,255,0.95)" />
            <stop offset="28%" stopColor="rgba(123,242,255,0.72)" />
            <stop offset="100%" stopColor="rgba(30,140,210,0.18)" />
          </radialGradient>
        </defs>
        <g opacity={heroMode ? 0.09 : 0.22}>
          {gridLines.map((line) => (
            <line
              key={line.key}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="rgba(255,255,255,0.18)"
            />
          ))}
        </g>
        <g opacity={heroMode ? 0.44 : 0.78}>
          <line
            x1={project(0, 0, 0).x}
            y1={project(0, 0, 0).y}
            x2={project(1, 0, 0).x}
            y2={project(1, 0, 0).y}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1.3"
          />
          <line
            x1={project(0, 0, 0).x}
            y1={project(0, 0, 0).y}
            x2={project(0, 1, 0).x}
            y2={project(0, 1, 0).y}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1.3"
          />
          <line
            x1={project(1, 0, 0).x}
            y1={project(1, 0, 0).y}
            x2={project(1, 0, 1).x}
            y2={project(1, 0, 1).y}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1.3"
          />
        </g>
        <text x={92} y={height - 30} className={heroMode ? "fill-white/55 text-[10px]" : "fill-white text-xs"} letterSpacing="3">
          CTS TIER
        </text>
        <text x={56} y={110} className={heroMode ? "fill-white/55 text-[10px]" : "fill-white text-xs"} letterSpacing="3">
          SCORE
        </text>
        <text x={width - 188} y={height - 118} className={heroMode ? "fill-white/55 text-[10px]" : "fill-white text-xs"} letterSpacing="3">
          {zMetricLabel.toUpperCase()}
        </text>
        {tiers.map((tier) => {
          const tick = project((tier - 1) / 5, 0, 0);
          return (
            <text key={`tier-${tier}`} x={tick.x} y={tick.y + 24} textAnchor="middle" className={heroMode ? "fill-white/70 text-[10px]" : "fill-white text-[11px]"}>
              {tier}
            </text>
          );
        })}
        {[0, 25, 50, 75, 100].map((score) => {
          const tick = project(0, score / maxScore, 0);
          return (
            <text key={`score-${score}`} x={tick.x - 12} y={tick.y + 4} textAnchor="end" className={heroMode ? "fill-white/70 text-[10px]" : "fill-white text-[11px]"}>
              {score}
            </text>
          );
        })}
        {avgPath ? (
            <path
              d={avgPath}
              pathLength={heroMode ? 1 : undefined}
              fill="none"
              stroke="rgba(0,255,180,0.55)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={heroMode ? 1 : undefined}
              strokeDashoffset={heroMode ? 1 - lineDrawProgress : undefined}
              opacity={heroMode ? 0.28 + lineDrawProgress * 0.48 : undefined}
            />
          ) : null}
        {points.map((p, idx) => (
          <g
            key={`pt-${idx}`}
            onMouseEnter={() =>
              heroMode
                ? undefined
                :
              setHovered({
                label: p.label,
                lines: [
                  `Tier ${axisValue(p, "tier")}`,
                  `Score ${axisValue(p, "score")}`,
                  `${zMetricLabel} ${axisValue(p, "z")}`,
                ],
                sx: p.x,
                sy: p.y - p.size - 10,
              })
            }
            onMouseLeave={() => (heroMode ? undefined : setHovered(null))}
            onTouchStart={() =>
              heroMode
                ? undefined
                :
              setHovered({
                label: p.label,
                lines: [
                  `Tier ${axisValue(p, "tier")}`,
                  `Score ${axisValue(p, "score")}`,
                  `${zMetricLabel} ${axisValue(p, "z")}`,
                ],
                sx: p.x,
                sy: p.y - p.size - 10,
              })
            }
            onTouchEnd={() => (heroMode ? undefined : setHovered(null))}
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={Math.max(
                4,
                p.size *
                  1.28 *
                  (heroMode ? 1 + Math.sin(animPhase * 0.52 + idx * 0.31) * 0.05 : 1),
              )}
              fill={p.color.replace("0.9", "0.08")}
              stroke={heroMode ? p.color.replace("0.9", "0.1") : p.color.replace("0.9", "0.16")}
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={Math.max(
                3.5,
                p.size * (heroMode ? 1 + Math.sin(animPhase * 0.78 + idx * 0.42) * 0.08 : 1),
              )}
              fill="url(#bubble)"
              stroke={heroMode ? p.color.replace("0.9", "0.66") : p.color}
              strokeWidth="1.2"
              opacity={heroMode ? 0.64 : 0.95}
            />
          </g>
        ))}
        {!heroMode && hovered ? (() => {
          const lines = [hovered.label, ...hovered.lines];
          const minW = 180;
          const maxW = 360;
          const textW = Math.max(...lines.map((line) => line.length)) * 7;
          const w = Math.min(maxW, Math.max(minW, textW + 20));
          const h = 20 + lines.length * 18;
          const x = Math.max(10, Math.min(hovered.sx - w / 2, width - w - 10));
          const y = Math.max(10, hovered.sy - h - 10);
          return (
            <g>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx={8}
                ry={8}
                fill="rgba(0,0,0,0.75)"
                stroke="rgba(0,255,200,0.4)"
              />
              <text
                x={x + w / 2}
                y={y + 18}
                textAnchor="middle"
                className="fill-white text-[11px]"
              >
                {hovered.label}
              </text>
              {hovered.lines.map((line, index) => (
                <text
                  key={`${line}-${index}`}
                  x={x + 12}
                  y={y + 36 + index * 16}
                  className="fill-white/80 text-[11px]"
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })() : null}
        {!heroMode ? (
        <g className="text-[11px] fill-white/70" transform={`translate(${padding.left} ${padding.top - 8})`}>
          <rect x={0} y={-16} width={360} height={20} fill="rgba(0,0,0,0.3)" rx={6} />
          <g transform="translate(10 0)" className="flex items-center gap-3">
            <line
              x1={0}
              y1={-6}
              x2={30}
              y2={-6}
              stroke="rgba(0,255,180,0.6)"
              strokeWidth="3"
            />
            <text x={36} y={-2}>Avg score path</text>
            <circle cx={148} cy={-6} r={6} fill="url(#bubble)" stroke="rgba(0,255,200,0.35)" />
            <text x={160} y={-2}>Bubble size = liquidity</text>
            <g className="cursor-pointer" onClick={() => setShowLegendInfo(true)}>
              <rect
                x={308}
                y={-12}
                width={30}
                height={16}
                rx={4}
                ry={4}
                fill="rgba(255,255,255,0.12)"
              />
              <text
                x={315}
                y={-1}
                textAnchor="middle"
                className="fill-white"
              >
                info
              </text>
            </g>
          </g>
        </g>
        ) : null}
      </svg>
      {!heroMode && showLegendInfo ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="max-w-lg rounded-2xl border border-emerald-400/40 bg-[#0b1220] p-4 text-white shadow-[0_0_40px_rgba(0,0,0,0.45)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-200">
                Legend details
              </div>
              <button
                onClick={() => setShowLegendInfo(false)}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <ul className="space-y-1 text-sm text-white/80">
              <li>
                <b className="text-cyan-300/80">Units</b>: Liquidity and volume values are displayed in <b>USD</b> (source feed),
                not on-chain Solana. Scores and rankings are computed using relative ratios only.
              </li>
              <li><b className="text-teal-400/80">3D space</b>: X = CTS tier, Y = score, Z = selected metric.</li>
              <li><b className="text-white/80">Bubble size</b>: pool liquidity.</li>
              <li><b className="text-cyan-200/80">Bubble color</b>: stronger tiers shift from red to green.</li>
              <li>Drag to rotate the scene; hover/tap a bubble for pool details.</li>
            </ul>
          </div>
        </div>
      ) : null}
      {heroMode && staticHero ? (
        <div className="pointer-events-none absolute bottom-2 right-2 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.16em] text-white/50">
          Static preview
        </div>
      ) : null}
    </div>
  );
}

function catmullRomToBezier(points: { x: number; y: number }[]) {
  const res: number[][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    res.push([i === 0 ? p1.x : c1x, i === 0 ? p1.y : c1y, c2x, c2y, p2.x, p2.y]);
  }
  return res;
}
