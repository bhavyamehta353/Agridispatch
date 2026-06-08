import base from "../../../../lib/airtable";
import {
  calendarDayInTimeZone,
  PRICING_TIMEZONE,
} from "../../../../lib/date-freshness";
import { originByFarmOriginId } from "../../../../lib/origins";
import { NextResponse } from "next/server";

const Q_MIN = 0.60;
const LOGISTICS_PER_KM = 18;
const TIME_RATE = 160;
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

// tActualHr = t_base * (1 + tau) — actual travel time used in decay formula
// effectiveTravelHours is only for the logistics cost time component
function tActualHours(tBaseHr: number, tau: number): number {
  return tBaseHr * (1 + tau);
}

function effectiveTravelHours(tBaseHr: number, tau: number): number {
  return tBaseHr * (1 + TAU_MULT * tau);
}

// Decay math (mirrors math_models.py)
const K_REF = 0.015, T_REF = 25.0, BETA_TEMP = 0.08, DELTA_HUM = 0.00351, DELTA_VPD = 0.252462;
const SEASONAL_FACTOR: Record<string, number> = {
  Jan: 0.7465, Feb: 0.9368, Mar: 1.2625, Apr: 1.6207, May: 1.5692,
  Jun: 1.0012, Jul: 0.7987, Aug: 0.7779, Sep: 0.7885, Oct: 0.9048,
  Nov: 0.8516, Dec: 0.7416,
};
const MATURITY_DECAY_MAP: Record<string, number> = {
  Breaker: 0.85, Turning: 0.90, Pink: 0.95, "Light Red": 1.00, "Red Ripe": 1.10,
};
function qualityArrival(qPacked: number, T: number, H: number, month: string, kMult: number, maturityGrade: string, tActualHr: number): number {
  const es = 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
  const vpd = es * (1 - H / 100);
  const hf = (1 + DELTA_HUM * H) * (1 + DELTA_VPD * vpd);
  const kb = K_REF * (SEASONAL_FACTOR[month] ?? 1.0) * Math.exp(BETA_TEMP * (T - T_REF)) * hf;
  const ke = kb * kMult * (MATURITY_DECAY_MAP[maturityGrade] ?? 1.0);
  return Math.max(0, Math.min(1, qPacked * Math.exp(-ke * tActualHr)));
}

