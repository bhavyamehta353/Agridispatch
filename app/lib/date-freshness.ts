/** Calendar day YYYY-MM-DD in a given IANA timezone. */
export function calendarDayInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export const PRICING_TIMEZONE = "Asia/Kolkata";

export type FreshnessLevel = "none" | "green" | "amber" | "red";

export type CardStaleLevel = "ok" | "yesterday" | "stale";

/** Days from reference calendar day to today (today minus ref). 0 = same day. */
export function calendarDaysBehind(
  referenceDay: string,
  todayDay: string
): number {
  const a = new Date(referenceDay + "T12:00:00Z").getTime();
  const b = new Date(todayDay + "T12:00:00Z").getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

export function globalFreshnessLevel(daysBehind: number | null): FreshnessLevel {
  if (daysBehind === null) return "none";
  if (daysBehind <= 0) return "green";
  if (daysBehind === 1) return "amber";
  return "red";
}

export function cardStaleLevel(
  marketLatestDay: string | null,
  todayDay: string
): CardStaleLevel {
  if (!marketLatestDay) return "stale";
  const d = calendarDaysBehind(marketLatestDay, todayDay);
  if (d <= 0) return "ok";
  if (d === 1) return "yesterday";
  return "stale";
}

export function globalFreshnessMessage(
  level: FreshnessLevel,
  referenceDay: string | null,
  todayDay: string,
  longDate: string
): { headline: string; detail?: string } {
  if (level === "none") {
    return {
      headline: "No price data - enter prices to enable evaluations",
      detail:
        "Add daily prices for each APMC market before running batch evaluation.",
    };
  }
  if (level === "green") {
    return {
      headline: `Prices current as of today, ${longDate}`,
    };
  }
  if (level === "amber") {
    return {
      headline:
        "Prices are 1 day old - consider updating before running evaluation",
      detail:
        referenceDay != null
          ? `Latest shared arrival date in use: ${referenceDay}`
          : undefined,
    };
  }
  return {
    headline: "Price data is stale - evaluations may be unreliable",
    detail:
      referenceDay != null
        ? `Oldest current arrival date across markets: ${referenceDay} (today: ${todayDay})`
        : undefined,
  };
}

export function formatLongDate(day: string, timeZone: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, 12, 0, 0);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(utc));
}
