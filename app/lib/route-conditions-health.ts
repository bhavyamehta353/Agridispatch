/** Congestion from τ — Route Conditions Panel spec */
export type CongestionLevel = "low" | "moderate" | "high" | "unknown";

/** Decay from decay_risk_score — spec buckets */
export type DecayLevel = "low" | "moderate" | "high" | "unknown";

export type CombinedRouteHealth =
  | "clear"
  | "moderate"
  | "high_risk"
  | "critical"
  | "no_data";

export function congestionFromTau(tau: number | null): CongestionLevel {
  if (tau == null || Number.isNaN(tau)) return "unknown";
  if (tau < 0.2) return "low";
  if (tau < 0.5) return "moderate";
  return "high";
}

export function decayFromScore(score: number | null): DecayLevel {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score < 0.025) return "low";
  if (score < 0.05) return "moderate";
  return "high";
}

/** Treat unknown single-dimension as moderate for combined worst-case (conservative). */
function levelRank(
  c: CongestionLevel,
  hasData: boolean
): "low" | "mod" | "high" {
  if (!hasData) return "mod";
  if (c === "high") return "high";
  if (c === "moderate" || c === "unknown") return "mod";
  return "low";
}

export function combinedRouteHealth(
  congestion: CongestionLevel,
  decay: DecayLevel,
  hasTrafficData: boolean,
  hasEnvData: boolean
): CombinedRouteHealth {
  if (!hasTrafficData && !hasEnvData) return "no_data";

  const t = levelRank(congestion, hasTrafficData);
  const e = levelRank(decay, hasEnvData);

  if (hasTrafficData && hasEnvData) {
    if (t === "high" && e === "high") return "critical";
    if (t === "high" || e === "high") return "high_risk";
    if (t === "mod" || e === "mod") return "moderate";
    return "clear";
  }
  if (hasTrafficData) {
    if (t === "high") return "high_risk";
    if (t === "mod") return "moderate";
    return "clear";
  }
  if (e === "high") return "high_risk";
  if (e === "mod") return "moderate";
  return "clear";
}

export function combinedHealthRank(h: CombinedRouteHealth): number {
  switch (h) {
    case "critical":
      return 5;
    case "high_risk":
      return 4;
    case "moderate":
      return 3;
    case "clear":
      return 2;
    case "no_data":
      return 1;
    default:
      return 0;
  }
}

export function combinedHealthLabel(h: CombinedRouteHealth): string {
  switch (h) {
    case "clear":
      return "✓ Clear";
    case "moderate":
      return "⚠ Moderate";
    case "high_risk":
      return "✗ High Risk";
    case "critical":
      return "✗✗ Critical";
    case "no_data":
      return "No data";
    default:
      return "—";
  }
}

export function drawerInterpretation(h: CombinedRouteHealth): string {
  switch (h) {
    case "clear":
      return "Conditions are favourable for dispatch along this route.";
    case "moderate":
      return "Some risk present — dispatch promptly and ensure packaging integrity.";
    case "high_risk":
      return "Significant risk on this route — consider an alternative market.";
    case "critical":
      return "Both traffic and environmental conditions are poor — strongly consider holding dispatch.";
    case "no_data":
      return "Insufficient condition data for this route — verify inputs before relying on estimates.";
    default:
      return "";
  }
}
