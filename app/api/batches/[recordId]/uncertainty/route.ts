import base from "../../../../lib/airtable";
import { NextResponse } from "next/server";

const FEASIBILITY_THRESHOLD = 0.70;

type Rec = { id: string; get: (k: string) => unknown };

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v != null) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function matchesBatchRef(
  foreignVal: unknown,
  batchRecordId: string,
  bidText: string
): boolean {
  if (foreignVal == null) return false;
  if (Array.isArray(foreignVal)) {
    if (foreignVal.includes(batchRecordId)) return true;
    return foreignVal.some((x) => String(x) === bidText);
  }
  if (typeof foreignVal === "string") {
    if (foreignVal === batchRecordId) return true;
    return foreignVal === bidText;
  }
  return String(foreignVal) === bidText;
}

function linkedIds(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.startsWith("rec")) return [val];
  return [];
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ recordId: string }> }
) {
  const { recordId } = await context.params;

  try {
    let batchRecord: Rec;
    try {
      batchRecord = (await base("Farmer_Batches").find(
        recordId
      )) as unknown as Rec;
    } catch {
      return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    }

    const bidText = String(batchRecord.get("batch_id") ?? "");

    const [uncertaintyRecords, marketRecords] = await Promise.all([
      base("Uncertainty_Analysis").select({ maxRecords: 100 }).all(),
      base("Markets").select().all(),
    ]);

    const marketNames = (marketRecords as unknown as Rec[]).reduce<
      Record<string, string>
    >((acc, m) => {
      acc[m.id] = String(m.get("market_name") ?? "Market");
      return acc;
    }, {});

    const batchRows = (uncertaintyRecords as unknown as Rec[]).filter((r) =>
      matchesBatchRef(r.get("batch_id"), recordId, bidText)
    );

    if (batchRows.length === 0) {
      return NextResponse.json({
        hasData: false,
        markets: [],
        mcRecommendedMarketId: null,
        feasibilityThreshold: FEASIBILITY_THRESHOLD,
        nSimulations: 0,
      });
    }

    const parsed = batchRows.map((r) => {
      const marketId = linkedIds(r.get("market_id"))[0] ?? "";
      const feasibilityProb = num(r.get("feasibility_prob")) ?? 0;
      return {
        marketId,
        marketName: marketNames[marketId] ?? "Market",
        netProfitWorst:  num(r.get("net_profit_p10")) ?? 0,
        netProfitLikely: num(r.get("net_profit_p50")) ?? 0,
        netProfitBest:   num(r.get("net_profit_p90")) ?? 0,
        netProfitStd:    num(r.get("net_profit_std")) ?? 0,
        feasibilityProb,
        recommendationStability: num(r.get("recommendation_stability")) ?? 0,
        nSimulations: num(r.get("n_simulations")) ?? 1000,
        gated: feasibilityProb < FEASIBILITY_THRESHOLD,
      };
    });

    // MC recommended = highest p50 among markets that cleared the feasibility gate
    const eligible = parsed.filter((m) => !m.gated);
    const mcRecommended =
      eligible.sort((a, b) => b.netProfitLikely - a.netProfitLikely)[0] ??
      null;

    return NextResponse.json({
      hasData: true,
      mcRecommendedMarketId: mcRecommended?.marketId ?? null,
      feasibilityThreshold: FEASIBILITY_THRESHOLD,
      nSimulations: parsed[0]?.nSimulations ?? 1000,
      markets: parsed,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load uncertainty data.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
