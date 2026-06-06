import base from "../../../../lib/airtable";
import { NextResponse } from "next/server";

type Rec = { id: string; get: (k: string) => unknown };

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ recordId: string }> }
) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json(
      { error: "Server is missing Airtable configuration." },
      { status: 500 }
    );
  }

  const { recordId } = await context.params;

  let body: { temperatureC?: number; humidityPct?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (body.temperatureC == null && body.humidityPct == null) {
    return NextResponse.json(
      { error: "Provide at least one of: temperatureC, humidityPct." },
      { status: 400 }
    );
  }

  if (
    body.temperatureC != null &&
    (body.temperatureC < -10 || body.temperatureC > 60)
  ) {
    return NextResponse.json(
      { error: "temperatureC must be between -10 and 60." },
      { status: 400 }
    );
  }

  if (
    body.humidityPct != null &&
    (body.humidityPct < 0 || body.humidityPct > 100)
  ) {
    return NextResponse.json(
      { error: "humidityPct must be between 0 and 100." },
      { status: 400 }
    );
  }

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

    const riskRecords = await base("Environmental_Risk").select().all();
    const batchRiskRecords = (riskRecords as unknown as Rec[]).filter((r) =>
      matchesBatchRef(r.get("batch_id"), recordId, bidText)
    );

    if (batchRiskRecords.length === 0) {
      return NextResponse.json(
        { error: "No environmental risk records found for this batch." },
        { status: 404 }
      );
    }

    const fields: Record<string, number> = {};
    if (body.temperatureC != null) fields.avg_temp_c = body.temperatureC;
    if (body.humidityPct != null) fields.avg_humidity_pct = body.humidityPct;

    await Promise.all(
      batchRiskRecords.map((r) =>
        base("Environmental_Risk").update(r.id, fields, { typecast: true })
      )
    );

    return NextResponse.json({ ok: true, updated: batchRiskRecords.length });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update risk data.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
