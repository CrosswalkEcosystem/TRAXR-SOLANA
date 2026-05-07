export function MethodologyDocContent() {
  return (
    <>
      <section className="mt-12">
        <h2 className="text-lg sm:text-xl font-medium">What TRAXR-SOLANA Is</h2>
        <p className="mt-3 text-slate-300">
          TRAXR-SOLANA is a foundational indexing and normalization layer for
          Solana DeFi data. It ingests pool data from NodeZero, normalizes
          it into a stable schema, enriches selected datasets with exact
          quote-based signals, and exposes a clean substrate for downstream
          scoring and analysis.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Layered Architecture</h2>
        <ul className="mt-4 space-y-2 text-slate-300">
          <li>
            <b>Layer 1 - Indexed Data</b>: source-backed pool metadata,
            token info, liquidity, volume, and program attribution.
          </li>
          <li>
            <b>Layer 2 - Derived Heuristics</b>: computed, best-effort
            metrics like depth, stability from snapshot history, and
            $1,000 quote-based price impact.
          </li>
          <li>
            <b>Layer 3 - Risk Signals</b>: activity, stability, trust, fee,
            and impact resolved by CTS scoring logic.
          </li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Why Pools, Not Tokens</h2>
        <p className="mt-3 text-slate-300">
          Risk in AMM environments emerges from liquidity depth, activity,
          fee dynamics, impact under a fixed quote size, and trust signals.
          Pool-centric analysis surfaces where risk actually manifests.
        </p>
      </section>

      <section className="mt-10 rounded-md border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg sm:text-xl font-medium">What TRAXR-SOLANA Is Not</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-300">
          <li>Not financial or investment advice</li>
          <li>Not a price prediction or yield forecast</li>
          <li>Not a trading interface or portfolio tracker</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">CTS Scoring (Embedded)</h2>
        <p className="mt-3 text-slate-300">
          TRAXR-SOLANA scoring mirrors the CTS pool-only logic from
          <span className="text-slate-100"> crosswalk-dex-backend</span>, producing
          CTS nodes, scores, and warnings without modifying indexed facts.
        </p>
        <p className="mt-3 text-slate-300">
          Fee competitiveness is interpreted relative to pool type, and
          Meteora DLMM and Meteora DAMM v2 use structural base fee rather
          than dynamic max fee.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">TRAXR-SOLANA Score</h2>
        <p className="mt-3 text-slate-300">
          Each pool receives a score (0-100) mapped to a 1-6 CTS tier.
          Scores are relative, deterministic within the dataset, and
          computed by the scoring engine.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Scoring Dimensions</h2>
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-slate-300">
          <li>
            <span className="font-medium text-slate-200">Liquidity Depth</span> - estimated reserves and resilience
          </li>
          <li>
            <span className="font-medium text-slate-200">Activity</span> - volume + transaction activity
          </li>
          <li>
            <span className="font-medium text-slate-200">Price Impact ($1k)</span> - price sensitivity under a simulated $1,000 swap
          </li>
          <li>
            <span className="font-medium text-slate-200">Stability</span> - relative volatility consistency
          </li>
          <li>
            <span className="font-medium text-slate-200">Trust</span> - locked liquidity + data completeness
          </li>
          <li>
            <span className="font-medium text-slate-200">Fee</span> - fee competitiveness versus a pool-type baseline
          </li>
        </ul>
      </section>

      <section className="mt-8 rounded-md border border-cyan-400/20 bg-cyan-400/5 p-4">
        <h3 className="text-sm font-medium uppercase tracking-[0.2em] text-cyan-300">Transparency Notes</h3>
        <p className="mt-2 text-sm text-slate-300">
          Derived metrics are best-effort. When exact on-chain depth is not
          available, values are explicitly labeled as estimated instead of
          being presented as protocol guarantees.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-5">
        <h2 className="text-base sm:text-lg font-medium text-yellow-300">Current Operating Model</h2>
        <p className="mt-3 text-slate-300">
          The current operating model runs on NodeZero snapshots cached in
          stamped JSON files and refreshed by the fetch pipeline.
        </p>
        <p className="mt-2 text-slate-300">
          This approach prioritizes correctness, repeatability, and
          explicit separation between source fields and local enrichments.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Roadmap (Optional)</h2>
        <p className="mt-3 text-slate-300">
          The roadmap progresses from indexing, to on-chain resolution,
          to expanded scoring, then cross-chain aggregation.
        </p>
      </section>

      <p className="mt-12 text-xs text-slate-500">
        Data is refreshed periodically from NodeZero snapshots.
        Exact quote support currently covers AMM, CPMM, Orca, and Meteora DLMM.
        Meteora DAMM v2 and PumpSwap currently use estimated local impact modeling.
      </p>
    </>
  );
}
