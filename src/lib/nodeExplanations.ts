// TRAXR-SOLANA node explanations
// Deterministic, non-evaluative, context-aware interpretation layer (not an oracle)

type InteractionArchetype =
  | "USAGE_EFFICIENCY"
  | "LIQUIDITY_STRESS"
  | "FALSE_SECURITY"
  | "TRUST_SIGNAL"
  | "COST_PRESSURE"
  | "STRUCTURAL";

const PAIR_ARCHETYPES: Record<PairKey, InteractionArchetype> = {
  activity_depth: "USAGE_EFFICIENCY",
  depth_impact: "LIQUIDITY_STRESS",
  depth_stability: "FALSE_SECURITY",
  activity_stability: "USAGE_EFFICIENCY",
  activity_trust: "TRUST_SIGNAL",
  depth_trust: "TRUST_SIGNAL",
  activity_fee: "COST_PRESSURE",
};

type TripleArchetype =
  | "MARKET_STRUCTURE"
  | "EXECUTION_PROFILE"
  | "DATA_CONTEXT"
  | "RISK_SURFACE"
  | "STRUCTURAL";

const TRIPLE_ARCHETYPES: Partial<Record<TripleKey, TripleArchetype>> = {
  activity_depth_stability: "MARKET_STRUCTURE",
  activity_depth_impact: "EXECUTION_PROFILE",
  activity_trust_depth: "DATA_CONTEXT",
};

const TRIPLE_ARCHETYPE_EXPLANATIONS: Record<TripleArchetype, Explanation> = {
  MARKET_STRUCTURE: {
    title: "Market Structure",
    body:
      "Liquidity depth, activity, and stability describe the pool's baseline health.",
  },
  EXECUTION_PROFILE: {
    title: "Execution Profile",
    body:
      "Depth, activity, and impact shape execution quality under a simulated $1,000 swap.",
  },
  DATA_CONTEXT: {
    title: "Trust Context",
    body:
      "Liquidity, activity, and trust signals combine to frame reliability.",
  },
  RISK_SURFACE: {
    title: "Risk Surface",
    body:
      "Multiple dimensions combine to shape the pool's exposure profile.",
  },
  STRUCTURAL: {
    title: "Context Overview",
    body:
      "The selected metrics provide high-level structural context.",
  },
};

const ARCHETYPE_EXPLANATIONS: Record<InteractionArchetype, Explanation> = {
  USAGE_EFFICIENCY: {
    title: "Activity vs Depth",
    body:
      "This combination evaluates how liquidity depth aligns with activity levels.",
  },
  LIQUIDITY_STRESS: {
    title: "Liquidity Stress",
    body:
      "Depth and impact show how liquidity absorbs a simulated $1,000 swap.",
  },
  FALSE_SECURITY: {
    title: "Stability vs Size",
    body:
      "Liquidity size alone does not guarantee stable fee behavior.",
  },
  TRUST_SIGNAL: {
    title: "Trust Signal",
    body:
      "Trust signals combine locked liquidity and data completeness.",
  },
  COST_PRESSURE: {
    title: "Cost Pressure",
    body:
      "Fee levels can impact efficiency even when depth is healthy.",
  },
  STRUCTURAL: {
    title: "Context Overview",
    body:
      "The selected metrics provide structural context for this pool.",
  },
};

export type TraxrNodes = {
  depth: number;
  activity: number;
  impact: number;
  stability: number;
  trust: number;
  fee: number;
};

export type Explanation = {
  title: string;
  body: string;
};

/* --------------------------------------------------
 * Helpers
 * -------------------------------------------------- */

type Band = "low" | "mid" | "high";

function band(v: number): Band {
  if (v >= 70) return "high";
  if (v >= 40) return "mid";
  return "low";
}

function pairKey(a: keyof TraxrNodes, b: keyof TraxrNodes) {
  return [a, b].sort().join("_") as PairKey;
}

function tripleKey(
  a: keyof TraxrNodes,
  b: keyof TraxrNodes,
  c: keyof TraxrNodes,
) {
  return [a, b, c].sort().join("_") as TripleKey;
}

/* --------------------------------------------------
 * 1. LOCAL (single-metric)
 * -------------------------------------------------- */

