import TraxrArchitectureFlow from "@/components/TraxrArchitectureFlow";

export function ArchitectureDocContent() {
  return (
    <>
      <section className="mt-12">
        <h2 className="text-lg sm:text-xl font-medium">Architectural Overview</h2>
        <p className="mt-3 text-slate-300">
          TRAXR-SOLANA is a read-only indexing layer for Solana pools. It
          prioritizes correctness, reproducibility, and explicit separation
          between raw source data, local enrichments, and scoring logic.
        </p>
      </section>

      <TraxrArchitectureFlow />

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Core Data Pipeline</h2>
        <ol className="mt-4 space-y-4 text-slate-300 list-decimal pl-5">
          <li>
            <b>NodeZero Ingestion</b>
            <div className="text-slate-400 text-sm mt-1">
              Latest stamped Solana pool datasets for AMM, CLMM, CPMM, Orca Whirlpool, PumpSwap, Meteora DLMM, Meteora DAMM v2, and other tracked pools.
            </div>
          </li>
          <li>
            <b>Normalization & Enrichment</b>
            <div className="text-slate-400 text-sm mt-1">
              Raw inputs are mapped into deterministic pool metrics, then enriched with exact quote-based signals where supported.
            </div>
          </li>
          <li>
            <b>CTS Scoring (Embedded)</b>
            <div className="text-slate-400 text-sm mt-1">
              Pool-only CTS logic mirrors the backend scorer and computes depth, activity, impact, stability, trust, and fee posture.
            </div>
          </li>
          <li>
            <b>Presentation & Distribution</b>
            <div className="text-slate-400 text-sm mt-1">
              Scores and warnings are surfaced via the UI and read-only API.
            </div>
          </li>
        </ol>
      </section>

      <section className="mt-10 rounded-md border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg sm:text-xl font-medium">Read-Only by Design</h2>
        <p className="mt-3 text-slate-300">
          TRAXR-SOLANA never signs transactions, never interacts with wallets,
          and never holds custody. All components operate in strict read-only mode.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-5">
        <h2 className="text-base sm:text-lg font-medium text-yellow-300">Current Operating Architecture</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-300 space-y-1">
          <li>Snapshot-based ingestion from NodeZero</li>
          <li>Stamped JSON cache for repeatable runs and trend history</li>
          <li>Fetch-time local enrichments before final write</li>
          <li>Exact impact currently supported for AMM, CPMM, CLMM, Orca, and Meteora DLMM</li>
          <li>Meteora DAMM v2 currently uses estimated local $1k impact modeling</li>
          <li>PumpSwap currently uses estimated local $1k impact modeling</li>
          <li>CTS scoring logic embedded in-app</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Roadmap (Optional)</h2>
        <ul className="mt-4 list-disc pl-5 text-slate-300 space-y-2">
          <li>On-chain pool address resolution</li>
          <li>CLMM impact performance optimization</li>
          <li>Protocol-specific contract decoding</li>
          <li>Historical snapshots for trend analysis</li>
          <li>Cross-chain expansion</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Design Principles</h2>
        <ul className="mt-4 space-y-2 text-slate-300">
          <li><b>Indexing never guesses</b></li>
          <li><b>Scoring never rewrites facts</b></li>
          <li><b>Minimal scope and explicit TODOs</b></li>
          <li><b>Incremental, auditable rollout</b></li>
        </ul>
      </section>

      <p className="mt-12 text-xs text-slate-500">
        Architecture is introduced incrementally. Some protocol-specific depth paths still remain estimated until exact routing support is available.
      </p>
    </>
  );
}
