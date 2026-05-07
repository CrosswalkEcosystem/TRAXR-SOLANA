import type { SolanaPoolMetrics, TraxrNodeBreakdown } from "./types";

export type TraxrScoreResult = {
  score: number;
  nodes: TraxrNodeBreakdown;
  ctsNodes: number;
  metrics: SolanaPoolMetrics;
};

type ScoringModule = {
  toScoreResult: (m: SolanaPoolMetrics) => TraxrScoreResult;
  buildWarnings: (m: SolanaPoolMetrics, n: TraxrNodeBreakdown) => string[];
};

function countCTSNodesFromPercent(score: number) {
  if (score <= 0) return 0;
  return Math.max(1, Math.round((score / 100) * 6));
}

function publicFallbackScore(m: SolanaPoolMetrics): TraxrScoreResult {
  const score = Math.max(0, Math.min(100, Math.round(m.ctsScore ?? 0)));
  const ctsNodes =
    m.ctsNodes !== null && m.ctsNodes !== undefined
      ? m.ctsNodes
      : countCTSNodesFromPercent(score);

  return {
    score,
    nodes: {
      depth: 0,
      activity: 0,
      impact: 0,
      stability: 0,
      trust: 0,
      fee: 0,
    },
    ctsNodes,
    metrics: m,
  };
}

function publicFallbackWarnings(m: SolanaPoolMetrics): string[] {
  const warnings = ["CTS scoring is disabled in the public build."];

  if (!m.liquidityUsd) warnings.push("No liquidity data reported.");
  if (!m.volume24hUsd) warnings.push("No 24h volume reported.");
  if ((m.dataAgeHours ?? 0) > 72) warnings.push("Pool data may be stale.");

  return warnings;
}

function loadPrivateScoringModule(): ScoringModule | null {
  try {
    // Keep the proprietary scorer in an ignored local file so public GitHub
    // publishes do not disclose the CTS model implementation.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./scoringAdapter.private") as Partial<ScoringModule>;
    if (
      typeof mod.toScoreResult === "function" &&
      typeof mod.buildWarnings === "function"
    ) {
      return mod as ScoringModule;
    }
  } catch {
    // Public repo intentionally falls back when the private scorer is absent.
  }
  return null;
}

const privateScoring = loadPrivateScoringModule();

export const toScoreResult = (m: SolanaPoolMetrics): TraxrScoreResult =>
  privateScoring?.toScoreResult(m) ?? publicFallbackScore(m);

export const buildWarnings = (m: SolanaPoolMetrics, n: TraxrNodeBreakdown) =>
  privateScoring?.buildWarnings(m, n) ?? publicFallbackWarnings(m);
