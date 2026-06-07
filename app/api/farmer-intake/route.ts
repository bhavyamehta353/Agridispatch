import { originByName } from "../../lib/origins";
import { NextResponse } from "next/server";

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
    origin_name,
    harvest_time,
    weight_harvest_kg,
    maturity_grade,
    harvest_method,
    packaging_type,
    fill_level,
  } = json;

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
    return { error: "maturity_grade is not a valid option." };
  }

  if (!harvest_method || !HARVEST_METHOD.has(harvest_method)) {
    return { error: "harvest_method must be Mixed, Selective, or Hand-picked." };
  }

  if (!packaging_type || !PACKAGING.has(packaging_type)) {
    return {
      error: "packaging_type must be Wooden Crate, Plastic Crate, or Gunny Bag.",
    };
  }

  if (!fill_level || !FILL.has(fill_level)) {
    return { error: "fill_level must be Low, Medium, or High." };
  }

  return {
    ok: true as const,
    origin_id: origin.origin_id,
    harvest_time: harvestDate.toISOString(),
    weight_harvest_kg: weight,
    maturity_grade,
    harvest_method,
    packaging_type,
    fill_level,
  };
}

export async function POST(request: Request) {
  if (!process.env.N8N_FARMER_INTAKE_WEBHOOK_URL) {
    return NextResponse.json(
      { error: "Server is missing n8n webhook configuration." },
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

  try {
    const n8nRes = await fetch(process.env.N8N_FARMER_INTAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        origin_id: parsed.origin_id,
        weight_harvest_kg: parsed.weight_harvest_kg,
        maturity_grade: parsed.maturity_grade,
        harvest_method: parsed.harvest_method,
        packaging_type: parsed.packaging_type,
        fill_level: parsed.fill_level,
        harvest_time: parsed.harvest_time,
      }),
    });

    if (!n8nRes.ok) {
      const errText = await n8nRes.text();
      return NextResponse.json(
        { error: `n8n error: ${errText}` },
        { status: 502 }
      );
    }

    const n8nData = (await n8nRes.json()) as Record<string, unknown>;
    return NextResponse.json(n8nData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "n8n request failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
