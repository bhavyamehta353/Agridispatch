export const revalidate = 60; // cache API response for 60 seconds

import base from "../../lib/airtable";
import { ORIGINS, originByFarmOriginId } from "../../lib/origins";
import { PRICING_TIMEZONE } from "../../lib/date-freshness";
import { formatTrafficTimestamp } from "../../lib/traffic-freshness";
import {
  combinedHealthRank,
  combinedRouteHealth,
  congestionFromTau,
  decayFromScore,
  type CombinedRouteHealth,
  type CongestionLevel,
  type DecayLevel,
} from "../../lib/route-conditions-health";
import { NextResponse } from "next/server";

const LOGISTICS_PER_KM = 18;
const TIME_RATE = 160;
const LOGISTICS_FIXED = 500;
const TAU_MULT = 1.5;
const Q_MIN = 0.60;

type Rec = { id: string; get: (k: string) => unknown };

function getField(r: Rec | undefined | null, ...keys: string[]): unknown {
  if (r == null) return undefined;
  for (const k of keys) {
    const v = r.get(k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function linkedIds(val: unknown): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string" && val.startsWith("rec")) return [val];
  return [];
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v != null) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function rawCreatedTime(r: Rec): string | null {
  const raw = (r as unknown as { _rawJson?: { createdTime?: string } })
    ._rawJson;
  return raw?.createdTime ?? null;
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

function normKey(s: string): string {
  return s.trim();
}

function matchKeyFromParts(
  pairKey: string,
  farmKey: string,
  marketId: string
): string {
  const p = normKey(pairKey);
  if (p) return p;
  return `${normKey(farmKey)}::${normKey(marketId)}`;
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

type Reliability = "consistent" | "variable" | "unpredictable" | "insufficient_data";

function tauReliability(tauValues: number[]): Reliability {
  if (tauValues.length < 3) return "insufficient_data";
  const mean = tauValues.reduce((s, t) => s + t, 0) / tauValues.length;
  const variance = tauValues.reduce((s, t) => s + (t - mean) ** 2, 0) / tauValues.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev < 0.1) return "consistent";
  if (stdDev < 0.25) return "variable";
  return "unpredictable";
}

export async function GET() {
  try {
    const [
      routeRecords,
      trafficRecords,
      envRecords,
      marketRecords,
      batchRecords,
      evalRecords,
      handlingRecords,
    ] = await Promise.all([
      base("Route_Reference").select().all(),
      base("Traffic_Estimates").select({ maxRecords: 500 }).all(),
      base("Environmental_Risk").select({ maxRecords: 500 }).all(),
      base("Markets").select().all(),
      base("Farmer_Batches").select({ maxRecords: 500 }).all(),
      base("Market_Evaluation").select({ maxRecords: 300 }).all(),
      base("Handling_Quality").select({ maxRecords: 500 }).all(),
    ]);

    const routes = routeRecords as unknown as Rec[];
    const traffic = trafficRecords as unknown as Rec[];
    const envAll = envRecords as unknown as Rec[];
    const markets = marketRecords as unknown as Rec[];
    const batches = batchRecords as unknown as Rec[];
    const evals = evalRecords as unknown as Rec[];
    const handlingAll = handlingRecords as unknown as Rec[];

    const marketById = new Map<
      string,
      { name: string; location: string; lat: number | null; lng: number | null }
    >();
    for (const m of markets) {
      marketById.set(m.id, {
        name: String(m.get("market_name") ?? "Market"),
        location: String(m.get("location") ?? ""),
        lat: num(m.get("market_lat")),
        lng: num(m.get("market_lng")),
      });
    }

    const marketIdByNameLc = new Map<string, string>();
    for (const m of markets) {
      const n = String(m.get("market_name") ?? "").trim();
      if (n && !marketIdByNameLc.has(n.toLowerCase()))
        marketIdByNameLc.set(n.toLowerCase(), m.id);
    }

    // Build batch record ID → origin_id map so we can resolve
    // traffic/env pair_keys (which use batch_id) to origin_id keys
    // that match Route_Reference pair_keys (which use origin_id).
    const originByBatchRecordId = new Map<string, string>();
    for (const b of batches) {
      const oid = String(getField(b, "origin_id", "farm_origin_id") ?? "").trim();
      if (oid) originByBatchRecordId.set(b.id, oid);
    }

    function resolveOriginFromRecord(rec: Rec): string {
      // Prefer explicit farm_id / origin_key on the record itself
      const direct = String(getField(rec, "farm_id", "origin_key") ?? "").trim();
      if (direct) return direct;
      // Fall back: derive from linked batch_id
      const bids = linkedIds(rec.get("batch_id"));
      for (const bid of bids) {
        const oid = originByBatchRecordId.get(bid);
        if (oid) return oid;
      }
      return "";
    }

    type TrafficRow = {
      id: string;
      matchKey: string;
      tau: number | null;
      createdTime: string;
    };

    const trafficRows: TrafficRow[] = [];
    // batch record id → traffic rows for that batch (for dispatch history lookup)
    const trafficByBatchRecId = new Map<string, TrafficRow[]>();
    let lastRunIso: string | null = null;

    for (const t of traffic) {
      const ct = rawCreatedTime(t);
      if (!ct) continue;
      if (!lastRunIso || ct > lastRunIso) lastRunIso = ct;

      const mids = linkedIds(t.get("market_id"));
      const tau = num(t.get("tau"));
      if (mids.length === 0) continue;

      const originKey = resolveOriginFromRecord(t);
      if (!originKey) continue;

      const bids = linkedIds(t.get("batch_id"));

      for (const mid of mids) {
        const row: TrafficRow = { id: t.id, matchKey: `${originKey}::${mid}`, tau, createdTime: ct };
        trafficRows.push(row);
        for (const bid of bids) {
          const list = trafficByBatchRecId.get(bid) ?? [];
          list.push(row);
          trafficByBatchRecId.set(bid, list);
        }
      }
    }

    type EnvRow = {
      id: string;
      matchKey: string;
      temperatureC: number | null;
      humidityPct: number | null;
      decayScore: number | null;
      createdTime: string;
    };

    const envRowsParsed: EnvRow[] = [];
    // batch record id → env rows for that batch (for dispatch history lookup)
    const envByBatchRecId = new Map<string, EnvRow[]>();

    for (const r of envAll) {
      const ct = rawCreatedTime(r);
      if (!ct) continue;
      if (!lastRunIso || ct > lastRunIso) lastRunIso = ct;

      const mids = linkedIds(r.get("market_id"));
      if (mids.length === 0) continue;

      const originKey = resolveOriginFromRecord(r);
      if (!originKey) continue;

      const bids = linkedIds(r.get("batch_id"));
      const temperatureC = num(getField(r, "temperature_c", "avg_temp_c"));
      const humidityPct = num(getField(r, "humidity_pct", "avg_humidity_pct"));
      const decayScore = num(getField(r, "decay_risk_score", "decay_risk", "k_eff"));

      for (const mid of mids) {
        const row: EnvRow = { id: r.id, matchKey: `${originKey}::${mid}`, temperatureC, humidityPct, decayScore, createdTime: ct };
        envRowsParsed.push(row);
        for (const bid of bids) {
          const list = envByBatchRecId.get(bid) ?? [];
          list.push(row);
          envByBatchRecId.set(bid, list);
        }
      }
    }

    const trafficByKey = new Map<string, TrafficRow[]>();
    for (const row of trafficRows) {
      const list = trafficByKey.get(row.matchKey) ?? [];
      list.push(row);
      trafficByKey.set(row.matchKey, list);
    }
    for (const [, list] of trafficByKey) {
      list.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
    }

    const envByKey = new Map<string, EnvRow[]>();
    for (const row of envRowsParsed) {
      const list = envByKey.get(row.matchKey) ?? [];
      list.push(row);
      envByKey.set(row.matchKey, list);
    }
    for (const [, list] of envByKey) {
      list.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
    }

    const lastRunDisplay = lastRunIso ? formatTrafficTimestamp(lastRunIso) : null;

    type RouteOut = {
      routeRecordId: string;
      pairKey: string | null;
      farmOriginId: string;
      farmName: string;
      marketId: string;
      marketName: string;
      marketLocation: string;
      distanceKm: number;
      tBaseHr: number;
      tau: number | null;
      hasTrafficData: boolean;
      effectiveTravelHr: number;
      congestion: CongestionLevel;
      lastTrafficIso: string | null;
      logisticsCost: number;
      logisticsBreakdown: {
        perKm: number;
        timeComponent: number;
        fixed: number;
        tauUsed: number;
      };
      tauHistory: { recordId: string; createdTime: string; tau: number | null }[];
      temperatureC: number | null;
      humidityPct: number | null;
      decayRiskScore: number | null;
      hasEnvData: boolean;
      decayLevel: DecayLevel;
      lastEnvIso: string | null;
      envHistory: {
        recordId: string;
        createdTime: string;
        decayScore: number | null;
        temperatureC: number | null;
        humidityPct: number | null;
      }[];
      combinedHealth: CombinedRouteHealth;
      avgLogisticsCost: number | null;
      avgDecayScore: number | null;
      reliability: Reliability;
      tauRecordCount: number;
    };

    const routeOutList: RouteOut[] = [];

    for (const r of routes) {
      const pairKeyRaw = String(r.get("pair_key") ?? "");
      const farmKey = String(
        getField(r, "origin_key", "farm_id") ?? ""
      ).trim();
      const mids = linkedIds(r.get("market_id"));
      const marketId = mids[0] ?? "";
      if (!farmKey || !marketId) continue;
      // Match key must align with how traffic/env rows are keyed: originKey::marketRecordId
      const mk = `${farmKey}::${marketId}`;
      const origin = farmKey ? originByFarmOriginId(farmKey) : undefined;
      const farmName =
        origin?.origin_name ??
        String((getField(r, "origin_name") ?? farmKey) || "Farm");
      const farmOriginId = origin?.farm_origin_id ?? farmKey;

      const m = marketById.get(marketId);
      const distanceKm = num(r.get("distance_km")) ?? 0;
      const tBaseHr = num(r.get("t_base_hr")) ?? 0;

      const histRawT = trafficByKey.get(mk) ?? [];
      const seenT = new Set<string>();
      const histT: typeof histRawT = [];
      for (const h of histRawT) {
        if (seenT.has(h.id)) continue;
        seenT.add(h.id);
        histT.push(h);
      }
      const latestT = histT[0];
      const hasTrafficData = latestT != null && latestT.tau != null;
      const tau = latestT?.tau ?? null;
      const tauUsed = tau ?? 0;
      const eff = effectiveTravelHours(tBaseHr, tauUsed);
      const logi = logisticsCost(distanceKm, tBaseHr, tauUsed);
      const congestion = congestionFromTau(latestT?.tau ?? null);

      const histRawE = envByKey.get(mk) ?? [];
      const seenE = new Set<string>();
      const histE: typeof histRawE = [];
      for (const h of histRawE) {
        if (seenE.has(h.id)) continue;
        seenE.add(h.id);
        histE.push(h);
      }
      const latestE = histE[0];
      const hasEnvData =
        latestE != null &&
        (latestE.decayScore != null ||
          latestE.temperatureC != null ||
          latestE.humidityPct != null);
      const decayScore = latestE?.decayScore ?? null;
      const decayLevel = decayFromScore(decayScore);

      const combinedHealth = combinedRouteHealth(
        congestion,
        decayLevel,
        hasTrafficData,
        hasEnvData
      );

      const allTaus = histT.map((h) => h.tau).filter((t): t is number => t != null);
      const avgLogisticsCost =
        allTaus.length > 0
          ? Math.round(
              (allTaus.reduce((sum, t) => sum + logisticsCost(distanceKm, tBaseHr, t), 0) /
                allTaus.length) *
                100
            ) / 100
          : null;
      const allDecays = histE.map((h) => h.decayScore).filter((d): d is number => d != null);
      const avgDecayScore =
        allDecays.length > 0
          ? allDecays.reduce((sum, d) => sum + d, 0) / allDecays.length
          : null;
      const reliability = tauReliability(allTaus);

      routeOutList.push({
        routeRecordId: r.id,
        pairKey: normKey(pairKeyRaw) || null,
        farmOriginId,
        farmName,
        marketId,
        marketName: m?.name ?? "Market",
        marketLocation: m?.location ?? "",
        distanceKm,
        tBaseHr,
        tau,
        hasTrafficData,
        effectiveTravelHr: eff,
        congestion,
        lastTrafficIso: latestT?.createdTime ?? null,
        logisticsCost: Math.round(logi * 100) / 100,
        logisticsBreakdown: {
          perKm: LOGISTICS_PER_KM * distanceKm,
          timeComponent: TIME_RATE * tBaseHr * (1 + TAU_MULT * tauUsed),
          fixed: LOGISTICS_FIXED,
          tauUsed,
        },
        tauHistory: histT.map((h) => ({
          recordId: h.id,
          createdTime: h.createdTime,
          tau: h.tau,
        })),
        temperatureC: latestE?.temperatureC ?? null,
        humidityPct: latestE?.humidityPct ?? null,
        decayRiskScore: decayScore,
        hasEnvData,
        decayLevel,
        lastEnvIso: latestE?.createdTime ?? null,
        envHistory: histE.map((h) => ({
          recordId: h.id,
          createdTime: h.createdTime,
          decayScore: h.decayScore,
          temperatureC: h.temperatureC,
          humidityPct: h.humidityPct,
        })),
        combinedHealth,
        avgLogisticsCost,
        avgDecayScore,
        reliability,
        tauRecordCount: allTaus.length,
      });
    }

    const farmOrder = (fid: string) => {
      const i = ORIGINS.findIndex(
        (o) => o.farm_origin_id === fid || o.origin_id === fid
      );
      return i === -1 ? 999 : i;
    };

    routeOutList.sort((a, b) => {
      const fo = farmOrder(a.farmOriginId) - farmOrder(b.farmOriginId);
      if (fo !== 0) return fo;
      return a.marketName.localeCompare(b.marketName);
    });

    const routeByFarmAndMarket = new Map<string, RouteOut>();
    for (const ro of routeOutList) {
      routeByFarmAndMarket.set(`${ro.farmOriginId}::${ro.marketId}`, ro);
    }

    let worstRoute: string | null = null;
    let worstRank = 0;
    let worstScore = -1;
    for (const ro of routeOutList) {
      const rank = combinedHealthRank(ro.combinedHealth);
      const score = (ro.tau ?? 0) + (ro.decayRiskScore ?? 0);
      if (rank > worstRank) {
        worstRank = rank;
        worstScore = score;
        worstRoute = `${ro.farmName} → ${ro.marketName}`;
      } else if (rank === worstRank && rank >= 4 && score > worstScore) {
        worstScore = score;
        worstRoute = `${ro.farmName} → ${ro.marketName}`;
      }
    }
    const anyHighConcern = routeOutList.some(
      (ro) =>
        ro.combinedHealth === "high_risk" || ro.combinedHealth === "critical"
    );
    if (!anyHighConcern) worstRoute = null;

    const countCongestion = { low: 0, moderate: 0, high: 0 };
    const countDecay = { low: 0, moderate: 0, high: 0 };
    for (const ro of routeOutList) {
      if (ro.hasTrafficData && ro.congestion !== "unknown")
        countCongestion[ro.congestion]++;
      else countCongestion.moderate++;
      if (ro.hasEnvData && ro.decayLevel !== "unknown")
        countDecay[ro.decayLevel]++;
      else countDecay.moderate++;
    }

    const allRoutesClear = routeOutList.every(
      (ro) => ro.combinedHealth === "clear"
    );

    function evaluationsForBatch(br: Rec) {
      const bidText = farmerBatchIdText(br);
      return evals.filter((e) =>
        matchesBatchRef(e.get("batch_id"), br.id, bidText)
      );
    }

    function resolveRecommendedMarket(evList: Rec[]): string | null {
      const direct = evList
        .map((e) =>
          String(getField(e, "recommended_market", "recommended_market_name") ?? "").trim()
        )
        .find(Boolean);
      if (direct) return direct;
      const sorted = [...evList].sort((a, b) => {
        const pa = Number(
          getField(a, "expected_profit", "net_profit", "profit") ?? 0
        );
        const pb = Number(
          getField(b, "expected_profit", "net_profit", "profit") ?? 0
        );
        return pb - pa;
      });
      const top = sorted[0];
      if (!top) return null;
      const mid = top.get("market_id");
      const midFirst = Array.isArray(mid) ? mid[0] : mid;
      if (typeof midFirst === "string" && marketById.has(midFirst)) {
        return marketById.get(midFirst)!.name;
      }
      return null;
    }

    function findHandlingForBatch(br: Rec) {
      const bidText = farmerBatchIdText(br);
      return handlingAll.find((h) =>
        matchesBatchRef(h.get("batch_id"), br.id, bidText)
      );
    }

    type HistoryRow = {
      batchRecordId: string;
      batchId: string;
      farmName: string;
      farmOriginId: string | null;
      harvestTime: string | null;
      harvestTimeDisplay: string;
      status: string;
      recommendedMarket: string | null;
      congestion: CongestionLevel;
      decayLevel: DecayLevel;
      tau: number | null;
      temperatureC: number | null;
      humidityPct: number | null;
      qualityPacked: number | null;
      logisticsCost: number | null;
    };

    const history: HistoryRow[] = [];

    for (const br of batches) {
      const status = String(getField(br, "status") ?? "Submitted");
      const fid = String(getField(br, "farm_origin_id", "origin_id") ?? "").trim();
      const origin = fid ? originByFarmOriginId(fid) : undefined;
      const farmName =
        origin?.origin_name ??
        String((getField(br, "origin_name") ?? fid) || "—");

      const harvestTime = String(getField(br, "harvest_time") ?? "");
      const harvestTimeDisplay = harvestTime
        ? formatTrafficTimestamp(harvestTime)
        : "—";

      const evList = evaluationsForBatch(br);
      const recMarket = resolveRecommendedMarket(evList);
      const recMid = recMarket
        ? marketIdByNameLc.get(recMarket.toLowerCase()) ?? null
        : null;

      // Look up the traffic/env conditions captured for THIS batch specifically
      const batchTraffic = trafficByBatchRecId.get(br.id) ?? [];
      const batchEnv = envByBatchRecId.get(br.id) ?? [];

      // Find the record for the recommended market, or fall back to any record
      const tRec = recMid
        ? (batchTraffic.find((r) => r.matchKey.endsWith(`::${recMid}`)) ?? batchTraffic[0])
        : batchTraffic[0];
      const eRec = recMid
        ? (batchEnv.find((r) => r.matchKey.endsWith(`::${recMid}`)) ?? batchEnv[0])
        : batchEnv[0];

      const tau = tRec?.tau ?? null;
      const congestion = congestionFromTau(tau);
      const decayScore = eRec?.decayScore ?? null;
      const decayLevel = decayFromScore(decayScore);

      const handling = findHandlingForBatch(br);
      const qualityPacked = num(handling?.get("quality_packed"));

      const routeForBatch =
        fid && recMid ? routeByFarmAndMarket.get(`${fid}::${recMid}`) : null;
      const batchLogisticsCost =
        tau != null && routeForBatch
          ? Math.round(
              logisticsCost(routeForBatch.distanceKm, routeForBatch.tBaseHr, tau) * 100
            ) / 100
          : null;

      history.push({
        batchRecordId: br.id,
        batchId: farmerBatchIdText(br) || br.id,
        farmName,
        farmOriginId: fid || null,
        harvestTime: harvestTime || null,
        harvestTimeDisplay,
        status,
        recommendedMarket: recMarket,
        congestion,
        decayLevel,
        tau,
        temperatureC: eRec?.temperatureC ?? null,
        humidityPct: eRec?.humidityPct ?? null,
        qualityPacked,
        logisticsCost: batchLogisticsCost,
      });
    }

    // Most recent harvest first
    history.sort((a, b) =>
      (b.harvestTime ?? "").localeCompare(a.harvestTime ?? "")
    );

    const farmGroups: {
      farmOriginId: string;
      farmName: string;
      routes: RouteOut[];
    }[] = [];

    for (const ro of routeOutList) {
      let g = farmGroups.find((x) => x.farmOriginId === ro.farmOriginId);
      if (!g) {
        g = {
          farmOriginId: ro.farmOriginId,
          farmName: ro.farmName,
          routes: [],
        };
        farmGroups.push(g);
      }
      g.routes.push(ro);
    }

    farmGroups.sort((a, b) => farmOrder(a.farmOriginId) - farmOrder(b.farmOriginId));

    const mapFarms = ORIGINS.map((o) => ({
      id: o.farm_origin_id,
      name: o.origin_name,
      lat: o.origin_lat,
      lng: o.origin_lng,
    }));

    const mapMarkets = markets.map((m) => ({
      id: m.id,
      name: String(m.get("market_name") ?? ""),
      lat: num(m.get("market_lat")),
      lng: num(m.get("market_lng")),
      location: String(m.get("location") ?? ""),
    }));

    return NextResponse.json({
      timeZone: PRICING_TIMEZONE,
      qMin: Q_MIN,
      lastRunIso,
      lastRunDisplay,
      summary: {
        traffic: countCongestion,
        environment: countDecay,
        worstRoute,
        allRoutesClear,
        noTrafficRecords: trafficRows.length === 0,
        noEnvRecords: envRowsParsed.length === 0,
      },
      map: {
        farms: mapFarms,
        markets: mapMarkets.filter((x) => x.lat != null && x.lng != null),
      },
      farms: farmGroups,
      history,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load route conditions.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
