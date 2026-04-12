import base from "../../lib/airtable";
import { NextResponse } from "next/server";

export async function GET() {
  const records = await base("Markets").select().all();

  const data = records.map((r) => ({
    id: r.id,
    name: r.get("market_name"),
    location: r.get("location"),
    lat: r.get("market_lat"),
    lng: r.get("market_lng"),
    fee: r.get("default_fee"),
    commission: r.get("default_commission"),
  }));

  return NextResponse.json(data);
}