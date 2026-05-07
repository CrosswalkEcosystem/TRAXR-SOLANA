// TRAXR node breakdown aligns with CTS dimensions; used by scoring and UI.
export type TraxrNodeBreakdown = {
  depth: number;
  activity: number;
  impact: number;
  stability: number;
  trust: number;
  fee: number;
};

// Core normalized metrics for Solana pool scoring (CTS pool-only)
export type SolanaPoolMetrics = {
  // ----------------------------------
  // Pool identity
  // ----------------------------------
  poolId: string;
  poolName?: string;
  poolType?: string | null;
  mintA: string;
  mintB: string;
  poolProgramId?: string | null;
  poolUpdatedAt?: string;
  source?: string | null;

  // ----------------------------------
  // Token metadata (SPL-style)
  // ----------------------------------
  tokenAName?: string;
  tokenASymbol?: string;
  tokenALogo?: string | null;
  tokenBName?: string;
  tokenBSymbol?: string;
  tokenBLogo?: string | null;
  decimalsMintA?: number | null;
  decimalsMintB?: number | null;

  // ----------------------------------
  // Core metrics (normalized inputs)
  // ----------------------------------
  liquidityUsd: number;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  tx24h: number;
  tx7d: number | null;
  lockedPct: number | null;
  feePct: number | null;
  priceImpactPct: number | null;
  volatilityPct: number | null;
  dataAgeHours?: number;
  burnPct?: number | null;
  priceMin24h?: number | null;
  priceMax24h?: number | null;
  feeApr24h?: number | null;
  feeApr7d?: number | null;

  // Optional CTS outputs if already embedded in source file
  ctsScore?: number | null;
  ctsNodes?: number | null;
};

// Scored pool object returned to UI
export type TraxrScoreResult = {
  poolId: string;
  score: number;    // 0-100
  ctsNodes: number; // 1-6
  nodes: TraxrNodeBreakdown;
  warnings: string[];
  updatedAt: string;

  // Full normalized metrics
  metrics: SolanaPoolMetrics;

  // Convenience duplicates (used by UI/search)
  tokenAName?: string;
  tokenASymbol?: string;
  tokenBName?: string;
  tokenBSymbol?: string;
};

export type TraxrDatasetSummary = {
  totalPools: number;
  totalLiquidityUsd: number;
  totalVolume24hUsd: number;
  elevatedPools: number;
  warningPools: number;
  programs: number;
  medianScore: number;
  hasVolume24h: boolean;
  hasVolume7d: boolean;
  hasPriceRange24h: boolean;
  hasFeeApr24h: boolean;
  hasFeeApr7d: boolean;
  snapshotIso?: string | null;
};

// Time-series snapshot for a single pool across cached data files.
export type TraxrTrendPoint = {
  timestamp: string;
  score: number;
  ctsNodes: number;
  nodes: TraxrNodeBreakdown;
  warnings: string[];
  metrics: SolanaPoolMetrics;
};

// -------------------------------
// TRAXR Console semantic layer
// -------------------------------

// Canonical metric identifiers used by the Console brain
export type TraxrMetric =
  | "DEPTH"
  | "ACTIVITY"
  | "IMPACT"
  | "STABILITY"
  | "TRUST"
  | "FEE";

// Interaction archetypes between metrics
export type MetricInteraction =
  | "USAGE_EFFICIENCY"
  | "LIQUIDITY_STRESS"
  | "FALSE_SECURITY"
  | "RISK_AMPLIFICATION"
  | "COST_PRESSURE"
  | "STRUCTURAL_CONTEXT";

// Normalized metric pair key
export type MetricPairKey = `${TraxrMetric}:${TraxrMetric}`;

// Mapping from TraxrNodeBreakdown keys to TraxrMetric identifiers
export const nodeKeyToMetric: Record<keyof TraxrNodeBreakdown, TraxrMetric> = {
  depth: "DEPTH",
  activity: "ACTIVITY",
  impact: "IMPACT",
  stability: "STABILITY",
  trust: "TRUST",
  fee: "FEE",
};