export function getLocalExplanation(
  node: keyof TraxrNodes,
  value: number,
): Explanation {
  const b = band(value);

  const LOCAL: Record<keyof TraxrNodes, Record<Band, Explanation>> = {
    depth: {
      high: {
        title: "Liquidity Depth",
        body:
          "Depth is strong relative to typical Solana swap sizes.",
      },
      mid: {
        title: "Liquidity Depth",
        body:
          "Depth supports small to medium trades without major disruption.",
      },
      low: {
        title: "Liquidity Depth",
        body:
          "Depth is limited; execution may be sensitive to trade size.",
      },
    },
    activity: {
      high: {
        title: "Activity",
        body:
          "Trading activity is strong relative to the pool size.",
      },
      mid: {
        title: "Activity",
        body:
          "Activity is steady but not dominant in the dataset.",
      },
      low: {
        title: "Activity",
        body:
          "Activity is limited or sporadic in recent windows.",
      },
    },
    impact: {
      high: {
        title: "Price Impact ($1k)",
        body:
          "A simulated $1,000 swap generally results in limited price movement.",
      },
      mid: {
        title: "Price Impact ($1k)",
        body:
          "A simulated $1,000 swap is expected to cause moderate price movement.",
      },
      low: {
        title: "Price Impact ($1k)",
        body:
          "A simulated $1,000 swap is likely to move price materially due to pool structure.",
      },
    },
    stability: {
      high: {
        title: "Stability",
        body:
          "Price behavior appears consistent over recent periods.",
      },
      mid: {
        title: "Stability",
        body:
          "Price behavior shows intermittent volatility.",
      },
      low: {
        title: "Stability",
        body:
          "Price behavior is volatile relative to typical pools.",
      },
    },
    trust: {
      high: {
        title: "Trust",
        body:
          "Locked liquidity and data completeness support trust.",
      },
      mid: {
        title: "Trust",
        body:
          "Trust signals are mixed or partially confirmed.",
      },
      low: {
        title: "Trust",
        body:
          "Trust signals are weak or missing for this pool.",
      },
    },
    fee: {
      high: {
        title: "Fee",
        body:
          "Fees are competitive relative to this pool type's baseline.",
      },
      mid: {
        title: "Fee",
        body:
          "Fees are moderate versus this pool type's baseline.",
      },
      low: {
        title: "Fee",
        body:
          "Fees are high relative to this pool type's baseline.",
      },
    },
  };

  return LOCAL[node][b];
}

/* --------------------------------------------------
 * 2. VALID COMBINATIONS (UI constraint)
 * -------------------------------------------------- */

export const VALID_COMBINATIONS: Record<
  keyof TraxrNodes,
  (keyof TraxrNodes)[]
> = {
  depth: ["activity", "impact", "stability", "trust"],
  activity: ["depth", "impact", "stability", "trust", "fee"],
  impact: ["depth", "activity", "stability"],
  stability: ["depth", "activity", "impact"],
  trust: ["depth", "activity"],
  fee: ["activity"],
};

/* --------------------------------------------------
 * 3. PAIR EXPLANATIONS (2 metrics)
 * -------------------------------------------------- */

type PairKey =
  | "activity_depth"
  | "depth_impact"
  | "depth_stability"
  | "activity_stability"
  | "activity_trust"
  | "depth_trust"
  | "activity_fee";

type PairBandKey =
  | "low_low" | "low_mid" | "low_high"
  | "mid_low" | "mid_mid" | "mid_high"
  | "high_low" | "high_mid" | "high_high";

const PAIR_ORDER: Record<PairKey, [keyof TraxrNodes, keyof TraxrNodes]> = {
  activity_depth: ["activity", "depth"],
  depth_impact: ["depth", "impact"],
  depth_stability: ["depth", "stability"],
  activity_stability: ["activity", "stability"],
  activity_trust: ["activity", "trust"],
  depth_trust: ["depth", "trust"],
  activity_fee: ["activity", "fee"],
};

const PAIRS: Partial<Record<
  PairKey,
  Partial<Record<PairBandKey, Explanation>>
