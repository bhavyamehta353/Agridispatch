import base from "../../../lib/airtable";
import type { FieldSet } from "airtable/lib/field_set";
import { calendarDayInTimeZone, PRICING_TIMEZONE } from "../../../lib/date-freshness";
import { NextRequest, NextResponse } from "next/server";

// Same mapping as Python pricing_agent.py
const MARKET_ID_TO_MANDI: Record<string, string> = {
  MKT001: "Pune APMC",
  MKT002: "Rahuri APMC",
  MKT003: "Mumbai APMC",
};

const PRICE_MIN_KG = 2.0;
const PRICE_MAX_KG = 80.0;

type AirtableRecord = { id: string; get: (name: string) => unknown };

type PriceResult = {
  min: number;
  max: number;
  modal: number;
  arrivalDay: string;
  arrivalsTonnes: number;
};

function perKg(v: unknown): number {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? Math.round((n / 100) * 100) / 100 : 0;
}

function isValid(p: number) {
  return p >= PRICE_MIN_KG && p <= PRICE_MAX_KG;
}

// Convert dd/mm/yyyy → yyyy-mm-dd
function toIsoDate(raw: string): string | null {
  const parts = raw.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

async function fetchFromAgmarknet(
  mandiName: string,
  apiKey: string,
  resourceId: string
): Promise<PriceResult | { error: string }> {
  const url = `https://api.data.gov.in/resource/${resourceId}`;
  const qs = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    "filters[commodity]": "Tomato",
    "filters[market]": mandiName,
    limit: "10",
  });

  let json: { records?: Record<string, unknown>[] };
  try {
    const res = await fetch(`${url}?${qs}`, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    if (!res.ok) {
      return { error: `API returned HTTP ${res.status}` };
    }
    json = (await res.json()) as typeof json;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { error: msg };
  }

  const records = json.records ?? [];
  if (records.length === 0) {
    return { error: `No Agmarknet data for ${mandiName}` };
  }

  // Sort by arrival_date descending to pick the most recent
  records.sort((a, b) => {
    const da = toIsoDate(String(a.arrival_date ?? "")) ?? "0000-00-00";
    const db = toIsoDate(String(b.arrival_date ?? "")) ?? "0000-00-00";
    return db.localeCompare(da);
  });

  const rec = records[0];
  const minKg = perKg(rec.min_price);
  const maxKg = perKg(rec.max_price);
  const modalKg = perKg(rec.modal_price);

  if (!isValid(minKg) || !isValid(maxKg) || !isValid(modalKg)) {
    return { error: `Prices out of valid range for ${mandiName} (min=${minKg}, modal=${modalKg}, max=${maxKg})` };
  }
  if (!(minKg < modalKg && modalKg < maxKg)) {
    return { error: `Price ordering invalid for ${mandiName}: ${minKg} < ${modalKg} < ${maxKg} is false` };
  }

  // Arrivals: API field is in quintals; 1 quintal = 0.1 tonne
  const arrivalsQ =
    parseFloat(String(rec.arrivals ?? rec.quantity ?? "0")) || 0;
  const arrivalsTonnes =
    arrivalsQ > 0 ? Math.round((arrivalsQ / 10) * 100) / 100 : 1.0;

  const rawDate = String(rec.arrival_date ?? "");
  const arrivalDay =
    toIsoDate(rawDate) ?? calendarDayInTimeZone(new Date(), PRICING_TIMEZONE);

  return { min: minKg, max: maxKg, modal: modalKg, arrivalDay, arrivalsTonnes };
}

function resolveMandiName(r: AirtableRecord): string {
  const marketIdText = String(r.get("market_id") ?? "");
  if (marketIdText && MARKET_ID_TO_MANDI[marketIdText]) {
    return MARKET_ID_TO_MANDI[marketIdText];
  }
  // Fall back to market_name stored in Airtable (expected to match API names)
  return String(r.get("market_name") ?? "");
}

