import base from "../../lib/airtable";
import { NextResponse } from "next/server";

export async function GET() {
  const records = await base("Route_Reference").select().all();

  const data = records.map((r) => ({
    origin: r.get("origin_name"),
    originKey: r.get("origin_key"),
    marketKey: r.get("market_key"),
    pairKey: r.get("pair_key"),
    marketId: r.get("market_id"),
    distance: r.get("distance_km"),
    baseTime: r.get("t_base_hr"),
  }));

  return NextResponse.json(data);
}