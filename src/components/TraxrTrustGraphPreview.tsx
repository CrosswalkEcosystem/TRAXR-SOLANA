"use client";

import { useEffect, useMemo, useState } from "react";

type Point3D = {
  id: number;
  x: number;
  y: number;
  z: number;
  tier: number;
};

function makePoints(count: number) {
  const points: Point3D[] = [];
  let seed = 24;

  const nextRand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let i = 0; i < count; i += 1) {
    points.push({
      id: i,
      x: nextRand() * 2 - 1,
      y: nextRand() * 2 - 1,
      z: nextRand() * 2 - 1,
      tier: 1 + Math.floor(nextRand() * 6),
    });
  }

  return points;
}

function projectPoint(
  point: Point3D,
  width: number,
  height: number,
  yaw: number,
  pitch: number,
  zoom: number,
) {
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  const xYaw = point.x * cosYaw + point.z * sinYaw;
  const zYaw = -point.x * sinYaw + point.z * cosYaw;
  const yPitch = point.y * cosPitch - zYaw * sinPitch;
  const zPitch = point.y * sinPitch + zYaw * cosPitch;

  const perspective = 3.1;
  const scale = (perspective / Math.max(0.7, perspective - zPitch)) * zoom;

  return {
    x: width * 0.5 + xYaw * width * 0.28 * scale,
    y: height * 0.54 - yPitch * height * 0.26 * scale,
    depth: zPitch,
    size: Math.max(2.4, 5.2 * scale),
  };
}

export function TraxrTrustGraphPreview() {
  const [yaw, setYaw] = useState(-0.6);
  const [pitch, setPitch] = useState(0.32);
  const [isMobile, setIsMobile] = useState(false);
  const [staticMode, setStaticMode] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const lowEndCpu = (navigator.hardwareConcurrency || 8) <= 4;
    const lowEndMemory =
      typeof (navigator as Navigator & { deviceMemory?: number }).deviceMemory === "number" &&
      ((navigator as Navigator & { deviceMemory?: number }).deviceMemory || 8) <= 4;

    const update = () => {
      const mobile = media.matches;
      const shouldStatic = mobile || motion.matches || lowEndCpu || lowEndMemory;
      setIsMobile(mobile);
      setStaticMode(shouldStatic);
    };

    update();
    media.addEventListener("change", update);
    motion.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      motion.removeEventListener("change", update);
    };
  }, []);

  useEffect(() => {
    if (staticMode) return;
    let frame = 0;
    let raf = 0;
    const tick = () => {
      frame += 1;
      setYaw((prev) => prev + 0.0012);
      if (frame % 3 === 0) {
        setPitch((prev) => Math.max(-0.62, Math.min(0.62, prev + 0.00012)));
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [staticMode]);

  const points = useMemo(() => makePoints(staticMode ? 28 : 56), [staticMode]);
  const scene = useMemo(() => {
    const width = 960;
    const height = 440;

    const projected = points
      .map((point) => ({
        point,
        p: projectPoint(point, width, height, yaw, pitch, 0.94),
      }))
      .sort((a, b) => a.p.depth - b.p.depth);

    return {
      width,
      height,
      projected,
    };
  }, [pitch, points, yaw]);

  return (
    <div className="relative overflow-hidden rounded-[1.25rem] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(7,13,23,0.9),rgba(9,17,30,0.84))] p-2 sm:p-3">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.09),transparent_30%)]" />
      <div className="relative">
        <svg
          viewBox={`0 0 ${scene.width} ${scene.height}`}
          className={[
            "w-full rounded-[1rem] border border-white/8 bg-[#050b14]/74",
            isMobile ? "h-[200px]" : "h-[260px] sm:h-[300px]",
          ].join(" ")}
          style={{ opacity: 0.88, filter: "saturate(0.82)" }}
        >
          <defs>
            <linearGradient id="tg-axis" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(103,232,249,0.42)" />
              <stop offset="100%" stopColor="rgba(30,64,175,0.08)" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={scene.width} height={scene.height} fill="rgba(3,8,16,0.54)" />

          <line x1="120" y1="360" x2="850" y2="360" stroke="url(#tg-axis)" strokeWidth="1" />
          <line x1="120" y1="360" x2="120" y2="72" stroke="url(#tg-axis)" strokeWidth="1" />
          <line x1="120" y1="360" x2="320" y2="120" stroke="url(#tg-axis)" strokeWidth="1" />

          {scene.projected.map(({ point, p }) => (
            <circle
              key={point.id}
              cx={p.x}
              cy={p.y}
              r={p.size}
              fill={
                point.tier >= 5
                  ? "rgba(45,212,191,0.6)"
                  : point.tier >= 3
                    ? "rgba(125,211,252,0.55)"
                    : "rgba(251,191,36,0.5)"
              }
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="0.28"
            />
          ))}

          <text x="846" y="350" fill="rgba(255,255,255,0.45)" fontSize="11" letterSpacing="2">
            SCORE
          </text>
          <text x="76" y="82" fill="rgba(255,255,255,0.45)" fontSize="11" letterSpacing="2">
            LIQUIDITY
          </text>
          <text x="332" y="116" fill="rgba(255,255,255,0.45)" fontSize="11" letterSpacing="2">
            CTS TIER
          </text>
        </svg>
        {staticMode ? (
          <div className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[0.58rem] uppercase tracking-[0.16em] text-white/50">
            Static preview
          </div>
        ) : null}
      </div>
    </div>
  );
}
