import { PRICING_TIMEZONE } from "./date-freshness";
import { formatTrafficTimestamp } from "./traffic-freshness";

export type EnvFreshnessLevel = "none" | "green" | "amber" | "red";

export function environmentalDataFreshnessLevel(
  ageHours: number | null
): EnvFreshnessLevel {
  if (ageHours === null) return "none";
  if (ageHours <= 3) return "green";
  if (ageHours <= 8) return "amber";
  return "red";
}

export function environmentalFreshnessCopy(
  level: EnvFreshnessLevel,
  lastUpdatedLong: string | null
): { headline: string; detail?: string } {
  if (level === "none") {
    return {
      headline:
        "Stale environmental data — decay risk estimates unreliable",
      detail: "No Environmental_Risk records found in Airtable.",
    };
  }
  if (level === "green") {
    return {
      headline: lastUpdatedLong
        ? `Environmental data current as of ${lastUpdatedLong}`
        : "Environmental data is current",
    };
  }
  if (level === "amber") {
    return {
      headline: "Conditions may have changed — consider refreshing",
      detail:
        lastUpdatedLong != null
          ? `Last environmental update: ${lastUpdatedLong}`
          : undefined,
    };
  }
  return {
    headline:
      "Stale environmental data — decay risk estimates unreliable",
    detail:
      lastUpdatedLong != null
        ? `Last environmental update: ${lastUpdatedLong}`
        : undefined,
  };
}

export function formatEnvTimestamp(
  iso: string,
  timeZone: string = PRICING_TIMEZONE
): string {
  return formatTrafficTimestamp(iso, timeZone);
}
