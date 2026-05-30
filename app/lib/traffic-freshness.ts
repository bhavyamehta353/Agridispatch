import { PRICING_TIMEZONE } from "./date-freshness";

export type TrafficFreshnessLevel = "none" | "green" | "amber" | "red";

/** Age in whole hours from `latestIso` to `now` (non-negative). */
export function ageHoursSince(latestIso: string, now: Date): number | null {
  const t = new Date(latestIso).getTime();
  if (Number.isNaN(t)) return null;
  const ms = now.getTime() - t;
  if (ms < 0) return 0;
  return ms / (3600 * 1000);
}

export function trafficDataFreshnessLevel(
  ageHours: number | null
): TrafficFreshnessLevel {
  if (ageHours === null) return "none";
  if (ageHours <= 2) return "green";
  if (ageHours <= 6) return "amber";
  return "red";
}

export function trafficFreshnessCopy(
  level: TrafficFreshnessLevel,
  lastUpdatedLong: string | null
): { headline: string; detail?: string } {
  if (level === "none") {
    return {
      headline:
        "Stale traffic data — evaluations using these estimates may be unreliable",
      detail: "No Traffic_Estimates records found in Airtable.",
    };
  }
  if (level === "green") {
    return {
      headline: lastUpdatedLong
        ? `Traffic data current as of ${lastUpdatedLong}`
        : "Traffic data is current",
    };
  }
  if (level === "amber") {
    return {
      headline: "Traffic data may not reflect current conditions",
      detail:
        lastUpdatedLong != null
          ? `Last recorded update: ${lastUpdatedLong}`
          : undefined,
    };
  }
  return {
    headline:
      "Stale traffic data — logistics cost estimates unreliable",
    detail:
      lastUpdatedLong != null
        ? `Last recorded update: ${lastUpdatedLong}`
        : undefined,
  };
}

export function formatTrafficTimestamp(
  iso: string,
  timeZone: string = PRICING_TIMEZONE
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}
