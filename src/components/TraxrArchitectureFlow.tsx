export default function TraxrArchitectureLoop() {
  const nodes = [
    { label: "Solana Pools", x: 250, y: 40 },
    { label: "NodeZero", x: 420, y: 140 },
    { label: "Local Enrichment", x: 340, y: 300 },
    { label: "CTS Scoring", x: 160, y: 300 },
    { label: "UI + API", x: 80, y: 140 },
  ];

  return (
    <div className="mt-12 w-full">
      <svg
        viewBox="0 0 500 380"
        className="w-full max-w-[520px] mx-auto"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id="centerGlow">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>

          <filter id="softGlow">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        <circle
          cx="250"
          cy="190"
          r="120"
          fill="none"
          stroke="#38bdf8"
          strokeOpacity="0.25"
          strokeWidth="2"
          strokeDasharray="6 6"
        />

        <path
          d="M250 70 A120 120 0 1 1 249 70"
          fill="none"
          stroke="#38bdf8"
          strokeOpacity="0.4"
          strokeWidth="2"
          markerEnd="url(#arrow)"
        />

        <defs>
          <marker
            id="arrow"
            markerWidth="6"
            markerHeight="6"
            refX="5"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 Z" fill="#38bdf8" />
          </marker>
        </defs>

        <circle cx="250" cy="190" r="58" fill="url(#centerGlow)" />
        <text
          x="250"
          y="182"
          textAnchor="middle"
          fill="#e5e7eb"
          fontSize="12"
          fontWeight="600"
        >
          TRAXR SNAPSHOTS
        </text>
        <text
          x="250"
          y="198"
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="10"
        >
          Stamped · Enriched · Deterministic
        </text>

        {nodes.map((n, i) => (
          <g key={i}>
            <rect
              x={n.x - 55}
              y={n.y - 20}
              rx="12"
              ry="12"
              width="110"
              height="40"
              fill="rgba(56,189,248,0.08)"
              stroke="#38bdf8"
              strokeOpacity="0.6"
              filter="url(#softGlow)"
            />
            <text
              x={n.x}
              y={n.y + 4}
              textAnchor="middle"
              fill="#e5e7eb"
              fontSize="11"
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>

      <p className="mt-4 text-center text-xs text-slate-400">
        Read-only pipeline: NodeZero ingest, local enrichment, CTS scoring, and distribution
      </p>
    </div>
  );
}
