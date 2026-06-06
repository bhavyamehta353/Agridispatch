import base from "../../lib/airtable";
import { MATURITY_SWATCHES } from "../../lib/maturity";
import { originByFarmOriginId } from "../../lib/origins";
import { NextRequest, NextResponse } from "next/server";

const Q_MIN = 0.60;

type AirtableRecord = {
  id: string;
  get: (name: string) => unknown;
};

function getField(r: AirtableRecord, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = r.get(k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function normalizeStatus(raw: unknown): string {
  const s = String(raw ?? "").toLowerCase().trim();
  if (s === "dispatched") return "Dispatched";
  if (s === "evaluated") return "Evaluated";
  if (s === "error") return "Error";
  return "Submitted";
}

function farmerBatchIdText(r: AirtableRecord): string {
  const v = r.get("batch_id");
  if (v == null) return "";
  return String(v);
}

function matchesBatchRef(
  foreignVal: unknown,
  batchRecordId: string,
  farmerBatchIdText: string
): boolean {
  if (foreignVal == null) return false;
  if (Array.isArray(foreignVal)) {
    if (foreignVal.includes(batchRecordId)) return true;
    return foreignVal.some((x) => String(x) === farmerBatchIdText);
  }
  if (typeof foreignVal === "string") {
    if (foreignVal === batchRecordId) return true;
    return foreignVal === farmerBatchIdText;
  }
  return String(foreignVal) === farmerBatchIdText;
}

function formatHarvestDisplay(iso: unknown): string {
  if (iso == null) return "—";
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function resolveFarmDisplay(r: AirtableRecord): {
  farmOriginId: string | null;
  farmName: string;
  farmSubtext: string;
} {
  const fid = String(
    getField(r, "farm_origin_id", "origin_id") ?? ""
  ).trim();
  const origin = fid ? originByFarmOriginId(fid) : undefined;
  const name = String(getField(r, "origin_name") ?? "");
  if (origin) {
    return {
      farmOriginId: origin.farm_origin_id,
      farmName: origin.origin_name,
      farmSubtext: `${origin.origin_lat}, ${origin.origin_lng}`,
    };
  }
  if (name) {
    return {
      farmOriginId: fid || null,
      farmName: name,
      farmSubtext: fid ? `ID ${fid}` : "",
    };
  }
  return {
    farmOriginId: fid || null,
    farmName: fid || "Unknown",
    farmSubtext: "",
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") ?? "").trim().toLowerCase();
    const farmOriginId = (searchParams.get("farmOriginId") ?? "").trim();
    const statusFilter = (searchParams.get("status") ?? "All").trim();
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const maturityParam = searchParams.get("maturity") ?? "";
    const maturitySet = new Set(
      maturityParam.split(",").map((s) => s.trim()).filter(Boolean)
    );
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20)
    );

    const [batchRecords, handlingRecords, evaluationRecords, marketRecords] =
      await Promise.all([
        base("Farmer_Batches").select().all(),
        base("Handling_Quality").select().all(),
        base("Market_Evaluation").select().all(),
        base("Markets").select().all(),
      ]);

    const marketNameById = new Map<string, string>();
    for (const m of marketRecords as unknown as AirtableRecord[]) {
      const n = m.get("market_name");
      if (typeof n === "string") marketNameById.set(m.id, n);
    }

    function findHandlingForBatch(br: AirtableRecord) {
      const bidText = farmerBatchIdText(br);
      for (const h of handlingRecords as unknown as AirtableRecord[]) {
        if (matchesBatchRef(h.get("batch_id"), br.id, bidText)) return h;
      }
      return null;
    }

    function evaluationsForBatch(br: AirtableRecord) {
      const bidText = farmerBatchIdText(br);
      return (evaluationRecords as unknown as AirtableRecord[]).filter((e) =>
        matchesBatchRef(e.get("batch_id"), br.id, bidText)
      );
    }

    function pickBestEvaluation(evals: AirtableRecord[]) {
      if (!evals.length) return null;
      return [...evals].sort((a, b) => {
        const pa = Number(
          getField(a, "expected_profit", "net_profit", "profit") ?? 0
        );
        const pb = Number(
          getField(b, "expected_profit", "net_profit", "profit") ?? 0
        );
        return pb - pa;
      })[0];
    }

    function resolveRecommendedMarket(ev: AirtableRecord | null): string | null {
      if (!ev) return null;
      const direct = getField(ev, "recommended_market", "recommended_market_name");
      if (typeof direct === "string" && direct.length) return direct;
      const mid = ev.get("market_id");
      const midFirst = Array.isArray(mid) ? mid[0] : mid;
      if (typeof midFirst === "string" && marketNameById.has(midFirst)) {
        return marketNameById.get(midFirst) ?? null;
      }
      return null;
    }

    function expectedProfit(ev: AirtableRecord | null): number | null {
      if (!ev) return null;
      const v = getField(ev, "expected_profit", "net_profit", "profit");
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }

    /** Global stats (full base, ignores table filters). */
    let pendingEvaluationCount = 0;
    let dispatchedCount = 0;
    const qualitySamples: number[] = [];

    for (const br of batchRecords as unknown as AirtableRecord[]) {
      const evs = evaluationsForBatch(br);
      if (!evs.length) pendingEvaluationCount += 1;
      const st = normalizeStatus(getField(br, "Status", "status"));
      if (st === "Dispatched") dispatchedCount += 1;
    }

    for (const h of handlingRecords as unknown as AirtableRecord[]) {
      const q = h.get("quality_packed");
      if (typeof q === "number" && Number.isFinite(q)) qualitySamples.push(q);
    }
    const avgQualityPacked =
      qualitySamples.length > 0
        ? qualitySamples.reduce((a, b) => a + b, 0) / qualitySamples.length
        : null;

    const stats = {
      totalBatches: batchRecords.length,
      pendingEvaluation: pendingEvaluationCount,
      dispatched: dispatchedCount,
      avgQualityPacked,
    };

    type Row = {
      recordId: string;
      batchId: string;
      farmOriginId: string | null;
      farmName: string;
      farmSubtext: string;
      harvestTime: string | null;
      harvestTimeDisplay: string;
      weightKg: number | null;
      maturityGrade: string | null;
      maturitySwatch: string | null;
      qualityPacked: number | null;
      qualityState: "missing" | "computing" | "ok" | "below";
      recommendedMarket: string | null;
      evaluationPending: boolean;
      expectedProfit: number | null;
      status: string;
      evaluationError: boolean;
    };

    const rowsUnsorted: Row[] = [];

    for (const br of batchRecords as unknown as AirtableRecord[]) {
      const batchId = farmerBatchIdText(br);
      const farm = resolveFarmDisplay(br);
      const harvestRaw = getField(br, "harvest_time");
      const harvestIso =
        harvestRaw != null ? new Date(String(harvestRaw)).toISOString() : null;

      const wRaw = getField(br, "weight_kg", "weight_harvest_kg");
      const weightKg =
        typeof wRaw === "number"
          ? wRaw
          : wRaw != null
            ? Number(wRaw)
            : null;

      const maturityGrade = String(getField(br, "maturity_grade") ?? "") || null;
      const swatch = maturityGrade
        ? MATURITY_SWATCHES[maturityGrade]?.swatch ?? null
        : null;

      const handling = findHandlingForBatch(br);
      const qRaw = handling?.get("quality_packed");
      let qualityPacked: number | null =
        typeof qRaw === "number" ? qRaw : qRaw != null ? Number(qRaw) : null;
      if (qualityPacked !== null && !Number.isFinite(qualityPacked))
        qualityPacked = null;

      let qualityState: Row["qualityState"] = "missing";
      if (handling && qualityPacked == null) qualityState = "computing";
      else if (qualityPacked != null) {
        qualityState = qualityPacked < Q_MIN ? "below" : "ok";
      }

      const evs = evaluationsForBatch(br);
      const bestEv = pickBestEvaluation(evs);
      const evaluationPending = evs.length === 0;
      const recommendedMarket = resolveRecommendedMarket(bestEv);
      const profit = expectedProfit(bestEv);

      const status = normalizeStatus(getField(br, "Status", "status"));
      const evaluationError = status === "Error";

      rowsUnsorted.push({
        recordId: br.id,
        batchId,
        farmOriginId: farm.farmOriginId,
        farmName: farm.farmName,
        farmSubtext: farm.farmSubtext,
        harvestTime: harvestIso,
        harvestTimeDisplay: formatHarvestDisplay(harvestRaw),
        weightKg: weightKg != null && Number.isFinite(weightKg) ? weightKg : null,
        maturityGrade,
        maturitySwatch: swatch,
        qualityPacked,
        qualityState,
        recommendedMarket,
        evaluationPending,
        expectedProfit: profit,
        status,
        evaluationError,
      });
    }

    let filtered = rowsUnsorted;

    if (search) {
      filtered = filtered.filter((r) =>
        r.batchId.toLowerCase().includes(search)
      );
    }
    if (farmOriginId && farmOriginId !== "All") {
      filtered = filtered.filter((r) => r.farmOriginId === farmOriginId);
    }

    if (statusFilter === "Pending") {
      filtered = filtered.filter((r) => r.evaluationPending);
    } else if (statusFilter === "Evaluated") {
      filtered = filtered.filter(
        (r) => !r.evaluationPending && r.status !== "Dispatched"
      );
    } else if (statusFilter === "Dispatched") {
      filtered = filtered.filter((r) => r.status === "Dispatched");
    }

    if (dateFrom) {
      const t = new Date(dateFrom).getTime();
      filtered = filtered.filter((r) => {
        if (!r.harvestTime) return false;
        return new Date(r.harvestTime).getTime() >= t;
      });
    }
    if (dateTo) {
      const t = new Date(dateTo);
      t.setHours(23, 59, 59, 999);
      const end = t.getTime();
      filtered = filtered.filter((r) => {
        if (!r.harvestTime) return false;
        return new Date(r.harvestTime).getTime() <= end;
      });
    }
    if (maturitySet.size > 0) {
      filtered = filtered.filter(
        (r) => r.maturityGrade && maturitySet.has(r.maturityGrade)
      );
    }

    filtered.sort((a, b) => {
      const ta = a.harvestTime ? new Date(a.harvestTime).getTime() : 0;
      const tb = b.harvestTime ? new Date(b.harvestTime).getTime() : 0;
      return tb - ta;
    });

    const totalFiltered = filtered.length;
    const start = (page - 1) * pageSize;
    const pageRows = filtered.slice(start, start + pageSize);

    return NextResponse.json({
      stats,
      rows: pageRows,
      pagination: {
        page,
        pageSize,
        total: totalFiltered,
        totalPages: Math.max(1, Math.ceil(totalFiltered / pageSize)),
      },
      qMin: Q_MIN,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load batch overview.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
