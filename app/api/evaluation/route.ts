import base from "../../lib/airtable";
import { NextResponse } from "next/server";

export async function GET() {
  const records = await base("Market_Evaluation").select().all();

  const data = records.map((r) => ({
    batchId: r.get("batch_id"),
    marketId: r.get("market_id"),
    pairKey: r.get("pair_key"),
    arrivalQuality: r.get("arrival_quality"),
    effectiveWeight: r.get("effective_weight_kg"),
    price: r.get("price_per_kg"),
    fee: r.get("market_fee"),
    commission: r.get("commission_pct"),
    revenue: r.get("gross_revenue"),
    logisticsCost: r.get("logistics_cost"),
    profit: r.get("net_profit"),
    feasible: r.get("quality_feasible"),
    recommended: r.get("recommended"),
  }));

  return NextResponse.json(data);
}