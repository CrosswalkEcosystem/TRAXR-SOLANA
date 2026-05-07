export default function TraxrDataModelMap() {
  const nodes = [
    { label: "Pool Program", x: 250, y: 60 },
    { label: "Activity Signals", x: 410, y: 190 },
    { label: "Derived Metrics", x: 250, y: 320 },
    { label: "Trust Signals", x: 90, y: 190 },
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
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>

          <filter id="softGlow">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        <circle
          cx="250"
          cy="190"
          r="125"
          fill="none"
          stroke="#38bdf8"
          strokeOpacity="0.25"
          strokeWidth="2"
          strokeDasharray="6 6"
        />

        <circle cx="250" cy="190" r="62" fill="url(#centerGlow)" />
        <text
          x="250"
          y="180"
          textAnchor="middle"
          fill="#e5e7eb"
          fontSize="13"
          fontWeight="600"
        >
          Snapshot
        </text>
        <text
          x="250"
          y="198"
          textAnchor="middle"
          fill="#94a3b8"
          fontSize="10"
        >
          Deterministic Solana state
        </text>

        {nodes.map((n, i) => (
          <g key={i}>
            <rect
              x={n.x - 60}
              y={n.y - 20}
              rx="14"
              ry="14"
              width="120"
              height="40"
              fill="rgba(56,189,248,0.08)"
              stroke="#38bdf8"
              strokeOpacity="0.5"
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
        Snapshot-based data model - deterministic inputs - reproducible metrics
      </p>
    </div>
  );
}
