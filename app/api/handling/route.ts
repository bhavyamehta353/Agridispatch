import base from "../../lib/airtable";
import { NextResponse } from "next/server";

export async function GET() {
  const records = await base("Handling_Quality").select().all();

  const data = records.map((r) => ({
    id: r.id,
    batchId: r.get("batch_id"),
    packagingType: r.get("packaging_type"),
    fillLevel: r.get("fill_level"),
    handlingLevel: r.get("handling_level"),
    sortingQuality: r.get("sorting_quality"),
    rejectRate: r.get("reject_rate"),
    weightPacked: r.get("weight_packed_kg"),
    damageFactor: r.get("damage_factor"),
    qualityPacked: r.get("quality_packed"),
    kMultiplier: r.get("k_multiplier"),
  }));

  return NextResponse.json(data);
}