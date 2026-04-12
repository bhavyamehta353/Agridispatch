import base from "../../lib/airtable";
import Airtable from "airtable";
import type { FieldSet } from "airtable/lib/field_set";
import {
  calendarDayInTimeZone,
  calendarDaysBehind,
  cardStaleLevel,
  formatLongDate,
  globalFreshnessLevel,
  globalFreshnessMessage,
  PRICING_TIMEZONE,
} from "../../lib/pricing-freshness";
import { NextRequest, NextResponse } from "next/server";

type AirtableRecord = {
  id: string;
  get: (name: string) => unknown;
};

function rawCreatedTime(r: AirtableRecord): string | null {
  const raw = (r as unknown as { _rawJson?: { createdTime?: string } })
    ._rawJson;
  return raw?.createdTime ?? null;
}

function linkedIds(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.startsWith("rec")) return [val];
  return [];
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v != null) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function arrivalCalendarDay(v: unknown): string | null {
  if (v == null) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return calendarDayInTimeZone(d, PRICING_TIMEZONE);
}

function formatCommission(c: unknown): string {
  const n = num(c);
  if (n == null) return "—";
  const pct = n >= 0 && n <= 1 ? n * 100 : n;
  return `${pct.toFixed(1)}%`;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const historyMarketId = searchParams.get("historyMarketId") ?? "";
    let historyFrom = searchParams.get("historyFrom") ?? "";
    let historyTo = searchParams.get("historyTo") ?? "";
    const historyDays = Math.min(
      90,
      Math.max(1, parseInt(searchParams.get("historyDays") ?? "7", 10) || 7)
    );

    const now = new Date();
    const todayDay = calendarDayInTimeZone(now, PRICING_TIMEZONE);
    if (!historyFrom || !historyTo) {
      const end = new Date(now);
      const start = new Date(now);
      start.setUTCDate(start.getUTCDate() - historyDays);
      if (!historyTo) historyTo = calendarDayInTimeZone(end, PRICING_TIMEZONE);
      if (!historyFrom)
        historyFrom = calendarDayInTimeZone(start, PRICING_TIMEZONE);
    }

    const [marketRecords, pricingRecords] = await Promise.all([
      base("Markets").select().all(),
      base("Market_Pricing").select().all(),
    ]);

    const markets = (marketRecords as unknown as AirtableRecord[]).map((r) => ({
      id: r.id,
      marketName: String(r.get("market_name") ?? "Market"),
      location: String(r.get("location") ?? ""),
      commission: r.get("default_commission"),
      commissionDisplay: formatCommission(r.get("default_commission")),
    }));

    const pricingRows = (pricingRecords as unknown as AirtableRecord[]).map(
      (r) => {
        const mids = linkedIds(r.get("market_id"));
        const marketId = mids[0] ?? "";
        const arrivalRaw = r.get("arrival_date");
        const arrivalDay = arrivalCalendarDay(arrivalRaw);
        return {
          recordId: r.id,
          marketId,
          arrivalRaw,
          arrivalDay,
          modalPrice: num(r.get("modal_price")) ?? num(r.get("price_per_kg")),
          minPrice: num(r.get("min_price")),
          maxPrice: num(r.get("max_price")),
          arrivalsTonnes: num(r.get("arrivals_tonnes")),
          source: String(r.get("source") ?? "Manual"),
          createdTime: rawCreatedTime(r),
        };
      }
    );

    const latestByMarket = new Map<
      string,
      (typeof pricingRows)[number]
    >();
    const sortedForLatest = [...pricingRows].sort((a, b) => {
      const ad = a.arrivalDay ?? "";
      const bd = b.arrivalDay ?? "";
      if (bd !== ad) return bd.localeCompare(ad);
      const ac = a.createdTime ?? "";
      const bc = b.createdTime ?? "";
      return bc.localeCompare(ac);
    });
    for (const row of sortedForLatest) {
      if (!row.marketId) continue;
      if (!latestByMarket.has(row.marketId)) latestByMarket.set(row.marketId, row);
    }

    const latestDaysWithData = [...latestByMarket.values()]
      .map((r) => r.arrivalDay)
      .filter((d): d is string => !!d);
    const referenceDay =
      latestDaysWithData.length > 0
        ? latestDaysWithData.reduce((a, b) => (a < b ? a : b))
        : null;
    const daysBehind =
      referenceDay != null
        ? calendarDaysBehind(referenceDay, todayDay)
        : null;
    const level = globalFreshnessLevel(daysBehind);
    const longDate = formatLongDate(todayDay, PRICING_TIMEZONE);
    const freshnessMessage = globalFreshnessMessage(
      level,
      referenceDay,
      todayDay,
      longDate
    );

    const marketCards = markets.map((m) => {
      const latest = latestByMarket.get(m.id) ?? null;
      const cardStale = cardStaleLevel(
        latest?.arrivalDay ?? null,
        todayDay
      );
      return {
        ...m,
        latest: latest
          ? {
              recordId: latest.recordId,
              arrivalDay: latest.arrivalDay,
              arrivalRaw: latest.arrivalRaw,
              modalPrice: latest.modalPrice,
              minPrice: latest.minPrice,
              maxPrice: latest.maxPrice,
              arrivalsTonnes: latest.arrivalsTonnes,
              source: latest.source,
              createdTime: latest.createdTime,
              cardStaleLevel: cardStale,
            }
          : null,
      };
    });

    const activeRecordIds = new Set(
      [...latestByMarket.values()].map((r) => r.recordId)
    );

    let history = [...pricingRows].sort((a, b) => {
      const ad = a.arrivalDay ?? "";
      const bd = b.arrivalDay ?? "";
      if (bd !== ad) return bd.localeCompare(ad);
      const ac = a.createdTime ?? "";
      const bc = b.createdTime ?? "";
      return bc.localeCompare(ac);
    });

    history = history.filter((row) => {
      if (historyMarketId && row.marketId !== historyMarketId) return false;
      const day = row.arrivalDay;
      if (!day) return false;
      if (day < historyFrom) return false;
      if (day > historyTo) return false;
      return true;
    });

    const historyOut = history.map((row) => {
      const m = markets.find((x) => x.id === row.marketId);
      return {
        recordId: row.recordId,
        marketId: row.marketId,
        marketName: m?.marketName ?? "Unknown market",
        arrivalDay: row.arrivalDay,
        arrivalRaw: row.arrivalRaw,
        modalPrice: row.modalPrice,
        minPrice: row.minPrice,
        maxPrice: row.maxPrice,
        arrivalsTonnes: row.arrivalsTonnes,
        source: row.source,
        createdTime: row.createdTime,
        isActive: activeRecordIds.has(row.recordId),
      };
    });

    return NextResponse.json({
      timeZone: PRICING_TIMEZONE,
      todayCalendar: todayDay,
      freshness: {
        level,
        daysBehind,
        referenceDay,
        headline: freshnessMessage.headline,
        detail: freshnessMessage.detail,
      },
      markets: marketCards,
      history: historyOut,
      historyRange: { from: historyFrom, to: historyTo },
      activeRecordIds: [...activeRecordIds],
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load market pricing.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

const SOURCE_VALUES = new Set(["Manual", "Agmarknet"]);

export async function POST(request: Request) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json(
      { error: "Server is missing Airtable configuration." },
      { status: 500 }
    );
  }

  let body: {
    marketId?: string;
    arrival_date?: string;
    modal_price?: number;
    min_price?: number;
    max_price?: number;
    arrivals_tonnes?: number;
    source?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const marketId = body.marketId?.trim();
  if (!marketId || !marketId.startsWith("rec")) {
    return NextResponse.json({ error: "marketId must be a valid record id." }, { status: 400 });
  }

  if (!body.arrival_date || typeof body.arrival_date !== "string") {
    return NextResponse.json({ error: "arrival_date is required." }, { status: 400 });
  }
  const arrivalDay = arrivalCalendarDay(body.arrival_date);
  const todayDay = calendarDayInTimeZone(new Date(), PRICING_TIMEZONE);
  if (!arrivalDay) {
    return NextResponse.json({ error: "Invalid arrival_date." }, { status: 400 });
  }
  if (arrivalDay > todayDay) {
    return NextResponse.json(
      { error: "Arrival date cannot be in the future." },
      { status: 400 }
    );
  }

  const minP = num(body.min_price);
  const maxP = num(body.max_price);
  const modalP = num(body.modal_price);
  const arrivals = num(body.arrivals_tonnes);

  if (minP == null || maxP == null || modalP == null) {
    return NextResponse.json(
      { error: "modal_price, min_price, and max_price are required." },
      { status: 400 }
    );
  }
  if (minP >= maxP) {
    return NextResponse.json(
      { error: "min_price must be less than max_price." },
      { status: 400 }
    );
  }
  if (modalP <= minP || modalP >= maxP) {
    return NextResponse.json(
      { error: "modal_price must be strictly between min_price and max_price." },
      { status: 400 }
    );
  }
  if (arrivals == null || arrivals <= 0) {
    return NextResponse.json(
      { error: "arrivals_tonnes must be a positive number." },
      { status: 400 }
    );
  }

  const source = body.source ?? "Manual";
  if (!SOURCE_VALUES.has(source)) {
    return NextResponse.json(
      { error: "source must be Manual or Agmarknet." },
      { status: 400 }
    );
  }

  const fields: FieldSet = {
    market_id: [marketId],
    arrival_date: body.arrival_date,
    modal_price: modalP,
    min_price: minP,
    max_price: maxP,
    arrivals_tonnes: arrivals,
    source,
  };

  try {
    const created = await base("Market_Pricing").create(
      [{ fields }],
      { typecast: true }
    );
    const rec = created[0];
    return NextResponse.json({
      ok: true,
      recordId: rec?.id,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Airtable.Error
        ? err.message
        : err instanceof Error
          ? err.message
          : "Failed to create pricing record.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
