import base from "../../../../lib/airtable";
import {
  calendarDayInTimeZone,
  PRICING_TIMEZONE,
} from "../../../../lib/date-freshness";
import { originByFarmOriginId } from "../../../../lib/origins";
import { NextResponse } from "next/server";

export const Q_MIN = 0.65;
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

function decayBucket(score: number | null): "Low" | "Medium" | "High" {
  if (score == null) return "Medium";
  if (score < 0.34) return "Low";
  if (score < 0.67) return "Medium";
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
    const status = String(getField(batchRecord, "status") ?? "Submitted");
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
        arrivalDay: arrivalDay(r.get("arrival_date")),
        arrivalRaw: r.get("arrival_date"),
        modal: num(r.get("modal_price")) ?? num(r.get("price_per_kg")),
        createdTime: rawCreatedTime(r),
      };
    });

    const latestPriceByMarket = new Map<
      string,
      (typeof pricingParsed)[number]
    >();
    const sortedP = [...pricingParsed]
      .filter((x) => x.marketId && x.arrivalDay)
      .sort((a, b) => {
        const c = (b.arrivalDay ?? "").localeCompare(a.arrivalDay ?? "");
        if (c !== 0) return c;
        return (b.createdTime ?? "").localeCompare(a.createdTime ?? "");
      });
    for (const row of sortedP) {
      if (!latestPriceByMarket.has(row.marketId))
        latestPriceByMarket.set(row.marketId, row);
    }

    const todayDay = calendarDayInTimeZone(new Date(), PRICING_TIMEZONE);

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
      const effTravel = effectiveTravelHours(tBaseHr, tau);
      const logi = logisticsCost(distanceKm, tBaseHr, tau);

      const priceRow = latestPriceByMarket.get(m.id);
      const modal = priceRow?.modal ?? null;
      const priceStale =
        priceRow?.arrivalDay != null && priceRow.arrivalDay < todayDay;

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

      const feasible =
        qualityPacked != null && qualityPacked >= Q_MIN;

      const decayRaw = num(
        getField(risk as Rec, "decay_risk_score", "decay_risk", "k_eff")
      );
      const decayBucketed = decayBucket(decayRaw);

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
        grossRevenue: gross,
        commissionRate: rate,
        commissionAmount: commissionAmt,
        netRevenue: netRev,
        expectedProfit,
        feasible,
        decayRisk: decayBucketed,
        decayRaw,
        temperatureC: num(
          getField(risk as Rec, "temperature_c", "avg_temp_c")
        ),
        humidityPct: num(
          getField(risk as Rec, "humidity_pct", "avg_humidity_pct")
        ),
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

    const sortedByProfit = [...profits].sort((a, b) => b.profit - a.profit);
    const topProfit = sortedByProfit[0];
    const secondProfitRow = sortedByProfit[1];
    const secondProfitVal = secondProfitRow?.profit ?? null;
    const margin =
      topProfit && secondProfitVal != null
        ? topProfit.profit - secondProfitVal
        : null;

    let winnerMarketId: string | null = null;
    let winnerNameFromEval: string | null = null;

    const recMarketHint = evalRows
      .map((e) => String(getField(e, "recommended_market") ?? "").trim())
      .find(Boolean);
    if (recMarketHint) {
      const match = markets.find(
        (m) =>
          m.name === recMarketHint ||
          m.name.toLowerCase() === recMarketHint.toLowerCase()
      );
      if (match) winnerMarketId = match.id;
      winnerNameFromEval = recMarketHint;
    }

    if (!winnerMarketId && topProfit) {
      winnerMarketId = topProfit.id;
    }

    const winnerCol = marketColumns.find((c) => c.marketId === winnerMarketId);
    const winnerName =
      winnerNameFromEval ?? winnerCol?.marketName ?? "—";

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
      headerPricingDay != null && headerPricingDay < todayDay;

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
          margin != null && margin < 500 && secondProfitRow != null,
      },
      winnerCard: {
        marketName: winnerName,
        expectedProfit: winnerCol?.expectedProfit ?? null,
        modalPrice: winnerModal,
        distanceKm: winnerDistance,
        effectiveTravelHr: winnerEffTravel,
        marginOverNext: margin,
        closeCall:
          margin != null && margin < 500 && secondProfitRow != null,
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
