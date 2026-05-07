import { TraxrNodeBreakdown } from "@/lib/types";

type Props = {
  nodes: TraxrNodeBreakdown;
  impactMeta?: {
    pct: number;
    estimated: boolean;
  } | null;
};

const labels: Record<keyof TraxrNodeBreakdown, string> = {
  depth: "Liquidity Depth",
  activity: "Activity",
  impact: "Price Impact ($1k)",
  stability: "Stability",
  trust: "Trust",
  fee: "Fee",
};

const descriptions: Record<keyof TraxrNodeBreakdown, string> = {
  depth: "Estimated depth available for swaps",
  activity: "Volume activity blend (24h + 7d)",
  impact: "Price sensitivity under a simulated $1,000 swap",
  stability: "Relative volatility vs peer pools",
  trust: "Locked liquidity + data completeness",
  fee: "Fee competitiveness vs pool-type baseline",
};

// TRAXR node breakdown visualizes CTS-derived percentages for each dimension.
export function TraxrBreakdown({ nodes, impactMeta = null }: Props) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 px-6 py-5 backdrop-blur">
      <div className="mb-4 flex items-center justify-between text-xs uppercase tracking-[0.28em] text-white/60">
        <span>TRAXR Nodes</span>
        <span>0 - 100</span>
      </div>
      <div className="space-y-3">
        {Object.entries(nodes).map(([key, value]) => {
          const pct = Math.max(0, Math.min(100, value));
          const width = `${pct}%`;
          const hue =
            pct >= 80
              ? "from-emerald-400/80 to-cyan-400/60"
              : pct >= 40
              ? "from-amber-400/80 to-orange-400/60"
              : "from-red-500/80 to-orange-500/60";
          return (
            <div key={key} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm text-white/80">
                <div>
                  <div className="font-semibold uppercase tracking-[0.2em] text-white/70">
                    {labels[key as keyof TraxrNodeBreakdown]}
                  </div>
                  <div className="text-xs text-white/50">
                    {descriptions[key as keyof TraxrNodeBreakdown]}
                    {key === "impact" && impactMeta ? (
                      <span className="ml-2 text-amber-200/80">
                        {impactMeta.estimated ? "Est." : "Quoted"}{" "}
                        {impactMeta.pct.toFixed(2)}%
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="text-sm font-semibold text-white">{pct}</div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full bg-gradient-to-r ${hue}`}
                  style={{ width }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
