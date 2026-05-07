type Props = {
  score: number;
  label?: string;
  size?: "sm" | "md" | "lg";
};

const sizeMap = {
  sm: { w: 80, h: 80 },
  md: { w: 120, h: 120 },
  lg: { w: 160, h: 160 },
};

// TRAXR badge renders a semi-circle gauge with TRAXR score.
export function TraxrBadge({ score, label, size = "md" }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const displayScore = Math.round(clamped);
  const { w, h } = sizeMap[size];
  const radius = Math.min(w, h) / 2 - 16;
  const centerX = w / 2;
  const centerY = h / 2;
  const circumference = 2 * Math.PI * radius;
  const dashArray = `${circumference} ${circumference}`;
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <div className="relative flex flex-col items-center gap-2">
      <div className="text-[11px] uppercase tracking-[0.22em] text-white/60">
        {label || "TRAXR SCORE"}
      </div>
      <div className="relative overflow-visible rounded-2xl bg-transparent" style={{ width: w, height: h }}>
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
          <defs>
            <linearGradient id="traxr-gauge" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="45%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
          {/* Track */}
          <circle
            cx={centerX}
            cy={centerY}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={10}
          />
          {/* Progress */}
          <circle
            cx={centerX}
            cy={centerY}
            r={radius}
            fill="none"
            stroke="url(#traxr-gauge)"
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={dashArray}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${centerX} ${centerY})`}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
          {/* Number */}
          <text x={centerX} y={centerY + 8} textAnchor="middle" className="fill-white font-semibold" fontSize="24">
            {displayScore}
          </text>
        </svg>
      </div>
    </div>
  );
}