function decayBucket(score: number | null): "Low" | "Medium" | "High" {
  if (score == null) return "Medium";
  if (score < 0.025) return "Low";
  if (score < 0.05) return "Medium";
  return "High";
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

    const weightKg =
      num(getField(batchRecord, "weight_kg", "weight_harvest_kg")) ?? 0;
    const harvestTime = getField(batchRecord, "harvest_time");
    const rawStatus = String(getField(batchRecord, "Status", "status") ?? "").toLowerCase().trim();
    const status = rawStatus === "dispatched" ? "Dispatched" : rawStatus === "evaluated" ? "Evaluated" : rawStatus === "error" ? "Error" : "Submitted";
    const qualityInitial = num(getField(batchRecord, "quality_initial"));
    const maturityGrade = String(
      getField(batchRecord, "maturity_grade") ?? "Light Red"
    );

    const [
      handlingRecords,
      evaluationRecords,
      marketRecords,
      pricingRecords,
      routeRecords,
      trafficRecords,
      riskRecords,
    ] = await Promise.all([
      base("Handling_Quality").select({
        filterByFormula: `{batch_id} = "${bidText}"`,
        maxRecords: 5,
      }).all(),
      base("Market_Evaluation").select({
        filterByFormula: `{batch_id} = "${bidText}"`,
        maxRecords: 10,
      }).all(),
      base("Markets").select().all(),
      base("Market_Pricing").select({ maxRecords: 200 }).all(),
      base("Route_Reference").select().all(),
      base("Traffic_Estimates").select({
        filterByFormula: `{batch_id} = "${bidText}"`,
        maxRecords: 10,
      }).all(),
      base("Environmental_Risk").select({
        filterByFormula: `{batch_id} = "${bidText}"`,
        maxRecords: 10,
      }).all(),
    ]);

    const handling = (handlingRecords as unknown as Rec[]).find((h) =>
      matchesBatchRef(h.get("batch_id"), recordId, bidText)
    );

    const qualityPacked = num(handling?.get("quality_packed"));
    const damageFactor = num(handling?.get("damage_factor")) ?? 0;
    const sortingBonus =
      num(
        handling
          ? getField(handling as unknown as Rec, "sorting_bonus", "sorting_quality")
          : null
      ) ?? 0;
    const kMultStored = num(handling?.get("k_multiplier"));
    const kMultiplier =
      kMultStored != null ? kMultStored : 1 + 0.8 * damageFactor;

    const evalRows = (evaluationRecords as unknown as Rec[]).filter((e) =>
      matchesBatchRef(e.get("batch_id"), recordId, bidText)
    );

    const hasEvaluation = evalRows.length > 0;

    const markets = (marketRecords as unknown as Rec[]).map((m) => ({
      id: m.id,
      name: String(m.get("market_name") ?? "Market"),
      location: String(m.get("location") ?? ""),
      lat: num(m.get("market_lat")),
      lng: num(m.get("market_lng")),
      commission: m.get("default_commission"),
    }));

    const pricingParsed = (pricingRecords as unknown as Rec[]).map((r) => {
      const mids = linkedIds(r.get("market_id"));
      return {
        recordId: r.id,
        marketId: mids[0] ?? "",
        arrivalDay: arrivalDay(r.get("arrival_date") ?? r.get("price_date")),
        arrivalRaw: r.get("arrival_date"),
        modal: num(r.get("price_modal")) ?? num(r.get("modal_price")) ?? num(r.get("price_per_kg")),
        min: num(r.get("price_min")) ?? num(r.get("min_price")) ?? num(r.get("min_price_per_kg")),
        max: num(r.get("price_max")) ?? num(r.get("max_price")) ?? num(r.get("max_price_per_kg")),
        createdTime: rawCreatedTime(r),
      };
    });

    const harvestDay = harvestTime != null
      ? calendarDayInTimeZone(new Date(String(harvestTime)), PRICING_TIMEZONE)
      : null;
    const todayDay = calendarDayInTimeZone(new Date(), PRICING_TIMEZONE);
    // Reference day for staleness: harvest date if known, otherwise today
    const refDay = harvestDay ?? todayDay;

    // harvestPriceByMarket: pricing record whose date matches the harvest day (ideal)
    const harvestPriceByMarket = new Map<string, (typeof pricingParsed)[number]>();
    // latestPriceByMarket: most recent dated record (fallback when no harvest-day match)
    const latestPriceByMarket = new Map<string, (typeof pricingParsed)[number]>();
    // anyPriceByMarket: fallback for records without a date
    const anyPriceByMarket = new Map<string, (typeof pricingParsed)[number]>();

    const sortedP = [...pricingParsed]
      .filter((x) => x.marketId && x.arrivalDay)
      .sort((a, b) => {
        const c = (b.arrivalDay ?? "").localeCompare(a.arrivalDay ?? "");
        if (c !== 0) return c;
        return (b.createdTime ?? "").localeCompare(a.createdTime ?? "");
      });
    for (const row of sortedP) {
      if (harvestDay && row.arrivalDay === harvestDay && !harvestPriceByMarket.has(row.marketId))
        harvestPriceByMarket.set(row.marketId, row);
      if (!latestPriceByMarket.has(row.marketId))
        latestPriceByMarket.set(row.marketId, row);
    }

    // Populate fallback from all pricing rows (including undated ones)
    const sortedAny = [...pricingParsed]
      .filter((x) => x.marketId && x.modal != null)
      .sort((a, b) => (b.createdTime ?? "").localeCompare(a.createdTime ?? ""));
    for (const row of sortedAny) {
      if (!anyPriceByMarket.has(row.marketId))
        anyPriceByMarket.set(row.marketId, row);
    }

    function findRoute(marketId: string): Rec | undefined {
      const routes = routeRecords as unknown as Rec[];
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

    function findTraffic(marketId: string): Rec | undefined {
      return (trafficRecords as unknown as Rec[]).find((t) => {
        const mids = linkedIds(t.get("market_id"));
        if (!mids.includes(marketId)) return false;
        return matchesBatchRef(t.get("batch_id"), recordId, bidText);
      });
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

    const marketColumns = markets.map((m) => {
      const route = findRoute(m.id);
      const traffic = findTraffic(m.id);
      const ev = findEval(m.id);
      const risk = findRisk(m.id);

      const distanceKm = num(route?.get("distance_km")) ?? 0;
      const tBaseHr = num(route?.get("t_base_hr")) ?? 0;
      const tau = num(traffic?.get("tau")) ?? 0;
      const tActualHr = tActualHours(tBaseHr, tau);
      const effTravel = effectiveTravelHours(tBaseHr, tau);
      const storedLogi = num(getField(ev as Rec, "logistics_cost"));
      const logi = storedLogi ?? logisticsCost(distanceKm, tBaseHr, tau);

      const harvestDayRow = harvestPriceByMarket.get(m.id) ?? null;
      const latestRow = latestPriceByMarket.get(m.id) ?? anyPriceByMarket.get(m.id) ?? null;
      // priceRow used only for staleness indicator and display metadata
      const priceRow = harvestDayRow ?? latestRow;
      // Prefer harvest-day price → eval-stored price (what Python agent used) → latest dated last
      // This prevents today's newly entered prices from inflating the simulator's modal price
      const evalModal = num(getField(ev as Rec, "price_modal", "modal_price", "price_per_kg", "modal_price_per_kg"));
      const evalMin   = num(getField(ev as Rec, "price_min", "min_price", "min_price_per_kg"));
      const evalMax   = num(getField(ev as Rec, "price_max", "max_price", "max_price_per_kg"));
      const modal    = harvestDayRow?.modal ?? evalModal ?? latestRow?.modal ?? null;
      const minPrice = harvestDayRow?.min   ?? evalMin   ?? latestRow?.min   ?? null;
      const maxPrice = harvestDayRow?.max   ?? evalMax   ?? latestRow?.max   ?? null;
      // Prices are stale if they don't match the harvest day (or today if harvest unknown)
      const priceStale = priceRow?.arrivalDay != null
        ? priceRow.arrivalDay !== refDay
        : modal != null; // undated or eval-sourced price is always stale

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
        getField(ev as Rec, "expected_profit", "net_profit", "profit")
      );
      const computedProfit =
        netRev != null ? Math.round((netRev - logi) * 100) / 100 : null;
      const expectedProfit = storedProfit ?? computedProfit;

      const temperatureC = num(getField(risk as Rec, "temperature_c", "avg_temp_c"));
      const humidityPct = num(getField(risk as Rec, "humidity_pct", "avg_humidity_pct"));
      const harvestIso = harvestTime != null ? String(harvestTime) : null;
      const harvestMonth = harvestIso
        ? new Date(harvestIso).toLocaleString("en-US", { month: "short", timeZone: "Asia/Kolkata" })
        : new Date().toLocaleString("en-US", { month: "short", timeZone: "Asia/Kolkata" });
      const qArr =
        qualityPacked != null && temperatureC != null && humidityPct != null
          ? qualityArrival(qualityPacked, temperatureC, humidityPct, harvestMonth, kMultiplier, maturityGrade, tActualHr)
          : null;
      // Prefer the feasibility the evaluation agent computed and stored in Airtable.
      // Fall back to live recomputation only when no eval record exists yet.
      const evalFeasible = ev != null ? ev.get("quality_feasible") : undefined;
      const feasible = evalFeasible != null
        ? Boolean(evalFeasible)
        : qArr != null ? qArr >= Q_MIN : qualityPacked != null && qualityPacked >= Q_MIN;

      const decayRaw = num(
        getField(risk as Rec, "decay_risk_score", "decay_risk", "k_eff")
      );
      const decayBucketed = decayBucket(decayRaw);

      const priceEffective = num(getField(ev as Rec, "price_effective"));
      const fpoSupplyPct   = num(getField(ev as Rec, "fpo_supply_adjustment_pct"));

      return {
        marketId: m.id,
        marketName: m.name,
        location: m.location,
        marketLat: m.lat,
        marketLng: m.lng,
        modalPrice: modal,
        priceArrivalDay: priceRow?.arrivalDay ?? null,
        priceStale,
        distanceKm,
        tBaseHr,
        tau,
        tActualHr,
        effectiveTravelHr: effTravel,
        logisticsCost: Math.round(logi * 100) / 100,
        logisticsBreakdown: {
          distanceKm,
          tBaseHr,
          tau,
          perKm: LOGISTICS_PER_KM * distanceKm,
          timeComponent:
            TIME_RATE * tBaseHr * (1 + TAU_MULT * tau),
          fixed: LOGISTICS_FIXED,
        },
        minPrice,
        maxPrice,
        priceEffective,
        fpoSupplyPct,
        grossRevenue: gross,
        commissionRate: rate,
        commissionAmount: commissionAmt,
        netRevenue: netRev,
        expectedProfit,
        feasible,
        decayRisk: decayBucketed,
        decayRaw,
        temperatureC,
        humidityPct,
        activePriceRecordId: priceRow?.recordId ?? null,
      };
    });

    const profits = marketColumns
      .map((c) => ({
        id: c.marketId,
        profit: c.expectedProfit,
        feasible: c.feasible,
        name: c.marketName,
      }))
      .filter((x) => x.profit != null) as {
      id: string;
      profit: number;
      feasible: boolean;
      name: string;
    }[];

    let winnerMarketId: string | null = null;

    // Use the `recommended` checkbox the evaluation agent set on the winning row.
    const recommendedRow = evalRows.find((e) => Boolean(e.get("recommended")));
    if (recommendedRow) {
      winnerMarketId = linkedIds(recommendedRow.get("market_id"))[0] ?? null;
    }

    // Fallback for batches not yet evaluated: highest profit among feasible markets.
    if (!winnerMarketId) {
      const feasibleProfits = profits.filter((p) => p.feasible);
      winnerMarketId = [...feasibleProfits].sort((a, b) => b.profit - a.profit)[0]?.id ?? null;
    }

    const winnerCol = marketColumns.find((c) => c.marketId === winnerMarketId);
    const winnerName = winnerCol?.marketName ?? "—";

    const feasibleSorted = profits
      .filter((p) => p.feasible)
      .sort((a, b) => b.profit - a.profit);
    const secondFeasibleRow = feasibleSorted.find((p) => p.id !== winnerMarketId) ?? null;
    const secondProfitVal = secondFeasibleRow?.profit ?? null;
    const margin =
      winnerCol?.expectedProfit != null && secondProfitVal != null
        ? winnerCol.expectedProfit - secondProfitVal
        : null;

    const feasibleAny = marketColumns.some((c) => c.feasible);
    const allInfeasible =
      marketColumns.length > 0 && !feasibleAny && qualityPacked != null;

    const evalTimestamps = evalRows
      .map((e) => String(getField(e, "evaluation_timestamp") ?? ""))
      .filter(Boolean);
    const evalCreated = evalRows
      .map((e) => rawCreatedTime(e))
      .filter(Boolean) as string[];
    const evaluationTime =
      evalTimestamps[0] ??
      evalCreated.sort().reverse()[0] ??
      null;

    const winnerModal = winnerCol?.modalPrice ?? null;
    const winnerDistance = winnerCol?.distanceKm ?? null;
    const winnerEffTravel = winnerCol?.effectiveTravelHr ?? null;

    const qualityTier =
      qualityPacked == null
        ? "unknown"
        : qualityPacked >= 0.8
          ? "good"
          : qualityPacked >= Q_MIN
            ? "mid"
            : "bad";

    const pricingDateForHeader = marketColumns
      .map((c) => c.priceArrivalDay)
      .filter(Boolean) as string[];
    const headerPricingDay =
      pricingDateForHeader.length > 0
        ? pricingDateForHeader.reduce((a, b) => (a < b ? a : b))
        : null;
    const headerPricingStale =
      headerPricingDay != null && headerPricingDay !== refDay;

    const formulaResult =
      qualityInitial != null
        ? qualityInitial *
          (1 - 0.6 * damageFactor) *
          (1 + 0.2 * sortingBonus)
        : null;

    return NextResponse.json({
      qMin: Q_MIN,
      batch: {
        recordId,
        batchId: bidText,
        farmName,
        farmOriginId: farmOriginId || null,
        farmLat: farmResolved?.origin_lat ?? null,
        farmLng: farmResolved?.origin_lng ?? null,
        harvestTime: harvestTime != null ? String(harvestTime) : null,
        weightKg,
        status,
      },
      handling: {
        qualityPacked,
        qualityInitial,
        damageFactor,
        sortingBonus,
        kMultiplier,
        weightPacked: num(handling?.get("weight_packed_kg")),
        packagingType: handling
          ? String(handling.get("packaging_type") ?? "")
          : null,
        fillLevel: handling ? String(handling.get("fill_level") ?? "") : null,
        qualityTier,
        maturityGrade,
      },
      evaluation: {
        hasEvaluation,
        evaluationTime,
        recommendedMarketName: winnerName,
        winnerMarketId,
        expectedProfitWinner: winnerCol?.expectedProfit ?? null,
        marginOverNext: margin,
        closeCall:
          margin != null && margin < 500 && secondFeasibleRow != null,
      },
      winnerCard: {
        marketName: winnerName,
        expectedProfit: winnerCol?.expectedProfit ?? null,
        modalPrice: winnerModal,
        distanceKm: winnerDistance,
        effectiveTravelHr: winnerEffTravel,
        marginOverNext: margin,
        closeCall:
          margin != null && margin < 500 && secondFeasibleRow != null,
        feasible:
          qualityPacked != null && qualityPacked >= Q_MIN,
      },
      markets: marketColumns,
      headerMeta: {
        pricingActiveDay: headerPricingDay,
        pricingStale: headerPricingStale,
        todayCalendar: todayDay,
      },
      routeWinner: winnerCol
        ? {
            farmName,
            farmLat: farmResolved?.origin_lat ?? null,
            farmLng: farmResolved?.origin_lng ?? null,
            marketName: winnerCol.marketName,
            marketLat: winnerCol.marketLat,
            marketLng: winnerCol.marketLng,
            distanceKm: winnerCol.distanceKm,
            tBaseHr: winnerCol.tBaseHr,
            tau: winnerCol.tau,
            effectiveTravelHr: winnerCol.effectiveTravelHr,
            temperatureC: winnerCol.temperatureC,
            humidityPct: winnerCol.humidityPct,
            decayRiskScore: winnerCol.decayRaw,
            decayBucket: winnerCol.decayRisk,
          }
        : null,
      edge: {
        allInfeasible,
        dispatched: status === "Dispatched",
      },
      formula: {
        qualityInitial,
        damageFactor,
        sortingBonus,
        result: formulaResult,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load recommendation.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
