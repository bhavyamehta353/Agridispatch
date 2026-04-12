import { NextResponse } from "next/server";

/** Placeholder until the evaluation pipeline is wired (e.g. serverless job or Airtable automation). */
export async function POST(
  _request: Request,
  _context: { params: Promise<{ recordId: string }> }
) {
  return NextResponse.json(
    {
      ok: false,
      message:
        "Manual evaluation trigger is not connected yet. Use your Airtable automation or backend job to populate Market_Evaluation.",
    },
    { status: 501 }
  );
}
