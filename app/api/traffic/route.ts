import base from "../../lib/airtable";
import { NextResponse } from "next/server";

export async function GET() {
  const records = await base("Traffic_Estimates").select().all();

  const data = records.map((r) => ({
    batchId: r.get("batch_id"),
    marketId: r.get("market_id"),
    pairKey: r.get("pair_key"),
    distance: r.get("distance_km"),
    baseTime: r.get("t_base_hr"),
    actualTime: r.get("t_actual_hr"),
    tau: r.get("tau"),
    effectiveTime: r.get("t_eff_hr"),
  }));

  return NextResponse.json(data);
}