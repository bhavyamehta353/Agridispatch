import base from "../../lib/airtable";
import { NextResponse } from "next/server";

export async function GET() {
  const records = await base("Environmental_Risk").select().all();

  const data = records.map((r) => ({
    batchId: r.get("batch_id"),
    marketId: r.get("market_id"),
    pairKey: r.get("pair_key"),
    temp: r.get("avg_temp_c"),
    humidity: r.get("avg_humidity_pct"),
    kBase: r.get("k_base"),
    kEff: r.get("k_eff"),
    arrivalQuality: r.get("quality_arrival_pred"),
  }));

  return NextResponse.json(data);
}