import base from "../../lib/airtable";
import {
  environmentalDataFreshnessLevel,
  environmentalFreshnessCopy,
  formatEnvTimestamp,
} from "../../lib/environmental-freshness";
import { ORIGINS, originByFarmOriginId } from "../../lib/origins";
import { PRICING_TIMEZONE } from "../../lib/date-freshness";
import {
  ageHoursSince,
  formatTrafficTimestamp,
  trafficDataFreshnessLevel,
  trafficFreshnessCopy,
} from "../../lib/traffic-freshness";
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

const LOGISTICS_PER_KM = 12;
const TIME_RATE = 150;
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

function freshnessToneRank(
  level: "none" | "green" | "amber" | "red"
): number {
  if (level === "red") return 3;
  if (level === "amber") return 2;
  if (level === "green") return 1;
  return 3;
}

export async function GET() {
  const now = new Date();
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
      base("Traffic_Estimates").select().all(),
      base("Environmental_Risk").select().all(),
      base("Markets").select().all(),
      base("Farmer_Batches").select().all(),
      base("Market_Evaluation").select().all(),
      base("Handling_Quality").select().all(),
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

    type TrafficRow = {
      id: string;
      matchKey: string;
      tau: number | null;
      createdTime: string;
    };

    const trafficRows: TrafficRow[] = [];
    let trafficLatestIso: string | null = null;

    for (const t of traffic) {
      const ct = rawCreatedTime(t);
      if (!ct) continue;
      if (!trafficLatestIso || ct > trafficLatestIso) trafficLatestIso = ct;

      const pairKey = String(t.get("pair_key") ?? "");
      const farmKey = String(
        getField(t, "farm_id", "origin_key") ?? ""
      ).trim();
      const mids = linkedIds(t.get("market_id"));
      const tau = num(t.get("tau"));
      if (mids.length === 0 && !normKey(pairKey)) continue;

      if (mids.length === 0) {
        trafficRows.push({
          id: t.id,
          matchKey: normKey(pairKey),
          tau,
          createdTime: ct,
        });
        continue;
      }
      for (const mid of mids) {
        trafficRows.push({
          id: t.id,
          matchKey: matchKeyFromParts(pairKey, farmKey, mid),
          tau,
          createdTime: ct,
        });
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
    let envLatestIso: string | null = null;

    for (const r of envAll) {
      const ct = rawCreatedTime(r);
      if (!ct) continue;
      if (!envLatestIso || ct > envLatestIso) envLatestIso = ct;

      const pairKey = String(r.get("pair_key") ?? "");
      const farmKey = String(
        getField(r, "farm_id", "origin_key") ?? ""
      ).trim();
      const mids = linkedIds(r.get("market_id"));
      if (mids.length === 0 && !normKey(pairKey)) continue;

      const temperatureC = num(
        getField(r, "temperature_c", "avg_temp_c")
      );
      const humidityPct = num(
        getField(r, "humidity_pct", "avg_humidity_pct")
      );
      const decayScore = num(
        getField(r, "decay_risk_score", "decay_risk", "k_eff")
      );

      const push = (mk: string) => {
        envRowsParsed.push({
          id: r.id,
          matchKey: mk,
          temperatureC,
          humidityPct,
          decayScore,
          createdTime: ct,
        });
      };

      if (mids.length === 0) push(normKey(pairKey));
      else for (const mid of mids) push(matchKeyFromParts(pairKey, farmKey, mid));
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

    const trafficAgeHours = trafficLatestIso
      ? ageHoursSince(trafficLatestIso, now)
      : null;
    const trafficLevel =
      trafficRows.length === 0
        ? ("none" as const)
        : trafficDataFreshnessLevel(trafficAgeHours);
    const trafficMsg = trafficFreshnessCopy(
      trafficLevel,
      trafficLatestIso ? formatTrafficTimestamp(trafficLatestIso) : null
    );

    const envAgeHours = envLatestIso ? ageHoursSince(envLatestIso, now) : null;
    const envLevel =
      envRowsParsed.length === 0
        ? ("none" as const)
        : environmentalDataFreshnessLevel(envAgeHours);
    const envMsg = environmentalFreshnessCopy(
      envLevel,
      envLatestIso ? formatEnvTimestamp(envLatestIso) : null
    );

    const pageTone =
      freshnessToneRank(trafficLevel) >= freshnessToneRank(envLevel)
        ? trafficLevel
        : envLevel;

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
    };

    const routeOutList: RouteOut[] = [];

    for (const r of routes) {
      const pairKeyRaw = String(r.get("pair_key") ?? "");
      const farmKey = String(
        getField(r, "origin_key", "farm_id") ?? ""
      ).trim();
      const mids = linkedIds(r.get("market_id"));
      const marketId = mids[0] ?? "";
      const mk = matchKeyFromParts(pairKeyRaw, farmKey, marketId);
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
        tauHistory: histT.slice(0, 5).map((h) => ({
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
        envHistory: histE.slice(0, 5).map((h) => ({
          recordId: h.id,
          createdTime: h.createdTime,
          decayScore: h.decayScore,
          temperatureC: h.temperatureC,
          humidityPct: h.humidityPct,
        })),
        combinedHealth,
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

    type Exposure = {
      batchRecordId: string;
      batchId: string;
      farmName: string;
      farmOriginId: string | null;
      status: string;
      recommendedMarket: string | null;
      congestion: CongestionLevel;
      decayLevel: DecayLevel;
      qualityPacked: number | null;
      exposureNote: string;
      exposureRank: number;
    };

    const exposure: Exposure[] = [];

    for (const br of batches) {
      const status = String(getField(br, "status") ?? "Submitted");
      if (status !== "Submitted" && status !== "Evaluated") continue;

      const fid = String(
        getField(br, "farm_origin_id", "origin_id") ?? ""
      ).trim();
      const origin = fid ? originByFarmOriginId(fid) : undefined;
      const farmName =
        origin?.origin_name ??
        String((getField(br, "origin_name") ?? fid) || "—");

      const evList = evaluationsForBatch(br);
      const recMarket = resolveRecommendedMarket(evList);
      const recMid = recMarket
        ? marketIdByNameLc.get(recMarket.toLowerCase()) ?? null
        : null;

      const ro =
        recMid != null
          ? routeOutList.find(
              (x) =>
                (x.farmOriginId === fid ||
                  x.farmOriginId === origin?.farm_origin_id) &&
                x.marketId === recMid
            )
          : undefined;

      const congestion = ro?.congestion ?? "unknown";
      const decayLevel = ro?.decayLevel ?? "unknown";
      const handling = findHandlingForBatch(br);
      const qualityPacked = num(handling?.get("quality_packed"));

      let exposureNote = "";
      let exposureRank = 0;

      const q = qualityPacked;
      const highCong = congestion === "high";
      const highDecay = decayLevel === "high";

      if (highCong && highDecay) {
        exposureNote =
          "⚠ Critical exposure — both route conditions are poor";
        exposureRank = 100;
      } else if (q != null && q < Q_MIN) {
        exposureNote = "✗ Below Q_MIN — do not dispatch regardless of route conditions";
        exposureRank = 90;
      } else if (highDecay && q != null && q < 0.75) {
        exposureNote =
          "⚠ Vulnerable batch on a high-risk route";
        exposureRank = 80;
      } else if (highCong) {
        exposureNote =
          "Logistics cost will be significantly elevated — re-run evaluation with current traffic";
        exposureRank = 50;
      }

      exposure.push({
        batchRecordId: br.id,
        batchId: farmerBatchIdText(br) || br.id,
        farmName,
        farmOriginId: fid || null,
        status,
        recommendedMarket: recMarket,
        congestion,
        decayLevel,
        qualityPacked,
        exposureNote,
        exposureRank,
      });
    }

    exposure.sort((a, b) => b.exposureRank - a.exposureRank);

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
      pageTone,
      trafficFreshness: {
        level: trafficLevel,
        headline: trafficMsg.headline,
        detail: trafficMsg.detail,
        lastUpdatedIso: trafficLatestIso,
        ageHours: trafficAgeHours,
        lastUpdatedDisplay: trafficLatestIso
          ? formatTrafficTimestamp(trafficLatestIso)
          : null,
      },
      envFreshness: {
        level: envLevel,
        headline: envMsg.headline,
        detail: envMsg.detail,
        lastUpdatedIso: envLatestIso,
        ageHours: envAgeHours,
        lastUpdatedDisplay: envLatestIso
          ? formatEnvTimestamp(envLatestIso)
          : null,
      },
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
      exposure,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to load route conditions.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
