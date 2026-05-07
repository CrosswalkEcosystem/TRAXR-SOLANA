import ApiTryPanel from "@/components/ApiTryPanel";

export function ApiDocContent() {
  return (
    <>
      <section className="mt-12">
        <h2 className="text-lg sm:text-xl font-medium">Base URL</h2>
        <p className="mt-3 text-slate-300">
          Local development: <span className="text-slate-100">/api/traxr</span>
        </p>
        <p className="mt-2 text-slate-300">
          All responses are JSON. Error payloads use
          <span className="text-slate-100"> {"{ error: \"...\" }"}</span>.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg sm:text-xl font-medium">Endpoints</h2>
        <div className="mt-4 space-y-4 text-slate-300">
          <div>
            <div className="font-medium text-slate-100">GET /api/traxr/dataset?name=...</div>
            <div className="text-sm text-slate-400">
              Returns the current dataset slice for the requested source.
              Supports <span className="text-slate-100">limit</span>,
              <span className="text-slate-100"> offset</span>, and
              <span className="text-slate-100"> summary=true</span>.
            </div>
          </div>
          <div>
            <div className="font-medium text-slate-100">GET /api/traxr/score?mintA=...&amp;mintB=...&amp;dataset=...</div>
            <div className="text-sm text-slate-400">Returns the scored pool for a token pair from the selected dataset.</div>
          </div>
          <div>
            <div className="font-medium text-slate-100">GET /api/traxr/pools/:id</div>
            <div className="text-sm text-slate-400">Returns a single pool by poolId. Add <span className="text-slate-100">?dataset=...</span> for explicit source selection.</div>
          </div>
          <div>
            <div className="font-medium text-slate-100">GET /api/traxr/pool-trend?poolId=...</div>
            <div className="text-sm text-slate-400">Returns time-series snapshots for a pool.</div>
          </div>
          <div>
            <div className="font-medium text-slate-100">GET /api/traxr/alerts</div>
            <div className="text-sm text-slate-400">Returns pools with active warnings from the current snapshot.</div>
          </div>
        </div>
      </section>

      <ApiTryPanel />

      <section className="mt-10 rounded-md border border-white/10 bg-white/5 p-4">
        <h2 className="text-lg sm:text-xl font-medium">Operational Notes</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-slate-300">
          <li>Snapshot-backed data from NodeZero.</li>
          <li>Exact impact currently covers AMM, CPMM, CLMM, Orca, and Meteora DLMM.</li>
          <li>Meteora DAMM v2 currently exposes estimated $1k impact, not exact routed quotes.</li>
          <li>PumpSwap currently exposes estimated $1k impact, not exact routed quotes.</li>
          <li>Stored volatility is embedded in current snapshots; historical coverage depends on dataset age.</li>
          <li>Derived heuristics remain best-effort where exact depth is unavailable.</li>
        </ul>
      </section>
    </>
  );
}
