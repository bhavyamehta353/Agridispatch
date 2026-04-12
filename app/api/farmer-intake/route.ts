import base from "../../lib/airtable";
import { originByName } from "../../lib/origins";
import Airtable from "airtable";
import type { FieldSet } from "airtable/lib/field_set";
import { NextResponse } from "next/server";

/**
 * Optional: API name of a *linked record* field on Handling_Quality → Farmer_Batches.
 * `batch_id` on Handling_Quality is the farmer’s code (same value as on Farmer_Batches), not `rec…` ids.
 * Set this only if your base has a separate link column (e.g. "Farmer_Batches").
 */
function handlingBatchLinkField(): string {
  return process.env.AIRTABLE_HANDLING_BATCH_LINK_FIELD?.trim() ?? "";
}

function airtableErrorMessage(err: unknown): string {
  if (err instanceof Airtable.Error) {
    return err.message || err.error || "Airtable error.";
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "Airtable request failed.";
}

const MATURITY = new Set([
  "Breaker",
  "Turning",
  "Pink",
  "Light Red",
  "Red Ripe",
]);
const HARVEST_METHOD = new Set(["Mixed", "Selective", "Hand-picked"]);
const PACKAGING = new Set([
  "Wooden Crate",
  "Plastic Crate",
  "Gunny Bag",
]);
const FILL = new Set(["Low", "Medium", "High"]);

type Body = {
  batch_id?: string | number;
  origin_name?: string;
  harvest_time?: string;
  weight_harvest_kg?: unknown;
  maturity_grade?: string;
  harvest_method?: string;
  packaging_type?: string;
  fill_level?: string;
};

function parseBody(json: Body) {
  const {
    batch_id,
    origin_name,
    harvest_time,
    weight_harvest_kg,
    maturity_grade,
    harvest_method,
    packaging_type,
    fill_level,
  } = json;

  const batchIdStr =
    typeof batch_id === "number" && Number.isFinite(batch_id)
      ? String(batch_id)
      : typeof batch_id === "string"
        ? batch_id.trim()
        : "";
  if (!batchIdStr) {
    return { error: "batch_id is required." };
  }
  if (batchIdStr.length > 120) {
    return { error: "batch_id is too long (max 120 characters)." };
  }

  if (!origin_name || typeof origin_name !== "string") {
    return { error: "origin_name is required." };
  }
  const origin = originByName(origin_name.trim());
  if (!origin) {
    return { error: "origin_name must be one of the registered farm locations." };
  }

  if (!harvest_time || typeof harvest_time !== "string") {
    return { error: "harvest_time is required (ISO date string)." };
  }
  const harvestDate = new Date(harvest_time);
  if (Number.isNaN(harvestDate.getTime())) {
    return { error: "harvest_time is not a valid date." };
  }

  const weight = Number(weight_harvest_kg);
  if (!Number.isFinite(weight) || weight <= 0 || !Number.isInteger(weight)) {
    return {
      error: "weight_harvest_kg must be a positive whole number (kg).",
    };
  }

  if (!maturity_grade || !MATURITY.has(maturity_grade)) {
    return {
      error: "maturity_grade is not a valid option.",
    };
  }

  if (!harvest_method || !HARVEST_METHOD.has(harvest_method)) {
    return {
      error: "harvest_method must be Mixed, Selective, or Hand-picked.",
    };
  }

  if (!packaging_type || !PACKAGING.has(packaging_type)) {
    return {
      error:
        "packaging_type must be Wooden Crate, Plastic Crate, or Gunny Bag.",
    };
  }

  if (!fill_level || !FILL.has(fill_level)) {
    return {
      error: "fill_level must be Low, Medium, or High.",
    };
  }

  const batchIdField: string | number =
    /^\d+$/.test(batchIdStr) ? parseInt(batchIdStr, 10) : batchIdStr;

  return {
    ok: true as const,
    batch_id: batchIdField,
    origin_id: origin.origin_id,
    origin_name: origin.origin_name,
    origin_lat: origin.origin_lat,
    origin_lng: origin.origin_lng,
    harvest_time: harvestDate.toISOString(),
    weight_harvest_kg: weight,
    maturity_grade,
    harvest_method,
    packaging_type,
    fill_level,
  };
}

export async function POST(request: Request) {
  if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    return NextResponse.json(
      { error: "Server is missing Airtable configuration." },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = parseBody(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  let airtableRecordId: string | undefined;

  try {
    const batchRecords = await base("Farmer_Batches").create(
      [
        {
          fields: {
            batch_id: parsed.batch_id,
            farm_origin_id: parsed.origin_id,
            origin_id: parsed.origin_id,
            origin_name: parsed.origin_name,
            origin_lat: parsed.origin_lat,
            origin_lng: parsed.origin_lng,
            harvest_time: parsed.harvest_time,
            weight_harvest_kg: parsed.weight_harvest_kg,
            weight_kg: parsed.weight_harvest_kg,
            maturity_grade: parsed.maturity_grade,
            harvest_method: parsed.harvest_method,
            status: "Submitted",
          },
        },
      ],
      { typecast: true }
    );

    const batchRecord = batchRecords[0];
    airtableRecordId = batchRecord?.id;
    if (!airtableRecordId) {
      return NextResponse.json(
        {
          error:
            "Airtable created a batch but did not return a record id. Check your API version and table name.",
        },
        { status: 502 }
      );
    }

    const handlingFields: FieldSet = {
      batch_id: parsed.batch_id,
      packaging_type: parsed.packaging_type,
      fill_level: parsed.fill_level,
    };

    const linkField = handlingBatchLinkField();
    if (linkField.length > 0) {
      handlingFields[linkField] = [airtableRecordId];
    }

    const handlingRecords = await base("Handling_Quality").create(
      [{ fields: handlingFields }],
      { typecast: true }
    );

    const handlingRecord = handlingRecords[0];
    const handlingRecordId = handlingRecord?.id;
    if (!handlingRecordId) {
      return NextResponse.json(
        {
          error:
            "Handling row was not created correctly (missing record id). Your batch row may still exist in Airtable.",
          batchRecordId: airtableRecordId,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      batchRecordId: airtableRecordId,
      handlingRecordId,
    });
  } catch (err: unknown) {
    const message = airtableErrorMessage(err);
    const body: Record<string, unknown> = { error: message };
    if (airtableRecordId) {
      body.batchRecordId = airtableRecordId;
      body.hint =
        "Farmer_Batches may already have this row. If you use a linked-record column to Farmer_Batches, set AIRTABLE_HANDLING_BATCH_LINK_FIELD to that field’s API name (not batch_id).";
    }
    return NextResponse.json(body, { status: 502 });
  }
}
