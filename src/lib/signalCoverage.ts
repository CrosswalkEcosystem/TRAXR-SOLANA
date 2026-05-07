export type SignalCoverageDatasetKey =
  | "amm"
  | "clmm"
  | "cpmm"
  | "other"
  | "orca"
  | "pumpswap"
  | "meteora"
  | "meteora-dammv2";

export const STORED_VOLATILITY_STARTED_AT = "2026-03-24T06:10:41.406Z";

type CoverageInfo = {
  label: string;
  exactImpact: "active" | "limited";
  exactImpactLabel: string;
  note: string;
};

const COVERAGE: Record<SignalCoverageDatasetKey, CoverageInfo> = {
  amm: {
    label: "Raydium AMM",
    exactImpact: "active",
    exactImpactLabel: "Exact $1k impact active",
    note: "Stored volatility is embedded from the timestamp below. Earlier snapshots are legacy.",
  },
  clmm: {
    label: "Raydium CLMM",
    exactImpact: "active",
    exactImpactLabel: "Exact $1k impact active",
    note: "Stored volatility is embedded from the timestamp below. Exact CLMM impact is embedded in current snapshots.",
  },
  cpmm: {
    label: "Raydium CPMM",
    exactImpact: "active",
    exactImpactLabel: "Exact $1k impact active",
    note: "Stored volatility is embedded from the timestamp below. Earlier snapshots are legacy.",
  },
  other: {
    label: "Raydium Others",
    exactImpact: "limited",
    exactImpactLabel: "Impact coverage limited",
    note: "Stored volatility is embedded from the timestamp below. Signal coverage varies by pool type.",
  },
  orca: {
    label: "Orca",
    exactImpact: "active",
    exactImpactLabel: "Exact $1k impact active",
    note: "Stored volatility is embedded from the timestamp below. Earlier snapshots are legacy.",
  },
  pumpswap: {
    label: "PumpSwap",
    exactImpact: "limited",
    exactImpactLabel: "Estimated $1k impact active",
    note: "Stored volatility is embedded from the timestamp below. Impact is estimated from pool state; routing depth is not quoted.",
  },
  meteora: {
    label: "Meteora DLMM",
    exactImpact: "active",
    exactImpactLabel: "Exact $1k impact active",
    note: "Stored volatility and corrected exact impact are embedded from the timestamp below. Earlier snapshots may reflect legacy scoring inputs.",
  },
  "meteora-dammv2": {
    label: "Meteora DAMM v2",
    exactImpact: "limited",
    exactImpactLabel: "Estimated $1k impact active",
    note: "Stored volatility is embedded from the timestamp below. Price impact is currently estimated from local pool state, not exact quoted routing.",
  },
};

export function getSignalCoverage(datasetKey: SignalCoverageDatasetKey) {
  return {
    datasetKey,
    storedVolatilityStartedAt: STORED_VOLATILITY_STARTED_AT,
    ...COVERAGE[datasetKey],
  };
}
