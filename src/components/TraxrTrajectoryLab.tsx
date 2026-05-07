"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiCompass, FiInfo, FiLayers, FiRotateCcw, FiSliders, FiZoomIn, FiZoomOut } from "react-icons/fi";
import { PoolCombobox } from "@/components/PoolCombobox";
import { TraxrScoreResult, TraxrTrendPoint } from "@/lib/types";

type AxisKey = "time" | "score" | "liquidity" | "volume24h" | "impact";
type DatasetKey =
  | "amm"
  | "clmm"
  | "cpmm"
  | "orca"
  | "pumpswap"
  | "meteora"
  | "meteora-dammv2";
type ControlPanelKey = "dataset" | "axes" | "view" | "info" | null;

const axisOptions: { key: AxisKey; label: string }[] = [
  { key: "time", label: "Time" },
  { key: "score", label: "TRAXR Score" },
  { key: "liquidity", label: "Liquidity" },
  { key: "volume24h", label: "24h Volume" },
  { key: "impact", label: "Impact" },
];

const datasetOptions: { key: DatasetKey; label: string }[] = [
  { key: "amm", label: "Raydium AMM" },
  { key: "clmm", label: "Raydium CLMM" },
  { key: "cpmm", label: "Raydium CPMM" },
  { key: "orca", label: "Orca" },
  { key: "pumpswap", label: "PumpSwap" },
  { key: "meteora", label: "Meteora DLMM" },
  { key: "meteora-dammv2", label: "Meteora DAMM v2" },
];

const defaultPoolByDataset: Record<DatasetKey, string> = {
  amm: "7BbZ9gu8ks5yAwRNx7oMc4otpZVunvyJqCS4rywpD7L6",
  clmm: "",
  cpmm: "",
  orca: "",
  pumpswap: "",
  meteora: "",
  "meteora-dammv2": "",
};

function formatMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 100000 ? "compact" : "standard",
    maximumFractionDigits: value >= 100000 ? 1 : 0,
  }).format(value);
}

