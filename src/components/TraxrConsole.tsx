"use client";

import { useMemo, useState } from "react";
import { TraxrScoreResult } from "@/lib/types";
import {
  getContextualExplanationForSelection,
  getLocalExplanation,
  VALID_COMBINATIONS,
} from "@/lib/nodeExplanations";

type Props = {
  pool: TraxrScoreResult;
};

type NodeKey = keyof TraxrScoreResult["nodes"];

const ALL_NODES: NodeKey[] = [
  "depth",
  "activity",
  "impact",
  "stability",
  "trust",
  "fee",
];

const NODE_LABELS: Record<NodeKey, string> = {
  depth: "Depth",
  activity: "Activity",
  impact: "Impact",
  stability: "Stability",
  trust: "Trust",
  fee: "Fee",
};

function formatNumber(value: number | null | undefined, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value: number | null | undefined, digits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(digits)}%`;
}

function shortAddress(address: string | null | undefined) {
  if (!address) return "Unknown";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
}

function nodeBand(value: number): "HIGH" | "MID" | "LOW" {
  if (value >= 80) return "HIGH";
  if (value >= 40) return "MID";
  return "LOW";
}

function pillTone(band: "HIGH" | "MID" | "LOW") {
  if (band === "HIGH") {
    return "border-emerald-300/35 bg-emerald-500/12 text-emerald-100";
  }
  if (band === "MID") {
    return "border-amber-300/35 bg-amber-500/12 text-amber-100";
  }
  return "border-rose-300/35 bg-rose-500/12 text-rose-100";
}

function sentenceList(items: string[]) {
  if (!items.length) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function bandLabel(value: number) {
  return nodeBand(value).toLowerCase();
}

function classifyProgram(metrics: TraxrScoreResult["metrics"]) {
  const source = String(metrics.source ?? "").trim().toLowerCase();
  const poolType = String(metrics.poolType ?? "").trim().toLowerCase();

  if (source === "orca" || poolType === "whirlpool") {
    return { program: "Orca", poolTypeLabel: "Whirlpool", key: "orca" as const };
  }
  if (source === "pumpswap" || poolType === "pumpswap") {
    return { program: "PumpSwap", poolTypeLabel: "PumpSwap", key: "pumpswap" as const };
  }
  if (source === "meteora-damm" || poolType === "damm") {
    return {
      program: "Meteora",
      poolTypeLabel: "DAMM v2",
      key: "meteora-dammv2" as const,
    };
  }
  if (source === "meteora" || poolType === "dlmm") {
    return { program: "Meteora", poolTypeLabel: "DLMM", key: "meteora" as const };
  }
  if (poolType === "cpmm") {
    return { program: "Raydium", poolTypeLabel: "CPMM", key: "raydium" as const };
  }
  if (poolType === "clmm") {
    return { program: "Raydium", poolTypeLabel: "CLMM", key: "raydium" as const };
  }
  if (poolType === "amm" || poolType === "standard") {
    return { program: "Raydium", poolTypeLabel: "AMM", key: "raydium" as const };
  }
  return {
    program: source ? source[0].toUpperCase() + source.slice(1) : "Raydium",
    poolTypeLabel: metrics.poolType || "Pool",
    key: "other" as const,
  };
}

function impactPath(metrics: TraxrScoreResult["metrics"]) {
  const { key, poolTypeLabel } = classifyProgram(metrics);
  const exact = metrics.priceImpactPct !== null && metrics.priceImpactPct !== undefined;

  if (key === "orca") {
    return exact
      ? "Exact Orca Whirlpool $1,000 quote via NodeZero rpc-internal."
      : "Fallback estimate because an exact Whirlpool quote was not available.";
  }
  if (key === "meteora") {
    return exact
      ? "Exact Meteora DLMM $1,000 quote via NodeZero rpc-internal."
      : "Fallback estimate because an exact DLMM quote was not available.";
  }
  if (key === "meteora-dammv2") {
    return exact
      ? "Estimated Meteora DAMM v2 $1,000 impact from local pool state. This is not routed quote execution."
      : "Impact is unavailable because DAMM pool state was not sufficient for a stable local estimate.";
  }
  if (key === "pumpswap") {
    return exact
      ? "Estimated PumpSwap $1,000 impact from local pool state. This is not routed quote execution."
      : "Impact is unavailable because PumpSwap pool state was not sufficient for a stable local estimate.";
  }
  if (poolTypeLabel === "AMM" || poolTypeLabel === "CPMM") {
    return "Exact local constant-product $1,000 simulation from snapshot reserves.";
  }
  if (poolTypeLabel === "CLMM") {
    return exact
      ? "Exact Raydium CLMM $1,000 quote via NodeZero rpc-internal."
      : "Fallback estimate because an exact CLMM quote was not available.";
  }
  return exact
    ? "Stored pool-level price impact signal."
    : "Estimated fallback because no exact quote path is active for this pool.";
}

function feePath(metrics: TraxrScoreResult["metrics"]) {
  const { key, poolTypeLabel } = classifyProgram(metrics);
  if (key === "meteora") {
    return "Fee competitiveness uses Meteora structural base fee against a DLMM baseline.";
  }
  if (key === "meteora-dammv2") {
    return "Fee competitiveness uses Meteora structural base fee against a DAMM baseline.";
  }
  if (poolTypeLabel === "Whirlpool" || poolTypeLabel === "CLMM") {
    return "Fee competitiveness is scored against a concentrated-liquidity baseline.";
  }
  return "Fee competitiveness is scored against a constant-product baseline.";
}

function stabilityPath(metrics: TraxrScoreResult["metrics"]) {
  if (
    typeof metrics.volatilityPct === "number" &&
    Number.isFinite(metrics.volatilityPct)
  ) {
    return "Stability is derived from retained snapshot history and peer-relative volatility.";
  }
  return "Stability is constrained by limited retained history for this pool.";
}

function trustPath() {
  return "Trust combines locked-liquidity posture with data completeness for the current pool.";
}

function topNodes(nodes: TraxrScoreResult["nodes"]) {
  return [...ALL_NODES]
    .sort((a, b) => nodes[b] - nodes[a])
    .map((key) => ({ key, value: nodes[key], label: NODE_LABELS[key] }));
}

function spreadProfile(selected: NodeKey[], nodes: TraxrScoreResult["nodes"]) {
  const keys = selected.length ? selected : ALL_NODES;
  const ranked = [...keys].sort((a, b) => nodes[b] - nodes[a]);
  const strongest = ranked[0];
  const weakest = ranked[ranked.length - 1];
  const spread = nodes[strongest] - nodes[weakest];
  const spreadLabel =
    spread >= 50 ? "highly uneven" : spread >= 20 ? "mixed" : "tight";
  return {
    strongest,
    weakest,
    spread,
    spreadLabel,
  };
}

function contextProbe(
  selected: NodeKey[],
  metrics: TraxrScoreResult["metrics"],
  nodes: TraxrScoreResult["nodes"],
) {
  const contextual =
    selected.length === 1
      ? [getLocalExplanation(selected[0], nodes[selected[0]])]
      : selected.length > 1
        ? getContextualExplanationForSelection(selected, nodes)
        : [];
  const primary = contextual[0] ?? {
    title: "Context Overview",
    body: "This selection describes the current pool profile.",
  };

  const details: string[] = [];
  if (selected.includes("impact")) details.push(impactPath(metrics));
  if (selected.includes("fee")) details.push(feePath(metrics));
  if (selected.includes("stability")) details.push(stabilityPath(metrics));
  if (selected.includes("trust")) details.push(trustPath());
  if (selected.includes("depth")) {
    details.push("Depth reflects the current liquidity profile visible in the active snapshot.");
  }
  if (selected.includes("activity")) {
    details.push("Activity reflects normalized 24h/7d usage rather than a single raw volume field.");
  }

  if (!details.length) {
    details.push(impactPath(metrics));
  }

  return {
    title: primary.title,
    body: primary.body,
    detail: sentenceList(details),
  };
}

function describeSingleNode(
  node: NodeKey,
  metrics: TraxrScoreResult["metrics"],
  nodes: TraxrScoreResult["nodes"],
) {
  const program = classifyProgram(metrics);
  const value = nodes[node];
  const band = nodeBand(value);
  const label = NODE_LABELS[node];

  if (node === "depth") {
    if (program.poolTypeLabel === "DLMM") {
      return {
        title: band === "HIGH" ? "Bin Depth Holding" : band === "MID" ? "Selective Bin Depth" : "Thin Bin Depth",
        body:
          band === "HIGH"
            ? "Current DLMM bin depth looks strong for the active price region."
            : band === "MID"
              ? "Depth exists, but available liquidity is concentrated more selectively."
              : "Depth around the active DLMM region looks thin and may step down quickly.",
      };
    }
    if (program.poolTypeLabel === "Whirlpool" || program.poolTypeLabel === "CLMM") {
      return {
        title: band === "HIGH" ? "Concentrated Depth" : band === "MID" ? "Moderate Tick Support" : "Thin Tick Support",
        body:
          band === "HIGH"
            ? "Active concentrated-liquidity ranges are supporting the current price well."
            : band === "MID"
              ? "Tick-range support is present, but not dominant versus peers."
              : "Active tick liquidity looks limited relative to comparable pools.",
      };
    }
    return {
      title: band === "HIGH" ? "Reserve Cushion" : band === "MID" ? "Usable Reserve Base" : "Thin Reserve Base",
      body:
        band === "HIGH"
          ? "Constant-product reserves are deep enough to absorb routine swap flow."
          : band === "MID"
            ? "Reserves support moderate flow but can become sensitive under larger trades."
            : "Reserve depth is limited and may not tolerate aggressive flow cleanly.",
    };
  }

  if (node === "activity") {
    return {
      title: band === "HIGH" ? "Flow Confirmation" : band === "MID" ? "Mixed Flow" : "Idle Flow",
      body:
        band === "HIGH"
          ? "Recent usage confirms that this pool is actively participating in current routing flow."
          : band === "MID"
            ? "Recent usage is present but not dominant relative to the pool's footprint."
            : "Recent flow is light relative to pool size, so live usage is not strongly confirming the structure.",
    };
  }

  if (node === "impact") {
    const exact =
      typeof metrics.priceImpactPct === "number" && Number.isFinite(metrics.priceImpactPct);
    return {
      title:
        band === "HIGH"
          ? exact
            ? "Quoted Execution"
            : "Estimated Execution"
          : band === "MID"
            ? "Execution Friction"
            : "Execution Sensitivity",
      body:
        band === "HIGH"
          ? exact
            ? "The simulated $1,000 trade path remains efficient for this pool."
            : "The estimated $1,000 trade path looks manageable, but this is still a fallback view."
          : band === "MID"
            ? "A simulated $1,000 swap creates noticeable but not extreme execution drag."
            : "A simulated $1,000 swap is likely to move execution materially for this pool.",
    };
  }

  if (node === "stability") {
    return {
      title: band === "HIGH" ? "Stable Tape" : band === "MID" ? "Uneven Tape" : "Volatile Tape",
      body:
        band === "HIGH"
          ? "Retained snapshot history shows relatively consistent price behavior."
          : band === "MID"
            ? "Price behavior is mixed versus peers and does not fully confirm structural strength."
            : "Retained snapshot history shows unstable price behavior relative to peers.",
    };
  }

  if (node === "trust") {
    return {
      title: band === "HIGH" ? "Confirmed Surface" : band === "MID" ? "Partial Confirmation" : "Weak Confirmation",
      body:
        band === "HIGH"
          ? "Liquidity posture and data completeness are both reinforcing confidence in this pool surface."
          : band === "MID"
            ? "Some trust factors are present, but the pool is not fully reinforced on every structural check."
            : "The trust surface is weak or only partially confirmed for this pool.",
    };
  }

  return {
    title: band === "HIGH" ? "Competitive Fee" : band === "MID" ? "Neutral Fee" : "Heavy Fee",
    body:
      band === "HIGH"
        ? "Fee posture is competitive relative to the baseline for this pool type."
        : band === "MID"
          ? "Fee posture sits near the expected band for this pool type."
          : "Fee posture is elevated relative to the baseline for this pool type.",
  };
}

function describeSelection(
  selected: NodeKey[],
  metrics: TraxrScoreResult["metrics"],
  nodes: TraxrScoreResult["nodes"],
) {
  const program = classifyProgram(metrics);
  const selectedBands = selected.map((key) => `${NODE_LABELS[key]}=${bandLabel(nodes[key])}`);

  if (selected.length === 1) {
    const single = describeSingleNode(selected[0], metrics, nodes);
    return {
      title: single.title,
      body: single.body,
      detail: `Context: ${program.program} ${program.poolTypeLabel}. Signal band: ${selectedBands[0]}. ${contextProbe(selected, metrics, nodes).detail}`,
    };
  }

  const set = new Set(selected);

  if (set.has("depth") && set.has("activity") && selected.length === 2) {
    const depth = nodes.depth;
    const activity = nodes.activity;
    if (depth >= 80 && activity < 40) {
      return {
        title: "Deep but Underused",
        body: "Liquidity is present, but current trading flow is not fully validating that depth.",
        detail: `This ${program.program} ${program.poolTypeLabel} profile can look structurally strong while still remaining idle in recent flow.`,
      };
    }
    if (depth < 40 && activity >= 80) {
      return {
        title: "Hot but Thin",
        body: "Activity is elevated relative to the amount of depth available to absorb it.",
        detail: `Execution quality can deteriorate quickly if active routing keeps pressing into a thin pool.`,
      };
    }
  }

  if (set.has("depth") && set.has("impact")) {
    if (nodes.depth >= 80 && nodes.impact >= 80) {
      return {
        title: "Execution Cushion",
        body: "Depth and simulated $1,000 execution are aligned in a strong band.",
        detail: impactPath(metrics),
      };
    }
    if (nodes.depth >= 80 && nodes.impact < 40) {
      return {
        title: "Hidden Friction",
        body: "Headline depth looks strong, but the execution path is still showing stress.",
        detail: `That usually means active liquidity is less usable than total size might suggest for this ${program.poolTypeLabel} pool.`,
      };
    }
  }

  if (set.has("activity") && set.has("impact")) {
    if (nodes.activity >= 80 && nodes.impact < 40) {
      return {
        title: "Flow Pressure",
        body: "Heavy recent usage is colliding with weak execution quality.",
        detail: "This can signal crowded routing, shallow active depth, or a pool that is being stressed by current order flow.",
      };
    }
    if (nodes.activity < 40 && nodes.impact >= 80) {
      return {
        title: "Quiet but Efficient",
        body: "Execution quality is strong even though recent activity is not yet validating the pool.",
        detail: "This often means the structure is ready, but current demand has not caught up.",
      };
    }
  }

  if (set.has("stability") && set.has("impact")) {
    if (nodes.stability >= 80 && nodes.impact >= 80) {
      return {
        title: "Stable Execution Surface",
        body: "Both retained price behavior and simulated execution are supporting the pool.",
        detail: "That is one of the cleaner profiles for a trade-facing surface.",
      };
    }
    if (nodes.stability < 40 && nodes.impact >= 80) {
      return {
        title: "Good Execution, Weak Tape",
        body: "Current execution looks solid, but the historical price tape is not confirming the same quality.",
        detail: "That mix can still matter for pool selection because current tradability and recent stability are not the same thing.",
      };
    }
  }

  if (set.has("trust") && set.has("depth")) {
    if (nodes.trust >= 80 && nodes.depth >= 80) {
      return {
        title: "Reinforced Structure",
        body: "Liquidity strength is backed by a solid trust surface.",
        detail: "This is one of the cleaner structural combinations in the console.",
      };
    }
    if (nodes.depth >= 80 && nodes.trust < 40) {
      return {
        title: "Size Without Confirmation",
        body: "Liquidity looks strong, but the trust layer is not fully reinforcing it.",
        detail: "That can matter when a pool looks large on paper but is weaker on provenance or data completeness.",
      };
    }
  }

  if (set.has("fee") && set.has("activity")) {
    if (nodes.fee < 40 && nodes.activity >= 80) {
      return {
        title: "Active Despite Cost",
        body: "Recent usage remains strong even though fee posture is not competitive.",
        detail: "That often means routing demand, volatility, or market necessity is outweighing fee drag.",
      };
    }
    if (nodes.fee >= 80 && nodes.activity < 40) {
      return {
        title: "Cheap but Quiet",
        body: "Fee posture is competitive, but recent usage still looks soft.",
        detail: "Low fees alone are not enough to guarantee routing relevance.",
      };
    }
  }

  const generic = contextProbe(selected, metrics, nodes);
  return generic;
}

export function TraxrConsole({ pool }: Props) {
  const [selected, setSelected] = useState<NodeKey[]>([]);
  const nodes = pool.nodes;
  const metrics = pool.metrics;
  const program = classifyProgram(metrics);

  const enabledNodes = useMemo(() => {
    if (selected.length === 0) return ALL_NODES;
    return ALL_NODES.filter((node) =>
      selected.every((picked) => picked === node || VALID_COMBINATIONS[picked]?.includes(node)),
    );
  }, [selected]);

  const ranked = useMemo(() => topNodes(nodes), [nodes]);
  const strongest = ranked.slice(0, 2);
  const watchlist = ranked.slice(-2).reverse();
  const selectedProbe = useMemo(
    () => describeSelection(selected, metrics, nodes),
    [selected, metrics, nodes],
  );
  const profile = useMemo(() => spreadProfile(selected, nodes), [selected, nodes]);

  const statusLine =
    selected.length === 0
      ? `TRAXR-SOLANA> ${program.program} ${program.poolTypeLabel} ready. Strongest: ${strongest
          .map((item) => item.label)
          .join("/")}. Watch: ${watchlist.map((item) => item.label).join("/")}.`
      : `TRAXR-SOLANA> Correlating ${selected
          .map((key) => NODE_LABELS[key])
          .join(" + ")} across current ${program.program} ${program.poolTypeLabel} state.`;

  const selectedChips = (selected.length ? selected : strongest.map((item) => item.key)).map(
    (key) => ({
      key,
      label: NODE_LABELS[key],
      value: nodes[key],
      band: nodeBand(nodes[key]),
    }),
  );

  const suggestedProbes = selected.length
    ? null
    : strongest[0]
      ? VALID_COMBINATIONS[strongest[0].key]
          ?.slice(0, 3)
          .map((key) => `${strongest[0].label} + ${NODE_LABELS[key]}`)
      : [];

  function toggleNode(node: NodeKey) {
    setSelected((prev) =>
      prev.includes(node) ? prev.filter((item) => item !== node) : [...prev, node],
    );
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0b1324]/80 p-5 shadow-[0_0_30px_rgba(0,255,200,0.08)] backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.3em] text-cyan-200/70">
          TRAXR Console
        </div>
        <div className="text-[11px] text-white/40">Interpretability layer</div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ALL_NODES.map((node) => {
          const active = selected.includes(node);
          const enabled = enabledNodes.includes(node);
          return (
            <button
              key={node}
              type="button"
              disabled={!enabled}
              onClick={() => toggleNode(node)}
              className={`rounded-full border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition ${
                active
                  ? "border-emerald-300/35 bg-emerald-500/14 text-emerald-100 shadow-[0_0_16px_rgba(110,255,170,0.18)]"
                  : enabled
                    ? "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                    : "cursor-not-allowed border-white/5 bg-white/[0.03] text-white/20"
              }`}
            >
              {NODE_LABELS[node]}
            </button>
          );
        })}
      </div>

        <div className="mb-4 rounded-2xl border border-white/10 bg-black/25 px-5 py-4 font-mono text-sm text-white/80">
          {statusLine}
        </div>

      {selected.length === 0 ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-black/20 p-5 lg:col-span-1">
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
              Pool Snapshot
            </div>
            <div className="mt-3 space-y-1.5 text-sm text-white/85">
              <div>Score: {pool.score} | CTS nodes: {pool.ctsNodes}</div>
              <div>
                Liquidity: {formatNumber(metrics.liquidityUsd)} USD
              </div>
              <div>
                24h Volume: {formatNumber(metrics.volume24hUsd)} USD
              </div>
              <div>
                Fee: {formatPercent(metrics.feePct, 2)} | Impact: {formatPercent(metrics.priceImpactPct, 2)}
              </div>
              <div>
                Program: {program.program} | Type: {program.poolTypeLabel}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-5 lg:col-span-1">
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
              Strengths
            </div>
            <div className="mt-3 space-y-2.5">
              {strongest.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="text-white/85">{item.label}</div>
                  <div className="rounded-full border border-emerald-300/35 bg-emerald-500/12 px-3 py-1 text-sm text-emerald-100">
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-yellow-300/20 bg-black/20 p-5 lg:col-span-1">
            <div className="text-xs uppercase tracking-[0.24em] text-yellow-200/80">
              Watchlist
            </div>
            <div className="mt-3 space-y-2.5">
              {watchlist.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="text-white/85">{item.label}</div>
                  <div
                    className={`rounded-full border px-3 py-1 text-sm ${pillTone(
                      nodeBand(item.value),
                    )}`}
                  >
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
            {suggestedProbes && suggestedProbes.length ? (
              <div className="mt-4 text-sm text-white/60">
                Suggested probes: {suggestedProbes.join(" | ")}
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-5 lg:col-span-3">
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
              Data Provenance
            </div>
            <div className="mt-3 grid gap-3 text-sm text-white/75 sm:grid-cols-2 lg:grid-cols-4">
              <div>Source: {program.program}</div>
              <div>Pool Type: {program.poolTypeLabel}</div>
              <div>Pool: {shortAddress(pool.poolId)}</div>
              <div>Updated: {pool.updatedAt}</div>
            </div>
            <div className="mt-3 text-sm text-white/60">{impactPath(metrics)}</div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
              Selected Metrics
            </div>
            <div className="mt-3 flex flex-wrap gap-2.5">
              {selectedChips.map((chip) => (
                <div
                  key={chip.key}
                  className={`rounded-full border px-3.5 py-1.5 text-sm ${pillTone(chip.band)}`}
                >
                  {chip.label}: {chip.value} [{chip.band}]
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                {selectedProbe.title}
              </div>
              <div className="mt-3 text-base leading-8 text-white/85">
                {selectedProbe.body}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
              <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
                Current Pool Path
              </div>
              <div className="mt-3 text-base leading-8 text-white/85">
                {selectedProbe.detail}
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-200/70">
              Value Profile
            </div>
            <div className="mt-3 text-base leading-8 text-white/85">
              Dominant signal: {NODE_LABELS[profile.strongest]} ({nodes[profile.strongest]}).
              Limiting signal: {NODE_LABELS[profile.weakest]} ({nodes[profile.weakest]}).
              Spread across selected metrics is {profile.spread} points ({profile.spreadLabel}).
            </div>
            <div className="mt-3 text-sm text-white/60">
              {feePath(metrics)} {stabilityPath(metrics)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
