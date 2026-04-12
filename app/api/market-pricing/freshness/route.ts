import base from "../../../lib/airtable";
import {
  calendarDayInTimeZone,
  calendarDaysBehind,
  formatLongDate,
  globalFreshnessLevel,
  globalFreshnessMessage,
  PRICING_TIMEZONE,
} from "../../../lib/pricing-freshness";
import { NextResponse } from "next/server";

type AirtableRecord = { id: string; get: (name: string) => unknown };

function linkedIds(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.startsWith("rec")) return [val];
  return [];
}

function arrivalCalendarDay(v: unknown): string | null {
  if (v == null) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return calendarDayInTimeZone(d, PRICING_TIMEZONE);
}

/** Lightweight payload for embedding on other dashboard pages. */
export async function GET() {
  try {
    const now = new Date();
    const todayDay = calendarDayInTimeZone(now, PRICING_TIMEZONE);
    const [marketRecords, pricingRecords] = await Promise.all([
      base("Markets").select().all(),
      base("Market_Pricing").select().all(),
    ]);

    const totalMarkets = (marketRecords as unknown as AirtableRecord[]).length;
    const pricingRows = (pricingRecords as unknown as AirtableRecord[]).map(
      (r) => {
        const mids = linkedIds(r.get("market_id"));
        return {
          marketId: mids[0] ?? "",
          arrivalDay: arrivalCalendarDay(r.get("arrival_date")),
        };
      }
    );

    const latestByMarket = new Map<string, string>();
    const sorted = [...pricingRows]
      .filter((x) => x.marketId && x.arrivalDay)
      .sort((a, b) => (b.arrivalDay ?? "").localeCompare(a.arrivalDay ?? ""));
    for (const row of sorted) {
      if (!latestByMarket.has(row.marketId))
        latestByMarket.set(row.marketId, row.arrivalDay!);
    }

    const latestDaysWithData = [...latestByMarket.values()];
    const referenceDay =
      latestDaysWithData.length > 0
        ? latestDaysWithData.reduce((a, b) => (a < b ? a : b))
        : null;
    const daysBehind =
      referenceDay != null
        ? calendarDaysBehind(referenceDay, todayDay)
        : null;
    const level = globalFreshnessLevel(daysBehind);
    const longToday = formatLongDate(todayDay, PRICING_TIMEZONE);
    const msg = globalFreshnessMessage(
      level,
      referenceDay,
      todayDay,
      longToday
    );

    const marketsWithPricing = latestByMarket.size;

    return NextResponse.json({
      timeZone: PRICING_TIMEZONE,
      todayCalendar: todayDay,
      level,
      daysBehind,
      referenceDay,
      headline: msg.headline,
      detail: msg.detail,
      marketsWithPricing,
      totalMarkets,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load pricing freshness.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