function formatPct(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(value < 0.1 ? 3 : 2)}%`;
}

function tokenLabel(pool?: TraxrScoreResult | null) {
  if (!pool) return "Select a pool";
  const symbolA = pool.tokenASymbol || pool.tokenAName || pool.metrics.mintA.slice(0, 4);
  const symbolB = pool.tokenBSymbol || pool.tokenBName || pool.metrics.mintB.slice(0, 4);
  return `${symbolA}/${symbolB}`;
}

function getAxisValue(point: TraxrTrendPoint, axis: AxisKey) {
  switch (axis) {
    case "time":
      return null;
    case "score":
      return typeof point.score === "number" ? point.score : null;
    case "liquidity":
      return typeof point.metrics.liquidityUsd === "number"
        ? point.metrics.liquidityUsd
        : null;
    case "volume24h":
      return typeof point.metrics.volume24hUsd === "number"
        ? point.metrics.volume24hUsd
        : null;
    case "impact":
      return typeof point.metrics.priceImpactPct === "number"
        ? point.metrics.priceImpactPct
        : null;
    default:
      return null;
  }
}

function projectPoint(
  xNorm: number,
  yNorm: number,
  zNorm: number,
  width: number,
  height: number,
  yaw: number,
  pitch: number,
  view?: {
    centerShiftX?: number;
    centerShiftY?: number;
    zoom?: number;
    roll?: number;
  },
) {
  const centerX = width * 0.48 + (view?.centerShiftX || 0);
  const centerY = height * 0.56 + (view?.centerShiftY || 0);
  const zoom = view?.zoom || 1;
  const x = (xNorm - 0.5) * (width * 0.62) * zoom;
  const y = (yNorm - 0.5) * (height * 0.5) * zoom;
  const z = (zNorm - 0.5) * 320 * zoom;

  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  const xYaw = x * cosYaw + z * sinYaw;
  const zYaw = -x * sinYaw + z * cosYaw;
  const yPitch = y * cosPitch - zYaw * sinPitch;
  const zPitch = y * sinPitch + zYaw * cosPitch;

  const perspective = 980;
  const scale = perspective / Math.max(240, perspective - zPitch);
  const baseX = centerX + xYaw * scale;
  const baseY = centerY - yPitch * scale;
  const roll = view?.roll || 0;
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);
  const dxRoll = baseX - centerX;
  const dyRoll = baseY - centerY;

  return {
    x: centerX + dxRoll * cosRoll - dyRoll * sinRoll,
    y: centerY + dxRoll * sinRoll + dyRoll * cosRoll,
  };
}

function buildSegments(points: Array<{ x: number; y: number }>) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(" ");
}

type TraxrTrajectoryLabProps = {
  preview?: boolean;
  heroShowcase?: boolean;
  heroKeyword?: "Depth" | "Stability" | "Risk";
};

export function TraxrTrajectoryLab({
  preview = false,
  heroShowcase = false,
  heroKeyword,
}: TraxrTrajectoryLabProps = {}) {
  const [dataset, setDataset] = useState<DatasetKey>("amm");
  const [activePanel, setActivePanel] = useState<ControlPanelKey>(null);
  const [pools, setPools] = useState<TraxrScoreResult[]>([]);
  const [poolId, setPoolId] = useState(defaultPoolByDataset.amm);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<TraxrScoreResult[] | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const [trend, setTrend] = useState<TraxrTrendPoint[]>([]);
  const [axes, setAxes] = useState<{ x: AxisKey; y: AxisKey; z: AxisKey }>({
    x: "time",
    y: "score",
    z: "liquidity",
  });
  const [loadingPools, setLoadingPools] = useState(false);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [yaw, setYaw] = useState(-0.72);
  const [pitch, setPitch] = useState(0.34);
  const [zoom, setZoom] = useState(1);
  const [drawVersion, setDrawVersion] = useState(0);
  const [showcaseFading, setShowcaseFading] = useState(false);
  const [heroLineProgress, setHeroLineProgress] = useState(1);
  const [heroRoll, setHeroRoll] = useState(0);
  const [heroView, setHeroView] = useState({
    shiftX: 0,
    shiftY: 0,
    zoom: 1.28,
  });
  const dragRef = useRef<{
    mode: "idle" | "rotate" | "pinch";
    pointerId: number | null;
    pointerType: string | null;
    startX: number;
    startY: number;
    startYaw: number;
    startPitch: number;
    startDistance: number;
    startZoom: number;
  }>({
    mode: "idle",
    pointerId: null,
    pointerType: null,
    startX: 0,
    startY: 0,
    startYaw: 0,
    startPitch: 0,
    startDistance: 0,
    startZoom: 1,
  });
  const touchPointsRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  useEffect(() => {
    if (!preview || !heroShowcase) return;
    setYaw(-0.88);
    setPitch(0.3);
    setHeroRoll(0);
    setHeroView({ shiftX: 0, shiftY: 0, zoom: 1.12 });
  }, [drawVersion, heroShowcase, preview]);

  useEffect(() => {
    if (!preview || !heroShowcase) return;
    let raf = 0;
    const started = performance.now();
    const tick = (ts: number) => {
      const t = (ts - started) / 1000;
      setYaw(-0.88 + t * 0.018);
      setPitch(0.3 + Math.sin(t * 0.22) * 0.05);
      setHeroRoll(Math.sin(t * 0.18) * 0.03);
      setHeroView((prev) => ({
        shiftX: prev.shiftX + (Math.sin(t * 0.16) * 8 - prev.shiftX) * 0.07,
        shiftY: prev.shiftY + (Math.cos(t * 0.14) * 5 - prev.shiftY) * 0.07,
        zoom: prev.zoom + (1.12 - prev.zoom) * 0.07,
      }));
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [heroShowcase, preview]);

  useEffect(() => {
    if (!preview || !heroShowcase) return;
    if (heroKeyword) return;
    const axisShowcase: Array<{ x: AxisKey; y: AxisKey; z: AxisKey }> = [
      { x: "time", y: "score", z: "liquidity" },
      { x: "time", y: "liquidity", z: "impact" },
      { x: "time", y: "volume24h", z: "score" },
      { x: "score", y: "impact", z: "liquidity" },
      { x: "time", y: "score", z: "impact" },
    ];
    let index = 0;
    let switchTimeout: number | null = null;
    let revealTimeout: number | null = null;
    const applyPreset = () => {
      const nextAxes = axisShowcase[index % axisShowcase.length];
      setAxes((current) =>
        current.x === nextAxes.x && current.y === nextAxes.y && current.z === nextAxes.z
          ? current
          : nextAxes,
      );
      setDrawVersion((value) => value + 1);
      index += 1;
    };
    applyPreset();
    const timer = window.setInterval(() => {
      setShowcaseFading(true);
      switchTimeout = window.setTimeout(() => {
        applyPreset();
        revealTimeout = window.setTimeout(() => {
          setShowcaseFading(false);
        }, 420);
      }, 860);
    }, 5800);
    return () => {
      window.clearInterval(timer);
      if (switchTimeout !== null) window.clearTimeout(switchTimeout);
      if (revealTimeout !== null) window.clearTimeout(revealTimeout);
    };
  }, [heroKeyword, heroShowcase, preview]);

  useEffect(() => {
    if (!preview || !heroShowcase || !heroKeyword) return;
    const heroPresetByWord: Record<
      "Depth" | "Stability" | "Risk",
      { x: AxisKey; y: AxisKey; z: AxisKey }
    > = {
      Depth: { x: "time", y: "liquidity", z: "volume24h" },
      Stability: { x: "time", y: "score", z: "impact" },
      Risk: { x: "score", y: "impact", z: "liquidity" },
    };
    setShowcaseFading(true);
    const nextAxes = heroPresetByWord[heroKeyword];
    let revealTimeout: number | null = null;
    const switchTimeout = window.setTimeout(() => {
      setAxes((current) =>
        current.x === nextAxes.x && current.y === nextAxes.y && current.z === nextAxes.z
          ? current
          : nextAxes,
      );
      setDrawVersion((value) => value + 1);
      revealTimeout = window.setTimeout(() => {
        setShowcaseFading(false);
      }, 420);
    }, 860);
    return () => {
      window.clearTimeout(switchTimeout);
      if (revealTimeout !== null) window.clearTimeout(revealTimeout);
    };
  }, [heroKeyword, heroShowcase, preview]);

  useEffect(() => {
    if (!preview || !heroShowcase) return;
    let raf = 0;
    const started = performance.now();
    const durationMs = 3600;
    setHeroLineProgress(0);
    const tick = (ts: number) => {
      const progress = Math.min(1, (ts - started) / durationMs);
      setHeroLineProgress(progress);
      if (progress < 1) {
        raf = window.requestAnimationFrame(tick);
      }
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [drawVersion, heroShowcase, preview]);

  useEffect(() => {
    let cancelled = false;
    setLoadingPools(true);
    setError(null);
    fetch(`/api/traxr/dataset?name=${dataset}&limit=120&offset=0`, {
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const nextPools = Array.isArray(json?.pools) ? json.pools : [];
        setPools(nextPools);
        const preferred = defaultPoolByDataset[dataset];
        const nextSelected =
          nextPools.find((pool: TraxrScoreResult) => pool.poolId === preferred)?.poolId ||
          nextPools[0]?.poolId ||
          "";
        setPoolId(nextSelected);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPools([]);
          setPoolId("");
          setError(e instanceof Error ? e.message : "Failed to load pools");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingPools(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset]);

  useEffect(() => {
    const queryTrimmed = query.trim();
    if (queryTrimmed.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/traxr/search?q=${encodeURIComponent(queryTrimmed)}&limit=100&dataset=${encodeURIComponent(dataset)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setSearchResults(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dataset, query]);

  useEffect(() => {
    if (!poolId) {
      setTrend([]);
      return;
    }
    let cancelled = false;
    setLoadingTrend(true);
    setError(null);
    fetch(`/api/traxr/pool-trend?poolId=${encodeURIComponent(poolId)}`, {
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setTrend(Array.isArray(json) ? json : []);
          setHoverIndex(null);
          setDrawVersion((value) => value + 1);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setTrend([]);
          setError(e instanceof Error ? e.message : "Failed to load trend");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingTrend(false);
      });
    return () => {
      cancelled = true;
    };
  }, [poolId]);

  const selectablePools = query.trim().length >= 2 ? searchResults ?? [] : pools;
  const selectedPool =
    selectablePools.find((pool) => pool.poolId === poolId) ||
    pools.find((pool) => pool.poolId === poolId) ||
    selectablePools[0] ||
    pools[0] ||
    null;

  const sceneView = useMemo(
    () =>
      preview && heroShowcase
        ? {
            centerShiftX: heroView.shiftX,
            centerShiftY: heroView.shiftY,
            zoom: heroView.zoom,
            roll: heroRoll,
          }
        : preview
          ? undefined
          : { zoom },
    [heroRoll, heroShowcase, heroView.shiftX, heroView.shiftY, heroView.zoom, preview, zoom],
  );

  const toolbarButtons = [
    { key: "dataset" as const, label: "Dataset", icon: FiLayers },
    { key: "axes" as const, label: "Axes", icon: FiSliders },
    { key: "view" as const, label: "View", icon: FiCompass },
    { key: "info" as const, label: "Info", icon: FiInfo },
  ];

  const scene = useMemo(() => {
    const width = 1080;
    const height = 680;
    if (!trend.length) {
      return {
        width,
        height,
        path: "",
        points: [] as Array<
          TraxrTrendPoint & {
            screenX: number;
            screenY: number;
            xValue: number | null;
            yValue: number | null;
            zValue: number | null;
          }
        >,
        mins: { x: 0, y: 0, z: 0 },
        maxs: { x: 0, y: 0, z: 0 },
      };
    }

    function axisStats(axis: AxisKey) {
      if (axis === "time") {
        const max = Math.max(1, trend.length - 1);
        return { min: 0, max, range: max };
      }
      const values = trend
        .map((point) => getAxisValue(point, axis))
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 1;
      return { min, max, range: Math.max(1e-9, max - min) };
    }

    const xStats = axisStats(axes.x);
    const yStats = axisStats(axes.y);
    const zStats = axisStats(axes.z);

    const points = trend.map((point, index) => {
      const xValue = axes.x === "time" ? index : getAxisValue(point, axes.x);
      const yValue = axes.y === "time" ? index : getAxisValue(point, axes.y);
      const zValue = axes.z === "time" ? index : getAxisValue(point, axes.z);
      const xNorm =
        typeof xValue === "number" && Number.isFinite(xValue)
          ? (xValue - xStats.min) / xStats.range
          : 0;
      const yNorm =
        typeof yValue === "number" && Number.isFinite(yValue)
          ? (yValue - yStats.min) / yStats.range
          : 0;
      const zNorm =
        typeof zValue === "number" && Number.isFinite(zValue)
          ? (zValue - zStats.min) / zStats.range
          : 0;
      const projected = projectPoint(
        xNorm,
        yNorm,
        zNorm,
        width,
        height,
        yaw,
        pitch,
        sceneView,
      );
      return {
        ...point,
        screenX: projected.x,
        screenY: projected.y,
        xValue,
        yValue,
        zValue,
      };
    });

    return {
      width,
      height,
      path: buildSegments(points.map((point) => ({ x: point.screenX, y: point.screenY }))),
      points,
      mins: { x: xStats.min, y: yStats.min, z: zStats.min },
      maxs: { x: xStats.max, y: yStats.max, z: zStats.max },
    };
  }, [axes, pitch, sceneView, trend, yaw]);

  const activeIndex = hoverIndex ?? Math.max(0, scene.points.length - 1);
  const activePoint = scene.points[activeIndex] || null;
  const latestPoint = scene.points[scene.points.length - 1] || null;
  const heroNodeRevealThresholds = useMemo(() => {
    if (!scene.points.length) return [] as number[];
    if (scene.points.length === 1) return [0];
    let totalDistance = 0;
    const cumulative: number[] = [0];
    for (let index = 1; index < scene.points.length; index += 1) {
      const prev = scene.points[index - 1];
      const current = scene.points[index];
      const dx = current.screenX - prev.screenX;
      const dy = current.screenY - prev.screenY;
      totalDistance += Math.hypot(dx, dy);
      cumulative.push(totalDistance);
    }
    if (totalDistance <= 1e-6) {
      return scene.points.map((_, index) => index / (scene.points.length - 1));
    }
    return cumulative.map((distance) => distance / totalDistance);
  }, [scene.points]);
  const heroAxisLabelPositions = useMemo(() => {
    const projectedView =
      preview && heroShowcase
        ? {
            centerShiftX: heroView.shiftX,
            centerShiftY: heroView.shiftY,
            zoom: heroView.zoom,
            roll: heroRoll,
          }
        : undefined;
    const xEnd = projectPoint(
      1,
      0,
      0,
      scene.width,
      scene.height,
      yaw,
      pitch,
      projectedView,
    );
    const yEnd = projectPoint(
      0,
      1,
      0,
      scene.width,
      scene.height,
      yaw,
      pitch,
      projectedView,
    );
    const zEnd = projectPoint(
      1,
      0,
      1,
      scene.width,
      scene.height,
      yaw,
      pitch,
      projectedView,
    );
    return {
      x: { x: xEnd.x + 14, y: xEnd.y + 12 },
      y: { x: yEnd.x - 16, y: yEnd.y - 10 },
      z: { x: zEnd.x + 12, y: zEnd.y - 6 },
    };
  }, [
    heroRoll,
    heroShowcase,
    heroView.shiftX,
    heroView.shiftY,
    heroView.zoom,
    pitch,
    preview,
    scene.height,
    scene.width,
    yaw,
  ]);
  const sceneAxisLabelPositions = useMemo(() => {
    const xEnd = projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch, sceneView);
    const yEnd = projectPoint(0, 1, 0, scene.width, scene.height, yaw, pitch, sceneView);
    const zEnd = projectPoint(1, 0, 1, scene.width, scene.height, yaw, pitch, sceneView);
    return {
      x: { x: xEnd.x + 14, y: xEnd.y + 12, anchor: "start" as const },
      y: { x: yEnd.x - 16, y: yEnd.y - 10, anchor: "end" as const },
      z: { x: zEnd.x + 12, y: zEnd.y - 6, anchor: "start" as const },
    };
  }, [pitch, scene.height, scene.width, sceneView, yaw]);

  function clampZoom(nextZoom: number) {
    return Math.max(0.72, Math.min(2.4, nextZoom));
  }

  function beginRotateGesture(
    pointerId: number,
    pointerType: string,
    startX: number,
    startY: number,
  ) {
    dragRef.current = {
      mode: "rotate",
      pointerId,
      pointerType,
      startX,
      startY,
      startYaw: yaw,
      startPitch: pitch,
      startDistance: 0,
      startZoom: zoom,
    };
  }

  function beginPinchGesture() {
    const points = Array.from(touchPointsRef.current.values());
    if (points.length < 2) return;
    const [a, b] = points;
    dragRef.current = {
      mode: "pinch",
      pointerId: null,
      pointerType: "touch",
      startX: (a.x + b.x) / 2,
      startY: (a.y + b.y) / 2,
      startYaw: yaw,
      startPitch: pitch,
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startZoom: zoom,
    };
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    if (preview && heroShowcase) return;
    event.preventDefault();
    const sensitivity = event.ctrlKey ? 0.004 : 0.0018;
    setZoom((current) => clampZoom(current - event.deltaY * sensitivity));
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touchPointsRef.current.size >= 2) {
        beginPinchGesture();
      } else {
        beginRotateGesture(event.pointerId, event.pointerType, event.clientX, event.clientY);
      }
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    beginRotateGesture(event.pointerId, event.pointerType, event.clientX, event.clientY);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") {
      if (!touchPointsRef.current.has(event.pointerId)) return;
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (touchPointsRef.current.size >= 2) {
        if (dragRef.current.mode !== "pinch") beginPinchGesture();
        const points = Array.from(touchPointsRef.current.values());
        const [a, b] = points;
        const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        setZoom(clampZoom(dragRef.current.startZoom * (distance / dragRef.current.startDistance)));
        return;
      }

      if (dragRef.current.mode !== "rotate" || dragRef.current.pointerId !== event.pointerId) {
        return;
      }
    } else if (
      dragRef.current.pointerId !== event.pointerId ||
      dragRef.current.pointerType !== event.pointerType ||
      dragRef.current.mode !== "rotate"
    ) {
      return;
    }

    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    setYaw(dragRef.current.startYaw + deltaX * 0.008);
    setPitch(Math.max(-0.9, Math.min(0.9, dragRef.current.startPitch - deltaY * 0.006)));
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === "touch") {
      touchPointsRef.current.delete(event.pointerId);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (touchPointsRef.current.size >= 2) {
        beginPinchGesture();
        return;
      }
      if (touchPointsRef.current.size === 1) {
        const [[pointerId, point]] = Array.from(touchPointsRef.current.entries());
        beginRotateGesture(pointerId, "touch", point.x, point.y);
        return;
      }
      dragRef.current.mode = "idle";
      dragRef.current.pointerId = null;
      dragRef.current.pointerType = null;
      return;
    }

    dragRef.current.mode = "idle";
    dragRef.current.pointerId = null;
    dragRef.current.pointerType = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function resetCamera() {
    setYaw(-0.72);
    setPitch(0.34);
    setZoom(1);
  }

  function setCameraPreset(nextYaw: number, nextPitch: number, nextZoom = 1) {
    setYaw(nextYaw);
    setPitch(nextPitch);
    setZoom(nextZoom);
  }

  function assignAxis(target: "x" | "y" | "z", nextKey: AxisKey) {
    setAxes((current) => {
      if (current[target] === nextKey) return current;
      const next = { ...current };
      const collided = (["x", "y", "z"] as const).find(
        (axis) => axis !== target && current[axis] === nextKey,
      );
      if (collided) {
        next[collided] = current[target];
      }
      next[target] = nextKey;
      return next;
    });
  }

  function formatAxisValue(
    axisKey: AxisKey,
    value: number | null | undefined,
    point?: TraxrTrendPoint | null,
  ) {
    if (axisKey === "time") {
      const timePoint =
        point ||
        (typeof value === "number" && Number.isFinite(value)
          ? trend[Math.max(0, Math.min(trend.length - 1, Math.round(value)))] || null
          : null);
      if (!timePoint) return "N/A";
      return new Date(timePoint.timestamp).toLocaleString("en-GB", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      });
    }
    if (axisKey === "score") return typeof value === "number" ? value.toFixed(1) : "N/A";
    if (axisKey === "impact") return formatPct(value);
    return formatMoney(value);
  }

  if (preview) {
    const previewHeightClass = heroShowcase
      ? "h-[clamp(220px,33vw,360px)]"
      : "h-[clamp(320px,50vw,500px)]";
    return (
      <section
        className={
          heroShowcase
            ? "p-0"
            : "rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_15%_15%,rgba(34,211,238,0.14),transparent_25%),radial-gradient(circle_at_85%_10%,rgba(56,189,248,0.10),transparent_22%),linear-gradient(180deg,rgba(6,12,22,0.95),rgba(8,14,24,0.98))] p-2 sm:p-3"
        }
      >
        <div className="flex flex-col gap-3">
          {heroShowcase ? null : (
            <div className="flex flex-wrap items-center gap-2 px-2 pt-1 text-[11px] uppercase tracking-[0.2em] text-white/55">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                {datasetOptions.find((option) => option.key === dataset)?.label}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                {tokenLabel(selectedPool)}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                X {axisOptions.find((item) => item.key === axes.x)?.label}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                Y {axisOptions.find((item) => item.key === axes.y)?.label}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                Z {axisOptions.find((item) => item.key === axes.z)?.label}
              </span>
            </div>
          )}

          <div
            className={`relative min-w-0 transition-[opacity,filter] duration-[950ms] ease-out ${
              heroShowcase && showcaseFading
                ? "opacity-30 blur-[1.2px] saturate-[0.88]"
                : "opacity-100 blur-0 saturate-100"
            } ${heroShowcase ? "overflow-visible" : "overflow-hidden rounded-[20px] border border-white/10"}`}
          >
            {loadingTrend ? (
              <div className={`flex ${previewHeightClass} items-center justify-center text-sm text-white/55`}>
                Loading trajectory...
              </div>
            ) : error ? (
              <div className={`flex ${previewHeightClass} items-center justify-center px-6 text-center text-sm text-rose-200/75`}>
                {error}
              </div>
            ) : !scene.points.length ? (
              <div className={`flex ${previewHeightClass} items-center justify-center px-6 text-center text-sm text-white/55`}>
                No historical trajectory is available for this pool yet.
              </div>
            ) : (
              <>
                <svg
                  viewBox={`0 0 ${scene.width} ${scene.height}`}
                  className={`${previewHeightClass} w-full ${
                    heroShowcase
                      ? "cursor-default [overflow:visible]"
                      : "cursor-grab touch-none active:cursor-grabbing"
                  }`}
                  style={{
                    touchAction: heroShowcase ? "auto" : "none",
                    overflow: heroShowcase ? "visible" : "hidden",
                  }}
                  onMouseLeave={() => setHoverIndex(null)}
                  onWheel={heroShowcase ? undefined : handleWheel}
                  onPointerDown={heroShowcase ? undefined : handlePointerDown}
                  onPointerMove={heroShowcase ? undefined : handlePointerMove}
                  onPointerUp={heroShowcase ? undefined : handlePointerUp}
                  onPointerCancel={heroShowcase ? undefined : handlePointerUp}
                >
                  <defs>
                    <linearGradient id="trajectoryStroke" x1="0" x2="1" y1="1" y2="0">
                      <stop offset="0%" stopColor="rgba(103,232,249,0.45)" />
                      <stop offset="55%" stopColor="rgba(110,231,255,0.85)" />
                      <stop offset="100%" stopColor="rgba(190,242,255,1)" />
                    </linearGradient>
                    <linearGradient id="trajectoryHalo" x1="0" x2="1" y1="1" y2="0">
                      <stop offset="0%" stopColor="rgba(103,232,249,0.08)" />
                      <stop offset="100%" stopColor="rgba(190,242,255,0.18)" />
                    </linearGradient>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="8" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    <filter id="axisLabelGlow">
                      <feGaussianBlur stdDeviation="1.2" result="textBlur" />
                      <feMerge>
                        <feMergeNode in="textBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  <g opacity="0.34" stroke="rgba(255,255,255,0.22)" strokeWidth="1">
                    {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                      const a = projectPoint(0, t, 0, scene.width, scene.height, yaw, pitch);
                      const b = projectPoint(1, t, 0, scene.width, scene.height, yaw, pitch);
                      const c = projectPoint(1, t, 1, scene.width, scene.height, yaw, pitch);
                      return (
                        <g key={`preview-grid-y-${t}`}>
                          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                          <line x1={b.x} y1={b.y} x2={c.x} y2={c.y} />
                        </g>
                      );
                    })}
                    {[0, 0.33, 0.66, 1].map((z) => {
                      const a = projectPoint(0, 0, z, scene.width, scene.height, yaw, pitch);
                      const b = projectPoint(1, 0, z, scene.width, scene.height, yaw, pitch);
                      const c = projectPoint(1, 1, z, scene.width, scene.height, yaw, pitch);
                      return (
                        <g key={`preview-grid-z-${z}`}>
                          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                          <line x1={b.x} y1={b.y} x2={c.x} y2={c.y} />
                        </g>
                      );
                    })}
                  </g>

                  <g opacity="0.85">
                    <line
                      x1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch).x}
                      y1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch).y}
                      x2={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch).x}
                      y2={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch).y}
                      stroke="rgba(255,255,255,0.32)"
                      strokeWidth="1.4"
                    />
                    <line
                      x1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch).x}
                      y1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch).y}
                      x2={projectPoint(0, 1, 0, scene.width, scene.height, yaw, pitch).x}
                      y2={projectPoint(0, 1, 0, scene.width, scene.height, yaw, pitch).y}
                      stroke="rgba(255,255,255,0.32)"
                      strokeWidth="1.4"
                    />
                    <line
                      x1={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch).x}
                      y1={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch).y}
                      x2={projectPoint(1, 0, 1, scene.width, scene.height, yaw, pitch).x}
                      y2={projectPoint(1, 0, 1, scene.width, scene.height, yaw, pitch).y}
                      stroke="rgba(255,255,255,0.32)"
                      strokeWidth="1.4"
                    />
                  </g>

                  <text
                    x={heroShowcase ? heroAxisLabelPositions.x.x : 78}
                    y={heroShowcase ? heroAxisLabelPositions.x.y : 588}
                    fill={heroShowcase ? "rgba(255,255,255,0.74)" : "rgba(255,255,255,0.56)"}
                    fontSize={heroShowcase ? "14" : "13"}
                    letterSpacing="3.2"
                    textAnchor="start"
                    filter={heroShowcase ? "url(#axisLabelGlow)" : undefined}
                  >
                    {axes.x.toUpperCase()}
                  </text>
                  <text
                    x={heroShowcase ? heroAxisLabelPositions.y.x : 55}
                    y={heroShowcase ? heroAxisLabelPositions.y.y : 118}
                    fill={heroShowcase ? "rgba(255,255,255,0.74)" : "rgba(255,255,255,0.56)"}
                    fontSize={heroShowcase ? "14" : "13"}
                    letterSpacing="3.2"
                    textAnchor={heroShowcase ? "end" : "start"}
                    filter={heroShowcase ? "url(#axisLabelGlow)" : undefined}
                  >
                    {axes.y.toUpperCase()}
                  </text>
                  <text
                    x={heroShowcase ? heroAxisLabelPositions.z.x : 880}
                    y={heroShowcase ? heroAxisLabelPositions.z.y : 500}
                    fill={heroShowcase ? "rgba(255,255,255,0.74)" : "rgba(255,255,255,0.56)"}
                    fontSize={heroShowcase ? "14" : "13"}
                    letterSpacing="3.2"
                    textAnchor="start"
                    filter={heroShowcase ? "url(#axisLabelGlow)" : undefined}
                  >
                    {axes.z.toUpperCase()}
                  </text>

                  <path
                    key={`preview-trajectory-halo-${drawVersion}`}
                    d={scene.path}
                    fill="none"
                    stroke="url(#trajectoryHalo)"
                    strokeWidth="11"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glow)"
                    pathLength={100}
                    strokeDasharray="100"
                    strokeDashoffset={heroShowcase ? 100 - heroLineProgress * 100 : "100"}
                  >
                    {heroShowcase ? null : (
                      <animate
                        attributeName="stroke-dashoffset"
                        from="100"
                        to="0"
                        dur="1.15s"
                        fill="freeze"
                      />
                    )}
                  </path>

                  <path
                    key={`preview-trajectory-main-${drawVersion}`}
                    d={scene.path}
                    fill="none"
                    stroke="url(#trajectoryStroke)"
                    strokeWidth="5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#glow)"
                    pathLength={100}
                    strokeDasharray="100"
                    strokeDashoffset={heroShowcase ? 100 - heroLineProgress * 100 : "100"}
                  >
                    {heroShowcase ? null : (
                      <animate
                        attributeName="stroke-dashoffset"
                        from="100"
                        to="0"
                        dur="1.25s"
                        fill="freeze"
                      />
                    )}
                  </path>

                  {scene.points.map((point, index) => {
                    const isRevealed =
                      !heroShowcase || heroLineProgress >= (heroNodeRevealThresholds[index] ?? 1);
                    const isActive = index === activeIndex;
                    const isLatest = index === scene.points.length - 1;
                    const baseRadius = isActive ? 9 : isLatest ? 7 : 5;
                    const revealRadius = isActive ? 8 : isLatest ? 6 : 4;
                    return (
                      <g key={`${point.timestamp}-${index}`}>
                        <circle
                          cx={point.screenX}
                          cy={point.screenY}
                          r={heroShowcase ? revealRadius : baseRadius}
                          fill={
                            heroShowcase
                              ? isRevealed
                                ? "rgba(186, 244, 255, 0.92)"
                                : "rgba(129, 240, 255, 0)"
                              : isActive
                                ? "#d9fbff"
                                : isLatest
                                  ? "#7ceeff"
                                  : "rgba(129, 240, 255, 0.72)"
                          }
                          stroke={isLatest ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.32)"}
                          strokeWidth={isActive ? 2.5 : 1.4}
                          onMouseEnter={() => setHoverIndex(index)}
                          opacity={heroShowcase ? (isRevealed ? "1" : "0") : "0"}
                        >
                          {heroShowcase ? null : (
                            <>
                              <animate
                                attributeName="opacity"
                                from="0"
                                to="1"
                                dur="0.25s"
                                begin={`${0.22 + index * 0.028}s`}
                                fill="freeze"
                              />
                              <animate
                                attributeName="r"
                                from={isLatest ? "3" : "2"}
                                to={String(baseRadius)}
                                dur="0.25s"
                                begin={`${0.22 + index * 0.028}s`}
                                fill="freeze"
                              />
                            </>
                          )}
                        </circle>
                        <circle
                          cx={point.screenX}
                          cy={point.screenY}
                          r={heroShowcase ? (isRevealed ? 12 : 0) : isActive ? 16 : isLatest ? 12 : 0}
                          fill="rgba(110,231,255,0.09)"
                          stroke={heroShowcase ? "rgba(158,244,255,0.35)" : "rgba(110,231,255,0.15)"}
                          opacity={heroShowcase ? (isRevealed ? "1" : "0") : "0"}
                        >
                          {heroShowcase ? null : (
                            <animate
                              attributeName="opacity"
                              from="0"
                              to={isActive || isLatest ? "1" : "0"}
                              dur="0.3s"
                              begin={`${0.3 + index * 0.028}s`}
                              fill="freeze"
                            />
                          )}
                        </circle>
                      </g>
                    );
                  })}

                  {!heroShowcase && activePoint ? (
                    <g transform={`translate(${Math.min(scene.width - 260, activePoint.screenX + 22)},${Math.max(42, activePoint.screenY - 108)})`}>
                      <rect
                        width="230"
                        height="118"
                        rx="22"
                        fill="rgba(5,10,17,0.92)"
                        stroke="rgba(110,231,255,0.30)"
                      />
                      <text x="18" y="26" fill="rgba(255,255,255,0.62)" fontSize="13">
                        {new Date(activePoint.timestamp).toLocaleString("en-GB", {
                          day: "numeric",
                          month: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                          timeZone: "UTC",
                        })}
                      </text>
                      <text x="18" y="52" fill="#9defff" fontSize="14">
                        {axisOptions.find((item) => item.key === axes.x)?.label}
                      </text>
                      <text x="180" y="52" fill="#ffffff" fontSize="14" textAnchor="end">
                        {formatAxisValue(axes.x, activePoint.xValue, activePoint)}
                      </text>
                      <text x="18" y="76" fill="#f8dd68" fontSize="14">
                        {axisOptions.find((item) => item.key === axes.y)?.label}
                      </text>
                      <text x="210" y="76" fill="#ffffff" fontSize="14" textAnchor="end">
                        {formatAxisValue(axes.y, activePoint.yValue, activePoint)}
                      </text>
                      <text x="18" y="100" fill="#f7b1db" fontSize="14">
                        {axisOptions.find((item) => item.key === axes.z)?.label}
                      </text>
                      <text x="210" y="100" fill="#ffffff" fontSize="14" textAnchor="end">
                        {formatAxisValue(axes.z, activePoint.zValue, activePoint)}
                      </text>
                    </g>
                  ) : null}
                </svg>
              </>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[26px] border border-cyan-400/20 bg-[linear-gradient(180deg,rgba(9,18,30,0.95),rgba(7,13,24,0.98))] p-4 text-white shadow-[0_0_60px_rgba(34,211,238,0.08)] sm:rounded-[32px] sm:p-6 lg:p-7">
      <div className="flex flex-col gap-4">
        <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3 sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-[0.34em] text-cyan-100/55">
                Trajectory 3D
              </div>
              <div className="mt-1 text-xl font-semibold text-cyan-50 sm:text-2xl">
                One pool, one scene, all the important movement.
              </div>
              <p className="mt-1 max-w-3xl text-sm text-white/58">
                Drag to rotate, wheel or pinch to zoom, then use the icon bar to remap the scene.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-white/55">
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                {trend.length} Snapshots
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                Score {latestPoint ? latestPoint.score.toFixed(1) : "N/A"}
              </span>
              <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2">
                X {axisOptions.find((item) => item.key === axes.x)?.label}
              </span>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="min-w-0 select-none rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-3 sm:rounded-[28px] sm:p-5">
            <div className="flex flex-col gap-4">
              <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,16,28,0.92),rgba(6,12,22,0.9))] p-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-2.5">
                    <span className="shrink-0 text-[11px] uppercase tracking-[0.24em] text-white/42">
                      Pool
                    </span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search token, pool id, or address"
                      className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
                    />
                    {query.trim().length >= 2 ? (
                      <span className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-cyan-100/75">
                        {searching ? "..." : `${selectablePools.length}`}
                      </span>
                    ) : null}
                  </div>
                  <div className="min-w-0 xl:w-[360px]">
                    <PoolCombobox
                      pools={selectablePools}
                      value={poolId}
                      onChange={setPoolId}
                      accent="cyan"
                      placeholder={loadingPools ? "Loading pools..." : "Select pool"}
                      className="w-full"
                    />
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 xl:flex">
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white/55">
                      {datasetOptions.find((option) => option.key === dataset)?.label}
                    </span>
                    <span className="rounded-full border border-white/10 bg-black/20 px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-white/55">
                      {Math.round(zoom * 100)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="relative min-w-0 overflow-hidden rounded-[24px] border border-white/10 bg-[radial-gradient(circle_at_15%_15%,rgba(34,211,238,0.14),transparent_25%),radial-gradient(circle_at_85%_10%,rgba(56,189,248,0.10),transparent_22%),linear-gradient(180deg,rgba(6,12,22,0.95),rgba(8,14,24,0.98))] sm:rounded-[28px]">
                <div className="border-b border-white/8 px-4 py-3 sm:px-5">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.32em] text-white/45">
                        3D Scene
                      </div>
                      <div className="mt-1 break-words text-base text-cyan-50 sm:text-lg">
                        {tokenLabel(selectedPool)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-white/50">
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                        X {axisOptions.find((item) => item.key === axes.x)?.label}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                        Y {axisOptions.find((item) => item.key === axes.y)?.label}
                      </span>
                      <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5">
                        Z {axisOptions.find((item) => item.key === axes.z)?.label}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="relative px-2 pb-2 pt-3 sm:px-3">
                  <div className="pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap gap-2">
                    <div className="rounded-full border border-white/10 bg-[#07111d]/88 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-white/70">
                      Drag
                    </div>
                    <div className="rounded-full border border-white/10 bg-[#07111d]/88 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-white/70">
                      Zoom
                    </div>
                  </div>
                  {loadingTrend ? (
                    <div className="flex h-[clamp(360px,50vw,620px)] items-center justify-center text-sm text-white/55">
                      Loading trajectory...
                    </div>
                  ) : error ? (
                    <div className="flex h-[clamp(360px,50vw,620px)] items-center justify-center px-6 text-center text-sm text-rose-200/75">
                      {error}
                    </div>
                  ) : !scene.points.length ? (
                    <div className="flex h-[clamp(360px,50vw,620px)] items-center justify-center px-6 text-center text-sm text-white/55">
                      No historical trajectory is available for this pool yet.
                    </div>
                  ) : (
                    <>
                      <svg
                        viewBox={`0 0 ${scene.width} ${scene.height}`}
                        className="h-[clamp(360px,50vw,620px)] w-full cursor-grab touch-none active:cursor-grabbing"
                        style={{ touchAction: "none", userSelect: "none" }}
                        onMouseLeave={() => setHoverIndex(null)}
                        onWheel={handleWheel}
                        onPointerDown={handlePointerDown}
                        onPointerMove={handlePointerMove}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                      >
                      <defs>
                        <linearGradient id="trajectoryStroke" x1="0" x2="1" y1="1" y2="0">
                          <stop offset="0%" stopColor="rgba(103,232,249,0.45)" />
                          <stop offset="55%" stopColor="rgba(110,231,255,0.85)" />
                          <stop offset="100%" stopColor="rgba(190,242,255,1)" />
                        </linearGradient>
                        <linearGradient id="trajectoryHalo" x1="0" x2="1" y1="1" y2="0">
                          <stop offset="0%" stopColor="rgba(103,232,249,0.08)" />
                          <stop offset="100%" stopColor="rgba(190,242,255,0.18)" />
                        </linearGradient>
                        <filter id="glow">
                          <feGaussianBlur stdDeviation="8" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                        <filter id="axisLabelGlowFull">
                          <feGaussianBlur stdDeviation="1.2" result="textBlur" />
                          <feMerge>
                            <feMergeNode in="textBlur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>

                      <g opacity="0.34" stroke="rgba(255,255,255,0.22)" strokeWidth="1">
                        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                          const a = projectPoint(0, t, 0, scene.width, scene.height, yaw, pitch, sceneView);
                          const b = projectPoint(1, t, 0, scene.width, scene.height, yaw, pitch, sceneView);
                          const c = projectPoint(1, t, 1, scene.width, scene.height, yaw, pitch, sceneView);
                          return (
                            <g key={`grid-y-${t}`}>
                              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                              <line x1={b.x} y1={b.y} x2={c.x} y2={c.y} />
                            </g>
                          );
                        })}
                        {[0, 0.33, 0.66, 1].map((z) => {
                          const a = projectPoint(0, 0, z, scene.width, scene.height, yaw, pitch, sceneView);
                          const b = projectPoint(1, 0, z, scene.width, scene.height, yaw, pitch, sceneView);
                          const c = projectPoint(1, 1, z, scene.width, scene.height, yaw, pitch, sceneView);
                          return (
                            <g key={`grid-z-${z}`}>
                              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                              <line x1={b.x} y1={b.y} x2={c.x} y2={c.y} />
                            </g>
                          );
                        })}
                      </g>

                      <g opacity="0.85">
                        <line
                          x1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).x}
                          y1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).y}
                          x2={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).x}
                          y2={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).y}
                          stroke="rgba(255,255,255,0.32)"
                          strokeWidth="1.4"
                        />
                        <line
                          x1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).x}
                          y1={projectPoint(0, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).y}
                          x2={projectPoint(0, 1, 0, scene.width, scene.height, yaw, pitch, sceneView).x}
                          y2={projectPoint(0, 1, 0, scene.width, scene.height, yaw, pitch, sceneView).y}
                          stroke="rgba(255,255,255,0.32)"
                          strokeWidth="1.4"
                        />
                        <line
                          x1={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).x}
                          y1={projectPoint(1, 0, 0, scene.width, scene.height, yaw, pitch, sceneView).y}
                          x2={projectPoint(1, 0, 1, scene.width, scene.height, yaw, pitch, sceneView).x}
                          y2={projectPoint(1, 0, 1, scene.width, scene.height, yaw, pitch, sceneView).y}
                          stroke="rgba(255,255,255,0.32)"
                          strokeWidth="1.4"
                        />
                      </g>

                      <text
                        x={sceneAxisLabelPositions.x.x}
                        y={sceneAxisLabelPositions.x.y}
                        fill="rgba(255,255,255,0.62)"
                        fontSize="13"
                        letterSpacing="3.2"
                        textAnchor={sceneAxisLabelPositions.x.anchor}
                        filter="url(#axisLabelGlowFull)"
                      >
                        {axes.x.toUpperCase()}
                      </text>
                      <text
                        x={sceneAxisLabelPositions.y.x}
                        y={sceneAxisLabelPositions.y.y}
                        fill="rgba(255,255,255,0.62)"
                        fontSize="13"
                        letterSpacing="3.2"
                        textAnchor={sceneAxisLabelPositions.y.anchor}
                        filter="url(#axisLabelGlowFull)"
                      >
                        {axes.y.toUpperCase()}
                      </text>
                      <text
                        x={sceneAxisLabelPositions.z.x}
                        y={sceneAxisLabelPositions.z.y}
                        fill="rgba(255,255,255,0.62)"
                        fontSize="13"
                        letterSpacing="3.2"
                        textAnchor={sceneAxisLabelPositions.z.anchor}
                        filter="url(#axisLabelGlowFull)"
                      >
                        {axes.z.toUpperCase()}
                      </text>

                      <path
                        key={`trajectory-halo-${drawVersion}`}
                        d={scene.path}
                        fill="none"
                        stroke="url(#trajectoryHalo)"
                        strokeWidth="11"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        filter="url(#glow)"
                        pathLength={100}
                        strokeDasharray="100"
                        strokeDashoffset="100"
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="100"
                          to="0"
                          dur="1.15s"
                          fill="freeze"
                        />
                      </path>

                      <path
                        key={`trajectory-main-${drawVersion}`}
                        d={scene.path}
                        fill="none"
                        stroke="url(#trajectoryStroke)"
                        strokeWidth="5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        filter="url(#glow)"
                        pathLength={100}
                        strokeDasharray="100"
                        strokeDashoffset="100"
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="100"
                          to="0"
                          dur="1.25s"
                          fill="freeze"
                        />
                      </path>

                      {scene.points.map((point, index) => {
                        const isActive = index === activeIndex;
                        const isLatest = index === scene.points.length - 1;
                        return (
                          <g key={`${point.timestamp}-${index}`}>
                            <circle
                              cx={point.screenX}
                              cy={point.screenY}
                              r={isActive ? 9 : isLatest ? 7 : 5}
                              fill={isActive ? "#d9fbff" : isLatest ? "#7ceeff" : "rgba(129, 240, 255, 0.72)"}
                              stroke={isLatest ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.32)"}
                              strokeWidth={isActive ? 2.5 : 1.4}
                              onMouseEnter={() => setHoverIndex(index)}
                               opacity="0"
                            >
                              <animate
                                attributeName="opacity"
                                from="0"
                                to="1"
                                dur="0.25s"
                                begin={`${0.22 + index * 0.028}s`}
                                fill="freeze"
                              />
                              <animate
                                attributeName="r"
                                from={isLatest ? "3" : "2"}
                                to={String(isActive ? 9 : isLatest ? 7 : 5)}
                                dur="0.25s"
                                begin={`${0.22 + index * 0.028}s`}
                                fill="freeze"
                              />
                            </circle>
                            <circle
                              cx={point.screenX}
                              cy={point.screenY}
                              r={isActive ? 16 : isLatest ? 12 : 0}
                              fill="rgba(110,231,255,0.08)"
                              stroke="rgba(110,231,255,0.15)"
                              opacity="0"
                            >
                              <animate
                                attributeName="opacity"
                                from="0"
                                to={isActive || isLatest ? "1" : "0"}
                                dur="0.3s"
                                begin={`${0.3 + index * 0.028}s`}
                                fill="freeze"
                              />
                            </circle>
                          </g>
                        );
                      })}

                      {activePoint ? (
                        <g transform={`translate(${Math.min(scene.width - 260, activePoint.screenX + 22)},${Math.max(42, activePoint.screenY - 108)})`}>
                          <rect
                            width="230"
                            height="118"
                            rx="22"
                            fill="rgba(5,10,17,0.92)"
                            stroke="rgba(110,231,255,0.30)"
                          />
                          <text x="18" y="26" fill="rgba(255,255,255,0.62)" fontSize="13">
                            {new Date(activePoint.timestamp).toLocaleString("en-GB", {
                              day: "numeric",
                              month: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                              timeZone: "UTC",
                            })}
                          </text>
                          <text x="18" y="52" fill="#9defff" fontSize="14">
                            {axisOptions.find((item) => item.key === axes.x)?.label}
                          </text>
                          <text x="180" y="52" fill="#ffffff" fontSize="14" textAnchor="end">
                            {formatAxisValue(axes.x, activePoint.xValue, activePoint)}
                          </text>
                          <text x="18" y="76" fill="#f8dd68" fontSize="14">
                            {axisOptions.find((item) => item.key === axes.y)?.label}
                          </text>
                          <text x="210" y="76" fill="#ffffff" fontSize="14" textAnchor="end">
                            {formatAxisValue(axes.y, activePoint.yValue, activePoint)}
                          </text>
                          <text x="18" y="100" fill="#f7b1db" fontSize="14">
                            {axisOptions.find((item) => item.key === axes.z)?.label}
                          </text>
                          <text x="210" y="100" fill="#ffffff" fontSize="14" textAnchor="end">
                            {formatAxisValue(axes.z, activePoint.zValue, activePoint)}
                          </text>
                        </g>
                      ) : null}
                      </svg>
                    </>
                  )}
                </div>
                <div className="border-t border-white/8 px-3 py-3 sm:px-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
                      Quick Controls
                    </div>
                    <div className="text-xs text-white/40">Tap icon to expand</div>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {toolbarButtons.map(({ key, label, icon: Icon }) => {
                      const active = activePanel === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setActivePanel((current) => (current === key ? null : key))}
                          className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border px-3 py-2 text-center transition ${
                            active
                              ? "border-cyan-300/45 bg-cyan-400/12 text-cyan-100"
                              : "border-white/10 bg-white/5 text-white/62 hover:bg-white/10"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="text-[11px] uppercase tracking-[0.18em]">{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {activePanel ? (
                    <div className="mt-3 rounded-[22px] border border-cyan-300/20 bg-[#08111d]/94 p-4 shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
                      {activePanel === "dataset" ? (
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">
                            Dataset
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {datasetOptions.map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                onClick={() => setDataset(option.key)}
                                className={`min-h-11 rounded-full px-4 py-3 text-xs uppercase tracking-[0.18em] transition ${
                                  dataset === option.key
                                    ? "bg-cyan-500/18 text-cyan-100 ring-1 ring-cyan-300/50"
                                    : "bg-white/5 text-white/60 hover:bg-white/10"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {activePanel === "axes" ? (
                        <div className="space-y-3">
                          <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">
                            Axis Mapping
                          </div>
                          {(["x", "y", "z"] as const).map((target) => (
                            <div key={target}>
                              <div className="mb-2 text-[11px] uppercase tracking-[0.24em] text-white/40">
                                {target.toUpperCase()} Axis
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {axisOptions.map((option) => (
                                  <button
                                    key={`${target}-${option.key}`}
                                    type="button"
                                    onClick={() => assignAxis(target, option.key)}
                                    className={`min-h-11 rounded-full px-4 py-3 text-xs uppercase tracking-[0.18em] transition ${
                                      axes[target] === option.key
                                        ? "bg-cyan-500/18 text-cyan-100 ring-1 ring-cyan-300/50"
                                        : "bg-white/5 text-white/60 hover:bg-white/10"
                                    }`}
                                  >
                                    {option.label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {activePanel === "view" ? (
                        <div className="space-y-4">
                          <div>
                            <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">
                              View Controls
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={resetCamera}
                                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/6 px-4 py-3 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                              >
                                <FiRotateCcw className="h-4 w-4" />
                                Reset
                              </button>
                              <button
                                type="button"
                                onClick={() => setCameraPreset(-0.72, 0.34, 1)}
                                className="min-h-11 rounded-full bg-white/6 px-4 py-3 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                              >
                                Hero
                              </button>
                              <button
                                type="button"
                                onClick={() => setCameraPreset(-0.08, 0.08, 1)}
                                className="min-h-11 rounded-full bg-white/6 px-4 py-3 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                              >
                                Front
                              </button>
                              <button
                                type="button"
                                onClick={() => setCameraPreset(-1.18, 0.48, 1.08)}
                                className="min-h-11 rounded-full bg-white/6 px-4 py-3 text-xs uppercase tracking-[0.18em] text-white/70 transition hover:bg-white/10"
                              >
                                Angle
                              </button>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() => setZoom((current) => clampZoom(current - 0.14))}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/72 transition hover:bg-white/10"
                            >
                              <FiZoomOut className="h-4 w-4" />
                              Zoom Out
                            </button>
                            <button
                              type="button"
                              onClick={() => setZoom((current) => clampZoom(current + 0.14))}
                              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/72 transition hover:bg-white/10"
                            >
                              <FiZoomIn className="h-4 w-4" />
                              Zoom In
                            </button>
                          </div>
                          <div className="rounded-2xl border border-cyan-400/14 bg-cyan-500/6 p-4 text-sm text-white/72">
                            <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">
                              Scene Guide
                            </div>
                            <div className="mt-3 space-y-2">
                              <p>Desktop: drag to rotate and use the mouse wheel to zoom.</p>
                              <p>Mobile: drag with one finger to rotate and pinch with two fingers to zoom.</p>
                              <p>Current view: yaw {yaw.toFixed(2)} • pitch {pitch.toFixed(2)} • zoom {zoom.toFixed(2)}x</p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {activePanel === "info" ? (
                        <div className="space-y-4">
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
                                Latest Snapshot
                              </div>
                              <div className="mt-3 text-xl font-semibold text-cyan-100">
                                {tokenLabel(selectedPool)}
                              </div>
                              <div className="mt-4 space-y-2 text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="text-white/55">Score</span>
                                  <span className="text-white">{latestPoint?.score.toFixed(1) ?? "N/A"}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-white/55">Liquidity</span>
                                  <span className="text-white">{formatMoney(latestPoint?.metrics.liquidityUsd)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-white/55">24h Volume</span>
                                  <span className="text-white">{formatMoney(latestPoint?.metrics.volume24hUsd)}</span>
                                </div>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-cyan-400/16 bg-cyan-500/6 px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.28em] text-cyan-100/55">
                                How to Read It
                              </div>
                              <div className="mt-3 space-y-2 text-sm text-white/72">
                                <p>Each point is one stored snapshot of the same pool.</p>
                                <p>The path shows how score, depth, flow, and impact move together.</p>
                                <p>Use icons below the chart to switch dataset, axes, or camera view.</p>
                              </div>
                            </div>
                            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                              <div className="text-[11px] uppercase tracking-[0.28em] text-white/45">
                                Active Axis Range
                              </div>
                              <div className="mt-3 space-y-2 text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="text-white/55">Min {axisOptions.find((item) => item.key === axes.z)?.label}</span>
                                  <span className="text-white">{formatAxisValue(axes.z, scene.mins.z, latestPoint)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-white/55">Max {axisOptions.find((item) => item.key === axes.z)?.label}</span>
                                  <span className="text-white">{formatAxisValue(axes.z, scene.maxs.z, latestPoint)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-white/55">CTS Nodes</span>
                                  <span className="text-white">{latestPoint?.ctsNodes ?? "N/A"}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