>> = {
  activity_depth: {
    high_high: {
      title: "Healthy Depth",
      body:
        "Depth is strong and activity is healthy.",
    },
    high_low: {
      title: "Active Depth",
      body:
        "Depth is present and activity supports trade flow.",
    },
    low_high: {
      title: "Active but Thin",
      body:
        "Activity is present but overall depth is limited.",
    },
    low_low: {
      title: "Thin and Quiet",
      body:
        "Depth and activity are both limited.",
    },
    mid_mid: {
      title: "Moderate Coverage",
      body:
        "Depth and activity are balanced at moderate levels.",
    },
  },
  depth_impact: {
    high_high: {
      title: "Efficient Execution",
      body:
        "Depth supports low price sensitivity for trades.",
    },
    low_high: {
      title: "Execution Sensitive",
      body:
        "Limited depth results in noticeable price movement per trade.",
    },
  },
  depth_stability: {
    high_high: {
      title: "Stable Structure",
      body:
        "Depth and stability are aligned.",
    },
    low_high: {
      title: "Thin but Stable",
      body:
        "Stability exists despite limited depth.",
    },
  },
  activity_trust: {
    high_high: {
      title: "Trusted Activity",
      body:
        "Activity is healthy and trust signals are strong.",
    },
    low_low: {
      title: "Weak Trust",
      body:
        "Activity is low and trust signals are weak.",
    },
  },
  depth_trust: {
    high_high: {
      title: "Trusted Depth",
      body:
        "Depth and trust signals are well aligned.",
    },
    low_low: {
      title: "Fragile Structure",
      body:
        "Thin liquidity and weak trust signals.",
    },
  },
  activity_fee: {
    high_high: {
      title: "Competitive Fees",
      body:
        "Activity is healthy and fees are competitive.",
    },
    low_high: {
      title: "Cost Pressure",
      body:
        "Fees are elevated relative to activity levels.",
    },
  },
};

/* --------------------------------------------------
 * 4. TRIPLE EXPLANATIONS (3 metrics)
 * -------------------------------------------------- */

type TripleKey =
  | "activity_depth_stability"
  | "activity_depth_impact"
  | "activity_trust_depth";

// ----------------------------------
// Dev-time integrity checks
// ----------------------------------
if (process.env.NODE_ENV !== "production") {
  for (const key of Object.keys(PAIRS) as PairKey[]) {
    if (!PAIR_ORDER[key]) {
      console.warn(`[TRAXR-SOLANA] Missing PAIR_ORDER for ${key}`);
    }
  }

  for (const key of Object.keys(TRIPLE_ARCHETYPES) as TripleKey[]) {
    if (!TRIPLE_ARCHETYPE_EXPLANATIONS[TRIPLE_ARCHETYPES[key]!]) {
      console.warn(
        `[TRAXR-SOLANA] Missing triple archetype explanation for ${key}`,
      );
    }
  }
}

/* --------------------------------------------------
 * 5. MAIN CONTEXTUAL DISPATCH
 * -------------------------------------------------- */

export function getContextualExplanationForSelection(
  selected: (keyof TraxrNodes)[],
  nodes: TraxrNodes,
): Explanation[] {
  if (selected.length === 1) {
    return [getLocalExplanation(selected[0], nodes[selected[0]])];
  }

  // 3-metric
  if (selected.length === 3) {
    const key = tripleKey(selected[0], selected[1], selected[2]);
    const archetype = TRIPLE_ARCHETYPES[key] ?? "STRUCTURAL";
    return [TRIPLE_ARCHETYPE_EXPLANATIONS[archetype]];
  }

  // 2-metric
  if (selected.length === 2) {
    const [a, b] = selected;
    const key = pairKey(a, b);

    // Try band-specific explanation
    const map = PAIRS[key];
    if (map) {
      const order = PAIR_ORDER[key];
      if (order) {
        const [first, second] = order;
        const v1 = band(nodes[first]);
        const v2 = band(nodes[second]);
        const entry = map[`${v1}_${v2}` as PairBandKey];
        if (entry) return [entry];
      }
    }

    // Fallback to archetype explanation
    const archetype = PAIR_ARCHETYPES[key] ?? "STRUCTURAL";
    return [ARCHETYPE_EXPLANATIONS[archetype]];
  }

  // Fallback (never empty)
  return [
    {
      title: "Context Overview",
      body:
        "The selected metrics provide structural context for interpreting this pool.",
    },
  ];
}
