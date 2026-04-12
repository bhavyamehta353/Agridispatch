import base from "../../lib/airtable";
import { NextResponse } from "next/server";

export async function GET() {
  const records = await base("Market_Pricing").select().all();

  const data = records.map((r) => ({
    marketId: r.get("market_id"),
    marketKey: r.get("market_key"),
    price: r.get("price_per_kg"),
  }));

  return NextResponse.json(data);
}