import base from "../../../../lib/airtable";
import {
  calendarDayInTimeZone,
  calendarDaysBehind,
  PRICING_TIMEZONE,
} from "../../../../lib/date-freshness";
import { originByFarmOriginId } from "../../../../lib/origins";
import { MATURITY_SWATCHES } from "../../../../lib/maturity";
import { NextResponse } from "next/server";

const Q_MIN = 0.60;
const LOGISTICS_PER_KM = 12;
const TIME_RATE = 150;
const LOGISTICS_FIXED = 500;
const TAU_MULT = 1.5;

type Rec = { id: string; get: (k: string) => unknown };

function getField(r: Rec | undefined | null, ...keys: string[]): unknown {
  if (r == null) return undefined;
  for (const k of keys) {
    const v = r.get(k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v != null) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function farmerBatchIdText(r: Rec): string {
  const v = r.get("batch_id");
  return v == null ? "" : String(v);
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

function linkedIds(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.startsWith("rec")) return [val];
  return [];
}

function rawCreatedTime(r: Rec): string | null {
  const raw = (r as unknown as { _rawJson?: { createdTime?: string } })
    ._rawJson;
  return raw?.createdTime ?? null;
}

function arrivalDay(v: unknown): string | null {
  if (v == null) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return calendarDayInTimeZone(d, PRICING_TIMEZONE);
}

function commissionRateFraction(c: unknown): number {
  const n = num(c);
  if (n == null) return 0.025;
  return n > 0 && n <= 1 ? n : n / 100;
}

function logisticsCost(distanceKm: number, tBaseHr: number, tau: number): number {
  return (
    LOGISTICS_PER_KM * distanceKm +
    TIME_RATE * tBaseHr * (1 + TAU_MULT * tau) +
    LOGISTICS_FIXED
  );
}

function effectiveTravelHours(tBaseHr: number, tau: number): number {
  return tBaseHr * (1 + TAU_MULT * tau);
}

function congestionFromTau(tau: number | null): "low" | "moderate" | "high" | "unknown" {
  if (tau == null || Number.isNaN(tau)) return "unknown";
  if (tau < 0.2) return "low";
  if (tau < 0.5) return "moderate";
  return "high";
}

function decayBucket(score: number | null): "Low" | "Medium" | "High" {
  if (score == null) return "Medium";
  if (score < 0.34) return "Low";
  if (score < 0.67) return "Medium";
  return "High";
}

function normKey(s: string): string {
  return s.trim();
}

function trafficMatchKey(pairKey: string, farmKey: string, marketId: string): string {
  const p = normKey(pairKey);
  if (p) return p;
  return `${normKey(farmKey)}::${normKey(marketId)}`;
}

function formatSourceLabel(raw: unknown): string {
  if (raw == null) return "—";
  const s = String(raw).trim();
  if (!s) return "—";
  const lower = s.toLowerCase();
  if (lower.includes("agmark")) return "Agmarknet";
  if (lower === "manual" || lower.includes("manual")) return "Manual";
  return s;
}

/** Airtable `recommended` checkbox or text — null if unset / unknown. */
function parseRecommendedField(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 0) return false;
    if (v === 1) return true;
    return null;
  }
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "") return null;
    if (["yes", "true", "1", "y"].includes(s)) return true;
    if (["no", "false", "0", "n"].includes(s)) return false;
  }
  return null;
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

    const bidText = farmerBatchIdText(batchRecord);
    const farmOriginId = String(
      getField(batchRecord, "farm_origin_id", "origin_id") ?? ""
    ).trim();
    const farmResolved = originByFarmOriginId(farmOriginId);
    const farmName =
      farmResolved?.origin_name ??
      String(getField(batchRecord, "origin_name") ?? "Unknown farm");
    const farmCoords =
      farmResolved != null
        ? `${farmResolved.origin_lat}, ${farmResolved.origin_lng}`
        : null;

    const weightKg =
      num(getField(batchRecord, "weight_kg", "weight_harvest_kg")) ?? 0;
    const harvestTime = getField(batchRecord, "harvest_time");
    const rawStatus = String(getField(batchRecord, "Status", "status") ?? "").toLowerCase().trim();
    const status = rawStatus === "dispatched" ? "Dispatched" : rawStatus === "evaluated" ? "Evaluated" : rawStatus === "error" ? "Error" : "Submitted";
    const qualityInitial = num(getField(batchRecord, "quality_initial"));
    const maturityGrade = String(
      getField(batchRecord, "maturity_grade", "maturity") ?? ""
    ).trim();
    const harvestMethod = String(
      getField(batchRecord, "harvest_method") ?? ""
    ).trim();
    const maturitySwatch = maturityGrade
      ? MATURITY_SWATCHES[maturityGrade]?.swatch ?? null
      : null;

    const flagForReview = Boolean(
      getField(batchRecord, "flag_for_review", "Flag for review")
    );
    const reviewNote = String(
      getField(batchRecord, "review_note", "review_notes") ?? ""
    ).trim();

    const batchCreatedAt = rawCreatedTime(batchRecord);

    const [
      handlingRecords,
      evaluationRecords,
      marketRecords,
      pricingRecords,
      routeRecords,
      trafficRecords,
      riskRecords,
    ] = await Promise.all([
      base("Handling_Quality").select().all(),
      base("Market_Evaluation").select().all(),
      base("Markets").select().all(),
      base("Market_Pricing").select().all(),
      base("Route_Reference").select().all(),
      base("Traffic_Estimates").select().all(),
      base("Environmental_Risk").select().all(),
    ]);

    const handling = (handlingRecords as unknown as Rec[]).find((h) =>
      matchesBatchRef(h.get("batch_id"), recordId, bidText)
    );
    const handlingCreatedAt = handling ? rawCreatedTime(handling) : null;

    const qualityPacked = num(handling?.get("quality_packed"));
    const damageFactor = num(handling?.get("damage_factor")) ?? 0;
    const sortingBonus =
      num(
        handling
          ? getField(handling as Rec, "sorting_bonus", "sorting_quality")
          : null
      ) ?? 0;
    const kMultStored = num(handling?.get("k_multiplier"));
    const kMultiplier =
      kMultStored != null ? kMultStored : 1 + 0.8 * damageFactor;

    const packagingType = handling
      ? String(handling.get("packaging_type") ?? "")
      : "";
    const fillLevel = handling ? String(handling.get("fill_level") ?? "") : "";

    const evalRows = (evaluationRecords as unknown as Rec[]).filter((e) =>
      matchesBatchRef(e.get("batch_id"), recordId, bidText)
    );
    const hasEvaluation = evalRows.length > 0;

    const evalTimestamps = evalRows
      .map((e) => String(getField(e, "evaluation_timestamp") ?? ""))
      .filter(Boolean);
    const evalCreated = evalRows
      .map((e) => rawCreatedTime(e))
      .filter(Boolean) as string[];
    const evaluationTimeIso =
      evalTimestamps[0] ??
      (evalCreated.sort().reverse()[0] ?? null);

    let evaluationDay: string | null = null;
    if (evaluationTimeIso) {
      const d = new Date(evaluationTimeIso);
      if (!Number.isNaN(d.getTime())) {
        evaluationDay = calendarDayInTimeZone(d, PRICING_TIMEZONE);
      }
    }

    const markets = (marketRecords as unknown as Rec[]).map((m) => ({
      id: m.id,
      name: String(m.get("market_name") ?? "Market"),
      location: String(m.get("location") ?? ""),
      commission: m.get("default_commission"),
    }));

    type PricingFull = {
      recordId: string;
      marketId: string;
      arrivalDay: string | null;
      arrivalRaw: unknown;
      modal: number | null;
      minPrice: number | null;
      maxPrice: number | null;
      sourceRaw: unknown;
      sourceLabel: string;
      createdTime: string | null;
    };

    const pricingFull: PricingFull[] = (
      pricingRecords as unknown as Rec[]
    ).map((r) => {
      const mids = linkedIds(r.get("market_id"));
      const src = getField(r, "source", "price_source");
      return {
        recordId: r.id,
        marketId: mids[0] ?? "",
        arrivalDay: arrivalDay(r.get("arrival_date")),
        arrivalRaw: r.get("arrival_date"),
        modal: num(r.get("modal_price")) ?? num(r.get("price_per_kg")),
        minPrice: num(r.get("min_price")),
        maxPrice: num(r.get("max_price")),
        sourceRaw: src,
        sourceLabel: formatSourceLabel(src),
        createdTime: rawCreatedTime(r),
      };
    });

    function bestPriceAtOrBefore(
      marketId: string,
      evalDay: string | null
    ): PricingFull | null {
      const rows = pricingFull.filter((p) => p.marketId === marketId && p.arrivalDay);
      const pool =
        evalDay != null
          ? rows.filter((p) => (p.arrivalDay as string) <= evalDay)
          : rows;
      if (pool.length === 0) return null;
      return [...pool].sort((a, b) => {
        const c = (b.arrivalDay ?? "").localeCompare(a.arrivalDay ?? "");
        if (c !== 0) return c;
        return (b.createdTime ?? "").localeCompare(a.createdTime ?? "");
      })[0];
    }

    const routes = routeRecords as unknown as Rec[];
    const trafficAll = trafficRecords as unknown as Rec[];

    function findRoute(marketId: string): Rec | undefined {
      const strict = routes.find((r) => {
        const mids = linkedIds(r.get("market_id"));
        if (!mids.includes(marketId)) return false;
        return (
          String(r.get("origin_key") ?? "") === farmOriginId ||
          String(r.get("farm_id") ?? "") === farmOriginId ||
          String(r.get("origin_name") ?? "") === farmName
        );
      });
      if (strict) return strict;
      return routes.find((r) => linkedIds(r.get("market_id")).includes(marketId));
    }

    function findTrafficBatch(marketId: string): Rec | undefined {
      return trafficAll.find((t) => {
        const mids = linkedIds(t.get("market_id"));
        if (!mids.includes(marketId)) return false;
        return matchesBatchRef(t.get("batch_id"), recordId, bidText);
      });
    }

    function findTrafficRouteFallback(marketId: string): Rec | undefined {
      const route = findRoute(marketId);
      if (!route) return undefined;
      const rPair = String(route.get("pair_key") ?? "");
      const rFarm = String(getField(route, "origin_key", "farm_id") ?? "").trim();
      const targetKey = trafficMatchKey(rPair, rFarm, marketId);
      let best: Rec | undefined;
      let bestTime = "";
      for (const t of trafficAll) {
        const ct = rawCreatedTime(t);
        if (!ct) continue;
        const pk = String(t.get("pair_key") ?? "");
        const fk = String(getField(t, "farm_id", "origin_key") ?? "").trim();
        for (const mid of linkedIds(t.get("market_id"))) {
          const k = trafficMatchKey(pk, fk, mid);
          if (k === targetKey && ct > bestTime) {
            best = t;
            bestTime = ct;
          }
        }
      }
      return best;
    }

    function resolveTau(
      marketId: string
    ): {
      tau: number | null;
      trafficRecordId: string | null;
      trafficUpdatedAt: string | null;
      source: "batch" | "route_latest" | "none";
    } {
      const batchT = findTrafficBatch(marketId);
      if (batchT) {
        const tau = num(batchT.get("tau"));
        return {
          tau,
          trafficRecordId: batchT.id,
          trafficUpdatedAt: rawCreatedTime(batchT),
          source: "batch",
        };
      }
      const fb = findTrafficRouteFallback(marketId);
      if (fb) {
        const tau = num(fb.get("tau"));
        return {
          tau,
          trafficRecordId: fb.id,
          trafficUpdatedAt: rawCreatedTime(fb),
          source: "route_latest",
        };
      }
      return {
        tau: null,
        trafficRecordId: null,
        trafficUpdatedAt: null,
        source: "none",
      };
    }

    function findEval(marketId: string): Rec | undefined {
      return evalRows.find((e) => {
        const mids = linkedIds(e.get("market_id"));
        return mids.includes(marketId);
      });
    }

    function findRisk(marketId: string): Rec | undefined {
      return (riskRecords as unknown as Rec[]).find((r) => {
        const mids = linkedIds(r.get("market_id"));
        if (!mids.includes(marketId)) return false;
        return matchesBatchRef(r.get("batch_id"), recordId, bidText);
      });
    }

    const feasibleBase = qualityPacked != null && qualityPacked >= Q_MIN;

    const recMarketHint = evalRows
      .map((e) => String(getField(e, "recommended_market") ?? "").trim())
      .find(Boolean);

    let winnerMarketId: string | null = null;
    let winnerNameFromEval: string | null = null;
    if (recMarketHint) {
      const match = markets.find(
        (m) =>
          m.name === recMarketHint ||
          m.name.toLowerCase() === recMarketHint.toLowerCase()
      );
      if (match) winnerMarketId = match.id;
      winnerNameFromEval = recMarketHint;
    }

    const perMarket = markets.map((m) => {
      const route = findRoute(m.id);
      const tinfo = resolveTau(m.id);
      const tauMath = tinfo.tau ?? 0;
      const distanceKm = num(route?.get("distance_km")) ?? 0;
      const tBaseHr = num(route?.get("t_base_hr")) ?? 0;
      const effTravel = effectiveTravelHours(tBaseHr, tauMath);
      const logi = logisticsCost(distanceKm, tBaseHr, tauMath);

      const ev = findEval(m.id);
      const risk = findRisk(m.id);

      const priceEval = bestPriceAtOrBefore(m.id, evaluationDay);
      const priceLatest = bestPriceAtOrBefore(m.id, null);

      let staleAtEval = false;
      let staleDaysAtEval: number | null = null;
      if (priceEval?.arrivalDay && evaluationDay) {
        const days = calendarDaysBehind(priceEval.arrivalDay, evaluationDay);
        if (days > 0) {
          staleAtEval = true;
          staleDaysAtEval = days;
        }
      }

      const modal = priceEval?.modal ?? priceLatest?.modal ?? null;
      const gross =
        modal != null && weightKg > 0 ? modal * weightKg : null;
      const rate = commissionRateFraction(m.commission);
      const commissionAmt =
        gross != null ? Math.round(gross * rate * 100) / 100 : null;
      const netRev =
        gross != null && commissionAmt != null
          ? Math.round((gross - commissionAmt) * 100) / 100
          : null;

      const storedProfit = num(
        getField(ev, "expected_profit", "net_profit", "profit")
      );
      const computedProfit =
        netRev != null ? Math.round((netRev - logi) * 100) / 100 : null;
      const expectedProfit = storedProfit ?? computedProfit;

      const decayRaw = num(
        getField(risk, "decay_risk_score", "decay_risk", "k_eff")
      );

      const recommendedAirtable =
        ev != null ? parseRecommendedField(getField(ev, "recommended")) : null;

      return {
        marketId: m.id,
        marketName: m.name,
        location: m.location,
        route: {
          distanceKm,
          tBaseHr,
          tau: tinfo.tau,
          tauSource: tinfo.source,
          trafficRecordId: tinfo.trafficRecordId,
          trafficUpdatedAt: tinfo.trafficUpdatedAt,
          effectiveTravelHr: effTravel,
          congestion: congestionFromTau(tinfo.tau),
          logisticsCost: Math.round(logi * 100) / 100,
          logisticsFormula: {
            perKm: LOGISTICS_PER_KM * distanceKm,
            timeComponent: TIME_RATE * tBaseHr * (1 + TAU_MULT * tauMath),
            fixed: LOGISTICS_FIXED,
            tauUsed: tauMath,
          },
        },
        environment: {
          temperatureC: num(getField(risk, "temperature_c", "avg_temp_c")),
          humidityPct: num(getField(risk, "humidity_pct", "avg_humidity_pct")),
          decayRiskScore: decayRaw,
          decayLevel: decayBucket(decayRaw),
          decayHigh: decayRaw != null && decayRaw > 0.65,
          recordUpdatedAt: risk ? rawCreatedTime(risk) : null,
        },
        pricing: {
          recordId: priceEval?.recordId ?? priceLatest?.recordId ?? null,
          arrivalDay: priceEval?.arrivalDay ?? null,
          arrivalRaw: priceEval?.arrivalRaw ?? priceLatest?.arrivalRaw ?? null,
          modalPrice: priceEval?.modal ?? priceLatest?.modal ?? null,
          minPrice: priceEval?.minPrice ?? priceLatest?.minPrice ?? null,
          maxPrice: priceEval?.maxPrice ?? priceLatest?.maxPrice ?? null,
          sourceLabel: priceEval?.sourceLabel ?? priceLatest?.sourceLabel ?? "—",
          staleAtEval,
          staleDaysAtEval,
          evalDayUsed: evaluationDay,
        },
        outputs: {
          grossRevenue: gross,
          commissionRate: rate,
          commissionAmount: commissionAmt,
          netRevenue: netRev,
          logisticsCost: Math.round(logi * 100) / 100,
          expectedProfit,
          feasible: feasibleBase,
          recommended: false,
          recommendedAirtable,
        },
      };
    });

    const profits = perMarket
      .map((p) => ({
        id: p.marketId,
        profit: p.outputs.expectedProfit,
        name: p.marketName,
      }))
      .filter((x) => x.profit != null) as {
      id: string;
      profit: number;
      name: string;
    }[];

    const sortedByProfit = [...profits].sort((a, b) => b.profit - a.profit);
    const topProfit = sortedByProfit[0];
    const secondProfitRow = sortedByProfit[1];
    const margin =
      topProfit && secondProfitRow != null
        ? topProfit.profit - secondProfitRow.profit
        : null;

    if (!winnerMarketId && topProfit) winnerMarketId = topProfit.id;

    for (const p of perMarket) {
      const a = p.outputs.recommendedAirtable;
      p.outputs.recommended =
        a === true ||
        (a === null &&
          winnerMarketId != null &&
          p.marketId === winnerMarketId);
    }

    const winnerCol = perMarket.find((p) => p.marketId === winnerMarketId);
    const winnerDisplayName =
      winnerNameFromEval ?? winnerCol?.marketName ?? "—";

    const qualityComputed = handling != null && qualityPacked != null;

    const formulaResult =
      qualityInitial != null
        ? qualityInitial *
          (1 - 0.6 * damageFactor) *
          (1 + 0.2 * sortingBonus)
        : null;

    const staleDaysList = perMarket
      .map((p) => p.pricing.staleDaysAtEval)
      .filter((d): d is number => d != null && d > 0);
    const anyPricingStaleAtEval = staleDaysList.length > 0;
    const maxStaleDaysAtEval = anyPricingStaleAtEval
      ? Math.max(...staleDaysList)
      : null;

    return NextResponse.json({
      qMin: Q_MIN,
      review: {
        flagged: flagForReview,
        note: reviewNote || null,
      },
      identity: {
        batchId: bidText,
        recordId,
        farmName,
        farmOriginId: farmOriginId || null,
        farmCoords,
        harvestTime: harvestTime != null ? String(harvestTime) : null,
        status,
        evaluationTimestamp: evaluationTimeIso,
      },
      pipeline: {
        submitted: {
          complete: true,
          at: batchCreatedAt,
        },
        qualityComputed: {
          complete: qualityComputed,
          at: handlingCreatedAt,
          warnBelowQMin:
            qualityComputed &&
            qualityPacked != null &&
            qualityPacked < Q_MIN,
        },
        evaluated: {
          complete: hasEvaluation,
          at: evaluationTimeIso,
        },
        dispatched: {
          complete: status === "Dispatched",
          at: null as string | null,
        },
      },
      harvest: {
        batchId: bidText,
        farmOriginId: farmOriginId || null,
        farmDisplay: farmName,
        farmCoords,
        harvestTime: harvestTime != null ? String(harvestTime) : null,
        weightKg,
        maturityGrade: maturityGrade || null,
        maturitySwatch,
        harvestMethod: harvestMethod || null,
        qualityInitial,
      },
      handling: {
        packagingType: packagingType || null,
        fillLevel: fillLevel || null,
        damageFactor,
        sortingBonus,
        highDamageNote: damageFactor > 0.5,
      },
      quality: {
        notComputed: !qualityComputed,
        qualityInitial,
        damageFactor,
        sortingBonus,
        qualityPacked,
        kMultiplier,
        formulaResult,
        feasible: feasibleBase,
      },
      routes: perMarket.map((p) => ({
        marketId: p.marketId,
        marketName: p.marketName,
        ...p.route,
      })),
      environment: perMarket.map((p) => ({
        marketId: p.marketId,
        marketName: p.marketName,
        ...p.environment,
      })),
      pricing: perMarket.map((p) => ({
        marketId: p.marketId,
        marketName: p.marketName,
        ...p.pricing,
      })),
      pricingSummary: {
        anyStaleAtEval: anyPricingStaleAtEval,
        maxStaleDaysAtEval: anyPricingStaleAtEval ? maxStaleDaysAtEval : null,
      },
      evaluation: {
        hasEvaluation,
        rows: perMarket.map((p) => ({
          marketId: p.marketId,
          marketName: p.marketName,
          ...p.outputs,
        })),
        summary: {
          recommendedMarket: winnerDisplayName,
          expectedProfit: winnerCol?.outputs.expectedProfit ?? null,
          marginOverNext: margin,
          evaluationTimestamp: evaluationTimeIso,
        },
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load audit data.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
