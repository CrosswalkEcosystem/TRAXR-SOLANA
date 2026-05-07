"use client";

import { useState } from "react";

const presets = [
  {
    label: "Dataset",
    path: "/api/traxr/dataset?name=meteora-dammv2&limit=200&summary=true",
  },
  {
    label: "Score (pair)",
    path: "/api/traxr/score?mintA=STRK&mintB=USDC&dataset=meteora-dammv2",
  },
  {
    label: "Pool by id",
    path: "/api/traxr/pools/POOL_ID?dataset=meteora-dammv2",
  },
  {
    label: "Pool trend",
    path: "/api/traxr/pool-trend?poolId=POOL_ID&dataset=meteora-dammv2",
  },
  { label: "Alerts", path: "/api/traxr/alerts" },
];

export default function ApiTryPanel() {
  const [path, setPath] = useState(presets[0].path);
  const [status, setStatus] = useState<number | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    setStatus(null);
    setOutput("");
    setTruncated(false);

    try {
      const res = await fetch(path, { cache: "no-store" });
      setStatus(res.status);

      const text = await res.text();
      let nextOutput = text;
      try {
        const json = JSON.parse(text);
        nextOutput = JSON.stringify(json, null, 2);
      } catch {
        nextOutput = text;
      }

      const MAX_CHARS = 40000;
      if (nextOutput.length > MAX_CHARS) {
        setTruncated(true);
        nextOutput = `${nextOutput.slice(0, MAX_CHARS)}\n... (truncated)`;
      }

      requestAnimationFrame(() => {
        setOutput(nextOutput);
        setLoading(false);
      });
    } catch (e: any) {
      setError(e?.message || "Request failed");
      setLoading(false);
    } finally {
    }
  };

  return (
    <section className="mt-10 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-5">
      <h2 className="text-lg sm:text-xl font-medium text-cyan-200">
        Try the API
      </h2>
      <p className="mt-2 text-sm text-slate-300">
        Pick a preset or paste a path below. Replace placeholders like
        <span className="text-slate-100"> POOL_ID</span> or
        <span className="text-slate-100"> TOKEN_SYMBOL</span>.
        Use
        <span className="text-slate-100"> /api/traxr/dataset?name=...</span>
        for dataset slices, and add
        <span className="text-slate-100"> dataset=...</span> to pair score,
        pool, and trend calls when you want one explicit source.
        Large list endpoints are best used with a small
        <span className="text-slate-100"> limit</span>.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        Current snapshots include embedded stored volatility where available.
        Historical coverage varies by dataset and run age. The response viewer
        truncates large payloads to keep the page responsive.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setPath(preset.path)}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-200 hover:border-cyan-300/60 hover:text-white"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
          placeholder="/api/traxr/pools"
        />
        <button
          type="button"
          onClick={run}
          disabled={loading}
          className="rounded-md border border-cyan-300/40 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-200 hover:border-cyan-300 hover:bg-cyan-400/20 disabled:opacity-50"
        >
          {loading ? "Running..." : "Run"}
        </button>
      </div>

      <div className="mt-4 rounded-md border border-white/10 bg-black/30 p-3 text-xs text-slate-300">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Response</span>
          <span>{status ? `HTTP ${status}` : "Idle"}</span>
        </div>
        {loading ? (
          <div className="mt-4 flex items-center gap-3 text-slate-300">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-cyan-300/70 border-t-transparent" />
            <span>Loading response...</span>
          </div>
        ) : error ? (
          <div className="mt-2 text-red-300">{error}</div>
        ) : (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap">
            {output || "// Response will appear here"}
          </pre>
        )}
        {!loading && !error && truncated && (
          <div className="mt-2 text-[11px] text-slate-500">
            Output truncated to keep the page responsive.
          </div>
        )}
      </div>
    </section>
  );
}
