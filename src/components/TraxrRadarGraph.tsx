"use client";

import { useId, useState } from "react";

type Props = {
  nodes?: Record<string, number>;
  score?: number;
  size?: number;
};

export function TraxrRadarGraph({ nodes, score = 0, size = 220 }: Props) {
  if (!nodes) return null;
  const gradientId = useId();
  const [hover, setHover] = useState<{ dim: string; value: number } | null>(null);
  const displayScore = Math.round(score);
  const dims = ["depth", "activity", "impact", "stability", "trust", "fee"];
  const radius = Math.round(size * 0.4);
  const center = size / 2;
  const points = dims.map((dim, i) => {
    const angle = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
    const value = Math.max(0, Math.min(100, nodes[dim] ?? 0)) / 100;
    const r = radius * value;
    return {
      x: center + r * Math.cos(angle),
      y: center + r * Math.sin(angle),
      dim,
    };
  });
  const path = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="flex items-center justify-center">
      <svg width={size} height={size} className="overflow-visible text-white/50">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
        />
        <circle
          cx={center}
          cy={center}
          r={radius * 0.65}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
        />
        <circle
          cx={center}
          cy={center}
          r={radius * 0.35}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
        />
        <polygon
          points={path}
          fill={`url(#${gradientId})`}
          stroke="rgba(0,255,200,0.55)"
          strokeWidth={2}
          opacity={0.85}
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(34,197,94,0.35)" />
            <stop offset="100%" stopColor="rgba(14,165,233,0.25)" />
          </linearGradient>
        </defs>
        {points.map((p, idx) => (
          <g
            key={p.dim}
            onMouseEnter={() => setHover({ dim: p.dim, value: nodes[p.dim] ?? 0 })}
            onMouseLeave={() => setHover(null)}
            onTouchStart={() => setHover({ dim: p.dim, value: nodes[p.dim] ?? 0 })}
            onTouchEnd={() => setHover(null)}
          >
            <line
              x1={center}
              y1={center}
              x2={
                center +
                radius *
                  Math.cos((Math.PI * 2 * idx) / dims.length - Math.PI / 2)
              }
              y2={
                center +
                radius *
                  Math.sin((Math.PI * 2 * idx) / dims.length - Math.PI / 2)
              }
              stroke="rgba(255,255,255,0.08)"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={hover?.dim === p.dim ? 5 : 3.5}
              fill={hover?.dim === p.dim ? "rgba(34,197,94,1)" : "rgba(34,197,94,0.9)"}
              stroke={hover?.dim === p.dim ? "rgba(255,255,255,0.8)" : "none"}
              strokeWidth={hover?.dim === p.dim ? 1.5 : 0}
            />
            <text
              x={
                center +
                (radius + 20) *
                  Math.cos((Math.PI * 2 * idx) / dims.length - Math.PI / 2)
              }
              y={
                center +
                (radius + 20) *
                  Math.sin((Math.PI * 2 * idx) / dims.length - Math.PI / 2)
              }
              textAnchor="middle"
              className="fill-white/60 text-[10px] sm:text-[11px]"
            >
              {p.dim.toUpperCase()}
            </text>
          </g>
        ))}
        <text
          x={center}
          y={center}
          textAnchor="middle"
          className="fill-white text-2xl sm:text-3xl font-semibold"
        >
          {displayScore}
        </text>
        <text
          x={center}
          y={center + 18}
          textAnchor="middle"
          className="fill-white/60 text-[10px] sm:text-[11px] uppercase tracking-[0.16em]"
        >
          TRAXR Score
        </text>
        {hover ? (
          <g>
            <rect
              x={center - 60}
              y={center - radius - 26}
              width={120}
              height={22}
              rx={8}
              ry={8}
              fill="rgba(0,0,0,0.75)"
              stroke="rgba(0,255,200,0.4)"
            />
            <text
              x={center}
              y={center - radius - 11}
              textAnchor="middle"
              className="fill-white text-[11px]"
            >
              {hover.dim.toUpperCase()}: {hover.value.toFixed(0)}
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