// GET — fetch prices without saving (used for modal auto-fill)
export async function GET(request: NextRequest) {
  const apiKey = process.env.DATAGOV_API_KEY;
  const resourceId = process.env.DATAGOV_RESOURCE_ID;
  if (!apiKey || !resourceId) {
    return NextResponse.json(
      { error: "DATAGOV_API_KEY or DATAGOV_RESOURCE_ID not configured." },
      { status: 500 }
    );
  }

  const marketAirtableId = request.nextUrl.searchParams.get("marketAirtableId");
  if (!marketAirtableId) {
    return NextResponse.json({ error: "marketAirtableId is required." }, { status: 400 });
  }

  let marketRecord: AirtableRecord | null = null;
  try {
    const records = await base("Markets")
      .select({ filterByFormula: `RECORD_ID()="${marketAirtableId}"`, maxRecords: 1 })
      .firstPage();
    marketRecord = (records as unknown as AirtableRecord[])[0] ?? null;
  } catch {
    return NextResponse.json({ error: "Failed to load market from Airtable." }, { status: 502 });
  }

  if (!marketRecord) {
    return NextResponse.json({ error: "Market not found." }, { status: 404 });
  }

  const mandiName = resolveMandiName(marketRecord);
  if (!mandiName) {
    return NextResponse.json({ error: "Could not resolve Agmarknet market name." }, { status: 400 });
  }

  const result = await fetchFromAgmarknet(mandiName, apiKey, resourceId);
  if ("error" in result) {
    return NextResponse.json({ result: null, error: result.error }, { status: 200 });
  }
  return NextResponse.json({ result });
}

// POST — fetch prices and save as new Market_Pricing records
export async function POST(request: NextRequest) {
  const apiKey = process.env.DATAGOV_API_KEY;
  const resourceId = process.env.DATAGOV_RESOURCE_ID;
  if (!apiKey || !resourceId) {
    return NextResponse.json(
      { error: "DATAGOV_API_KEY or DATAGOV_RESOURCE_ID not configured." },
      { status: 500 }
    );
  }

  let body: { marketAirtableId?: string } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as typeof body;
  } catch {
    // empty body is fine — means fetch all markets
  }

  const marketRecords = (await base("Markets").select().all()) as unknown as AirtableRecord[];
  const markets = marketRecords.filter(
    (r) => !body.marketAirtableId || r.id === body.marketAirtableId
  );

  const todayDay = calendarDayInTimeZone(new Date(), PRICING_TIMEZONE);

  type ResultRow = {
    marketId: string;
    marketName: string;
    status: "ok" | "no_data" | "api_error" | "invalid";
    message?: string;
    recordId?: string;
    arrivalDay?: string;
    modal?: number;
    min?: number;
    max?: number;
  };

  const results: ResultRow[] = [];

  for (const market of markets) {
    const displayName = String(market.get("market_name") ?? market.id);
    const mandiName = resolveMandiName(market);

    if (!mandiName) {
      results.push({
        marketId: market.id,
        marketName: displayName,
        status: "invalid",
        message: "No Agmarknet name resolved for this market",
      });
      continue;
    }

    const fetched = await fetchFromAgmarknet(mandiName, apiKey, resourceId);

    if ("error" in fetched) {
      results.push({
        marketId: market.id,
        marketName: displayName,
        status: "no_data",
        message: fetched.error,
      });
      continue;
    }

    if (fetched.arrivalDay > todayDay) {
      results.push({
        marketId: market.id,
        marketName: displayName,
        status: "invalid",
        message: "API returned a future arrival date",
      });
      continue;
    }

    try {
      const fields: FieldSet = {
        market_id: [market.id],
        price_date: fetched.arrivalDay,
        price_modal: fetched.modal,
        price_min: fetched.min,
        price_max: fetched.max,
      };
      const created = await base("Market_Pricing").create([{ fields }], {
        typecast: true,
      });
      results.push({
        marketId: market.id,
        marketName: displayName,
        status: "ok",
        recordId: (created[0] as unknown as { id: string })?.id,
        arrivalDay: fetched.arrivalDay,
        modal: fetched.modal,
        min: fetched.min,
        max: fetched.max,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "object" && err !== null && "message" in err
            ? String((err as { message: unknown }).message)
            : JSON.stringify(err);
      console.error("[agmarknet] Airtable write error:", err);
      results.push({
        marketId: market.id,
        marketName: displayName,
        status: "api_error",
        message: msg,
      });
    }
  }

  return NextResponse.json({ results });
}
