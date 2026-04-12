import base from "../../../lib/airtable";
import type { FieldSet } from "airtable/lib/field_set";
import { NextResponse } from "next/server";

const ALLOWED_STATUS = new Set([
  "Submitted",
  "Evaluated",
  "Dispatched",
  "Error",
]);

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
  let body: {
    status?: string;
    flag_for_review?: boolean;
    review_note?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const hasStatus = body.status !== undefined;
  const hasFlag = body.flag_for_review !== undefined;
  const hasNote = body.review_note !== undefined;

  if (!hasStatus && !hasFlag && !hasNote) {
    return NextResponse.json(
      {
        error:
          "Provide at least one of: status, flag_for_review, review_note.",
      },
      { status: 400 }
    );
  }

  if (hasStatus) {
    const status = body.status;
    if (!status || !ALLOWED_STATUS.has(status)) {
      return NextResponse.json(
        {
          error:
            "status must be one of: Submitted, Evaluated, Dispatched, Error.",
        },
        { status: 400 }
      );
    }
  }

  const fields: FieldSet = {};
  if (hasStatus) fields.status = body.status;
  if (hasFlag) fields.flag_for_review = body.flag_for_review;
  if (hasNote) fields.review_note = body.review_note;

  try {
    await base("Farmer_Batches").update(recordId, fields, { typecast: true });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update batch.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
