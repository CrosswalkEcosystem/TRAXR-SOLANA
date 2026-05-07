import TraxrDataModelMap from "@/components/TraxrDataModelMap";

export function DataModelDocContent() {
  return (
    <>
      <section className="mt-12">
        <h2 className="text-lg sm:text-xl font-medium">Data Model Overview</h2>
        <p className="mt-3 text-slate-300">
          TRAXR-SOLANA operates on a read-only data model derived from Solana pool inputs.
          The model separates source-backed fields from derived heuristics and embedded scoring signals.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Core Entities</h2>
        <ul className="mt-4 space-y-3 text-slate-300">
          <li>
            <b>Pool Program</b>
            <div className="text-slate-400 text-sm mt-1">Pool address, identifiers, program attribution, and fee metadata.</div>
          </li>
          <li>
            <b>Token Metadata</b>
            <div className="text-slate-400 text-sm mt-1">Token name, symbol, mint, decimals, and selected logo enrichment where available.</div>
          </li>
          <li>
            <b>Snapshot</b>
            <div className="text-slate-400 text-sm mt-1">Point-in-time capture of liquidity and volume metrics.</div>
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-lg sm:text-xl font-medium">Deterministic Data Model</h2>
        <p className="mt-3 text-slate-300">
          All TRAXR-SOLANA scores are derived from a single snapshot. No predictions, no trading features, and no wallet interactions.
        </p>
        <TraxrDataModelMap />
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Derived Metrics</h2>
        <p className="mt-3 text-slate-300">
          From core entities, TRAXR-SOLANA derives normalized heuristics such as liquidity depth,
          snapshot-history stability, and $1,000 quote-based price impact.
        </p>
      </section>

      <section className="mt-10 rounded-md border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg sm:text-xl font-medium">Scoring Signals (Embedded)</h2>
        <p className="mt-3 text-slate-300">
          Pool-only CTS signals (depth, activity, stability, trust, fee, impact) are computed in-app using the same logic as the backend scorer.
        </p>
        <p className="mt-3 text-slate-300">
          Exact impact is currently supported for AMM, CPMM, CLMM, Orca, and Meteora DLMM.
          Meteora DAMM v2 is currently modeled with local estimated impact.
        </p>
      </section>

      <section className="mt-10 rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-5">
        <h2 className="text-base sm:text-lg font-medium text-yellow-300">Current Operating Data Model</h2>
        <ul className="mt-3 list-disc pl-5 text-slate-300 space-y-1">
          <li>NodeZero snapshots cached in stamped JSON files</li>
          <li>Fetch-time local enrichment before final write</li>
          <li>Deterministic normalization over cached state</li>
          <li>CTS scoring handled in-app</li>
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Evolution (Optional)</h2>
        <p className="mt-3 text-slate-300">
          The target data model can evolve toward continuous indexing and automated ingestion without altering core entity definitions.
        </p>
      </section>

      <p className="mt-12 text-xs text-slate-500">
        Data structures are intentionally minimal to preserve auditability and reduce integration complexity while coverage continues to expand.
      </p>
    </>
  );
}
