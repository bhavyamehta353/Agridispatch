"use client";

import dynamic from "next/dynamic";
import { FlaskConical, TrendingUp, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "../../lib/auth";

const RecommendedRouteMap = dynamic(() => import("./recommended-route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(16rem,38vh,24rem)] w-full items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 text-sm text-zinc-500 sm:h-[clamp(18rem,42vh,28rem)]">
      Loading route map...
    </div>
  ),
});

// ── Types ────────────────────────────────────────────────────────────────────

type UncertaintyMarket = {
  marketId: string;
  marketName: string;
  netProfitWorst: number;
  netProfitLikely: number;
  netProfitBest: number;
  feasibilityProb: number;
  recommendationStability: number;
  nSimulations: number;
  gated: boolean;
};

type UncertaintyPayload = {
  hasData: boolean;
  mcRecommendedMarketId: string | null;
  feasibilityThreshold: number;
  nSimulations: number;
  markets: UncertaintyMarket[];
  error?: string;
};

type MarketCol = {
  marketId: string;
  marketName: string;
  marketLat: number | null;
  marketLng: number | null;
  modalPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceEffective: number | null;
  fpoSupplyPct: number | null;
  priceArrivalDay: string | null;
  priceStale: boolean;
  distanceKm: number;
  tBaseHr: number;
  tau: number;
  tActualHr: number;
  effectiveTravelHr: number;
  logisticsCost: number;
  logisticsBreakdown: {
    distanceKm: number;
    tBaseHr: number;
    tau: number;
    perKm: number;
    timeComponent: number;
    fixed: number;
  };
  expectedProfit: number | null;
  feasible: boolean;
  decayRisk: "Low" | "Medium" | "High";
};

type RecPayload = {
  qMin: number;
  batch: {
    recordId: string;
    batchId: string;
    farmName: string;
    farmOriginId: string | null;
    farmLat: number | null;
    farmLng: number | null;
    harvestTime: string | null;
    weightKg: number;
    status: string;
  };
  handling: {
    qualityPacked: number | null;
    qualityInitial: number | null;
    damageFactor: number;
    sortingBonus: number;
    kMultiplier: number;
    weightPacked: number | null;
    packagingType: string | null;
    fillLevel: string | null;
    qualityTier: string;
    maturityGrade: string;
  };
  evaluation: {
    hasEvaluation: boolean;
    evaluationTime: string | null;
    recommendedMarketName: string;
    winnerMarketId: string | null;
    marginOverNext: number | null;
    closeCall: boolean;
  };
  winnerCard: {
    marketName: string;
    expectedProfit: number | null;
    modalPrice: number | null;
    distanceKm: number | null;
    effectiveTravelHr: number | null;
    marginOverNext: number | null;
    closeCall: boolean;
    feasible: boolean;
  };
  markets: MarketCol[];
  headerMeta: {
    pricingActiveDay: string | null;
    pricingStale: boolean;
    todayCalendar: string;
  };
  routeWinner: {
    farmName: string;
    farmLat: number | null;
    farmLng: number | null;
    marketName: string;
    marketLat: number | null;
    marketLng: number | null;
    distanceKm: number;
    tBaseHr: number;
    tau: number;
    effectiveTravelHr: number;
    temperatureC: number | null;
    humidityPct: number | null;
    decayRiskScore: number | null;
    decayBucket: string;
  } | null;
  edge: { allInfeasible: boolean; dispatched: boolean };
  formula: {
    qualityInitial: number | null;
    damageFactor: number;
    sortingBonus: number;
    result: number | null;
  };
  error?: string;
};

// ── Decay math — exact mirrors of math_models.py ─────────────────────────────
// Constants from ModelParams (math_models.py §6)
const K_REF       = 0.015;
const T_REF       = 25.0;
const BETA_TEMP   = 0.08;
const DELTA_HUM   = 0.00351;
const DELTA_VPD   = 0.252462;
// Market fee constants (math_models.py §6)
const MARKET_FEE_PCT  = 0.01;
const COMMISSION_PCT  = 0.025;
// Price elasticity from log-log OLS (math_models.py — Item 34)
const PRICE_ELASTICITY: Record<string, number> = {
  "MKT001": -0.3514,
  "MKT002": -0.1462,
  "MKT003": -0.2340,
};

const SEASONAL_FACTOR: Record<string, number> = {
  Jan: 0.7465, Feb: 0.9368, Mar: 1.2625, Apr: 1.6207, May: 1.5692,
  Jun: 1.0012, Jul: 0.7987, Aug: 0.7779, Sep: 0.7885, Oct: 0.9048,
  Nov: 0.8516, Dec: 0.7416,
};
const MATURITY_DECAY: Record<string, number> = {
  Breaker: 0.85, Turning: 0.90, Pink: 0.95, "Light Red": 1.00, "Red Ripe": 1.10,
};

function computeVPD(T: number, H: number): number {
  const es = 0.6108 * Math.exp((17.27 * T) / (T + 237.3));
  return es * (1 - H / 100);
}
function computeKBase(T: number, H: number, month: string): number {
  const vpd = computeVPD(T, H);
  const hf = (1 + DELTA_HUM * H) * (1 + DELTA_VPD * vpd);
  return K_REF * (SEASONAL_FACTOR[month] ?? 1.0) * Math.exp(BETA_TEMP * (T - T_REF)) * hf;
}
function computeKEff(kb: number, kMult: number, maturityGrade: string): number {
  return kb * kMult * (MATURITY_DECAY[maturityGrade] ?? 1.0);
}
function computeQualityArrival(qPacked: number, ke: number, tHr: number): number {
  return Math.max(0, Math.min(1, qPacked * Math.exp(-ke * tHr)));
}
// math_models.py §11 — three-point linear interpolation of price by quality
// Fallback matches Python exactly: return full modal when min/max unavailable
function qualityAdjustedPrice(q: number, pMin: number | null, pModal: number | null, pMax: number | null, qMin: number): number | null {
  if (pModal == null) return null;
  if (pMin == null || pMax == null) return pModal;
  if (q >= 0.85) return pModal + (pMax - pModal) * (q - 0.85) / 0.15;
  if (q >= qMin) return pMin + (pModal - pMin) * (q - qMin) / (0.85 - qMin);
  return pMin * 0.60;
}

function harvestMonth(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return Number.isNaN(d.getTime())
    ? new Date().toLocaleString("en-US", { month: "short", timeZone: "Asia/Kolkata" })
    : d.toLocaleString("en-US", { month: "short", timeZone: "Asia/Kolkata" });
}
// ─────────────────────────────────────────────────────────────────────────────

function formatInr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatHarvest(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function QualityDot({ tier }: { tier: string }) {
  const cls =
    tier === "good" ? "bg-emerald-500"
    : tier === "mid" ? "bg-amber-500"
    : tier === "bad" ? "bg-red-500"
    : "bg-zinc-400";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`} title="Quality packed" />;
}

function DecayBadge({ level }: { level: string }) {
  const cls =
    level === "Low" ? "bg-emerald-900/40 text-emerald-400 ring-1 ring-emerald-700/40"
    : level === "Medium" ? "bg-amber-900/40 text-amber-400 ring-1 ring-amber-700/40"
    : "bg-red-900/40 text-red-400 ring-1 ring-red-700/40";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>{level}</span>;
}

function QualityBar({ value, qMin }: { value: number; qMin: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.85 ? "bg-emerald-500"
    : value >= qMin ? "bg-amber-500"
    : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-700">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs tabular-nums ${
        value >= 0.85 ? "text-emerald-400"
        : value >= qMin ? "text-amber-400"
        : "text-red-400"
      }`}>
        {value.toFixed(3)}
      </span>
    </div>
  );
}

async function loadRecommendation(recordId: string): Promise<RecPayload> {
  const res = await fetch(`/api/batches/${recordId}/recommendation`);
  const json = (await res.json()) as RecPayload;
  if (!res.ok) throw new Error(json.error ?? "Failed to load");
  return json;
}

export function RecommendationClient({
  recordId,
  userRole,
}: {
  recordId: string;
  userRole: UserRole | null;
}) {

  const [data, setData] = useState<RecPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDispatch, setConfirmDispatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dispatchErr, setDispatchErr] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"recommendation" | "simulate" | "forecast">("recommendation");
  const [forecastData, setForecastData] = useState<UncertaintyPayload | null>(null);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastErr, setForecastErr] = useState<string | null>(null);
  const forecastFetchedRef = useRef(false);

  // Simulator sliders
  const [tempC, setTempC] = useState(25);
  const [humidity, setHumidity] = useState(65);
  const conditionsInitialized = useRef(false);

  // Seed sliders from stored route conditions on first data load
  useEffect(() => {
    if (data && !conditionsInitialized.current) {
      conditionsInitialized.current = true;
      if (data.routeWinner?.temperatureC != null) setTempC(data.routeWinner.temperatureC);
      if (data.routeWinner?.humidityPct    != null) setHumidity(data.routeWinner.humidityPct);
    }
  }, [data]);

  useEffect(() => {
    if (activeTab !== "forecast" || forecastFetchedRef.current) return;
    forecastFetchedRef.current = true;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    setForecastLoading(true);
    setForecastErr(null);
    fetch(`/api/batches/${recordId}/uncertainty`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json: UncertaintyPayload) => {
        if (!cancelled) setForecastData(json);
      })
      .catch(() => {
        if (!cancelled) setForecastErr("Could not load forecast data. Try refreshing.");
      })
      .finally(() => {
        clearTimeout(timeout);
        if (!cancelled) setForecastLoading(false);
      });
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [activeTab, recordId]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await loadRecommendation(recordId));
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      setLoading(true);
      setErr(null);
      try {
        const next = await loadRecommendation(recordId);
        if (!cancelled) setData(next);
      } catch (error) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Network error");
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [recordId]);

  async function dispatch() {
    setBusy(true);
    try {
      const res = await fetch(`/api/batches/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Dispatched" }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) { setDispatchErr(j.error ?? "Dispatch failed"); return; }
      setConfirmDispatch(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  // ── Simulation computation ────────────────────────────────────────────────
  // Recomputes for every market whenever sliders change.
  // Formula chain: k_base → k_eff → quality_arrival_pred → feasibility → profit
  const simulation = useMemo(() => {
    if (!data?.handling.qualityPacked) return null;
    const month = harvestMonth(data.batch.harvestTime);
    const vpd   = computeVPD(tempC, humidity);
    const kb    = computeKBase(tempC, humidity, month);
    const ke    = computeKEff(kb, data.handling.kMultiplier, data.handling.maturityGrade);

    // Use weight_packed_kg (post-reject-rate) to match Python evaluation_agent
    const weightForSim = data.handling.weightPacked ?? data.batch.weightKg;

    const markets = data.markets.map((m) => {
      // Use actual travel time (tBase × (1+τ)) for decay — not the logistics-penalized effectiveTravelHr
      const tDecayHr = m.tActualHr ?? m.tBaseHr * (1 + m.tau);
      const qArr       = computeQualityArrival(data.handling.qualityPacked!, ke, tDecayHr);
      const simFeasible = qArr >= data.qMin;

      // When no modal price is stored, use stored price_effective as proxy
      const modalForSim = m.modalPrice ?? m.priceEffective ?? null;
      const pEff = qualityAdjustedPrice(qArr, m.minPrice, modalForSim, m.maxPrice, data.qMin);

      // Apply equilibrium price adjustment (math_models.py — Item 34)
      // Supply is fixed on the day; only quality changes with T/H sliders
      let pAdj: number | null = pEff;
      if (pEff != null && m.fpoSupplyPct != null) {
        const supplyFrac = m.fpoSupplyPct / 100;
        const elasticity = PRICE_ELASTICITY[m.marketId] ?? -0.20;
        const adjusted = pEff * Math.pow(1 + supplyFrac, elasticity);
        pAdj = Math.max(adjusted, pEff * 0.60);
      }

      const simProfit = simFeasible && pAdj != null
        ? Math.round(pAdj * weightForSim * (1 - MARKET_FEE_PCT - COMMISSION_PCT) - m.logisticsCost)
        : null;
      return { ...m, qArr, simFeasible, simProfit };
    });

    const winner = [...markets]
      .filter(m => m.simFeasible && m.simProfit != null)
      .sort((a, b) => (b.simProfit ?? 0) - (a.simProfit ?? 0))[0] ?? null;

    return { vpd, kb, ke, month, markets, winner };
  }, [data, tempC, humidity]);
  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-zinc-500">
        Loading recommendation...
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-red-400">{err ?? "Unknown error"}</p>
        <Link href="/batches" className="mt-4 inline-block text-emerald-400 underline">
          Back to overview
        </Link>
      </div>
    );
  }

  const q        = data.handling.qualityPacked;
  const qMin     = data.qMin;
  const canDispatch =
    data.batch.status === "Evaluated" && q != null && q >= qMin && !data.edge.dispatched;
  const winnerId = data.evaluation.winnerMarketId;

  if (!data.evaluation.hasEvaluation) {
    return (
      <div className="pb-28">
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-4 sm:px-6">
          <p className="text-xs uppercase tracking-widest text-zinc-500">Batch</p>
          <p className="font-mono font-semibold text-zinc-100">{data.batch.batchId}</p>
        </div>
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-lg font-semibold text-zinc-200">No evaluation yet for this batch.</p>
          <p className="mt-2 text-sm text-zinc-500">
            Run the evaluation pipeline to compare markets and see a recommended dispatch.
          </p>
          <Link href="/batches" className="mt-4 block text-sm text-emerald-400 underline underline-offset-2">
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  const wc = data.winnerCard;
  const secondName =
    [...data.markets]
      .filter(m => m.marketId !== winnerId)
      .sort((a, b) => (b.expectedProfit ?? -1e9) - (a.expectedProfit ?? -1e9))[0]
      ?.marketName ?? "next best";
  const routeMapPoints =
    data.routeWinner &&
    data.routeWinner.farmLat != null && data.routeWinner.farmLng != null &&
    data.routeWinner.marketLat != null && data.routeWinner.marketLng != null
      ? {
          farm:   { id: data.batch.farmOriginId ?? data.batch.recordId, name: data.routeWinner.farmName,   lat: data.routeWinner.farmLat,   lng: data.routeWinner.farmLng },
          market: { id: winnerId ?? data.routeWinner.marketName,         name: data.routeWinner.marketName, lat: data.routeWinner.marketLat, lng: data.routeWinner.marketLng },
        }
      : null;

  const simWinnerChanged =
    simulation != null && (
      (simulation.winner != null && simulation.winner.marketId !== winnerId) ||
      (simulation.winner == null && winnerId != null)
    );

  return (
    <div className="pb-32">
      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-900/95 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="mx-auto max-w-6xl space-y-1.5">
          {/* Primary row — pill chips + tab toggle */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Batch — highlighted */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-800/60 bg-emerald-950/50 px-2.5 py-1 text-xs">
              <span className="text-emerald-600">Batch</span>
              <span className="font-mono font-bold text-emerald-400">{data.batch.batchId}</span>
            </span>
            {/* Farm */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs">
              <span className="text-zinc-500">Farm</span>
              <span className="font-medium text-zinc-200">{data.batch.farmName}</span>
            </span>
            {/* Harvest */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs">
              <span className="text-zinc-500">Harvest</span>
              <span className="font-mono text-zinc-300">{formatHarvest(data.batch.harvestTime)}</span>
            </span>
            {/* Weight */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs">
              <span className="text-zinc-500">Weight</span>
              <span className="font-mono text-zinc-300">{data.batch.weightKg} kg</span>
            </span>
            {/* Quality */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs">
              <span className="text-zinc-500">Quality</span>
              <QualityDot tier={data.handling.qualityTier} />
              <span className="font-mono tabular-nums text-zinc-300">{q != null ? q.toFixed(2) : "—"}</span>
            </span>

            {/* Tab toggle — right */}
            <div className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800 p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("recommendation")}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  activeTab === "recommendation"
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Recommendation
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("simulate")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  activeTab === "simulate"
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <FlaskConical className="h-3 w-3" />
                Simulate
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("forecast")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  activeTab === "forecast"
                    ? "bg-zinc-700 text-zinc-100 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <TrendingUp className="h-3 w-3" />
                Forecast
              </button>
            </div>
          </div>

          {/* Secondary row — eval + prices, muted */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600">
            <span>
              Eval:{" "}
              <span className="text-zinc-500">
                {data.evaluation.evaluationTime ? formatHarvest(data.evaluation.evaluationTime) : "—"}
              </span>
            </span>
          </div>
        </div>
      </header>

      {/* ── Recommendation tab ─────────────────────────────────────────────── */}
      {activeTab === "recommendation" ? (
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          {data.edge.allInfeasible ? (
            <div className="rounded-xl border border-red-800/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              No feasible market — quality below Q_MIN ({qMin}) for all routes.
            </div>
          ) : null}


          <section className="rounded-2xl border-2 border-emerald-700/60 bg-gradient-to-br from-emerald-950/60 to-zinc-900 p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-500">
              Recommended dispatch
            </p>
            <h1 className="mt-1 text-3xl font-bold text-zinc-100">{wc.marketName}</h1>
            <p className="mt-3 text-4xl font-bold text-emerald-400 tabular-nums">
              {formatInr(wc.expectedProfit)}
            </p>
            <p className="mt-1 text-sm text-zinc-500">Expected profit</p>

            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-zinc-500">Modal price</span>{" "}
                <span className="font-mono font-semibold text-zinc-200">
                  {wc.modalPrice != null ? `₹${wc.modalPrice}/kg` : "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Distance</span>{" "}
                <span className="font-mono text-zinc-200">
                  {wc.distanceKm != null ? `${wc.distanceKm} km` : "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Est. travel</span>{" "}
                <span className="font-mono text-zinc-200">
                  {wc.effectiveTravelHr != null ? `${wc.effectiveTravelHr.toFixed(2)} hr` : "—"}
                </span>
              </div>
            </div>

            {wc.marginOverNext != null && wc.marginOverNext > 0 ? (
              <p className="mt-4 text-sm font-medium text-zinc-300">
                {formatInr(wc.marginOverNext)} ahead of {secondName}
              </p>
            ) : null}

            {wc.closeCall ? (
              <p className="mt-2 rounded-lg border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-400">
                Close call — verify current prices before dispatching.
              </p>
            ) : null}

            <div className="mt-4">
              {wc.feasible ? (
                <span className="inline-flex rounded-full bg-emerald-700 px-3 py-1 text-xs font-bold text-white">
                  Feasible
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-red-700 px-3 py-1 text-xs font-bold text-white">
                  Below threshold
                </span>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-zinc-100">Market comparison</h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-800/50">
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-zinc-500">
                      Metric
                    </th>
                    {data.markets.map((m) => {
                      const win   = m.marketId === winnerId;
                      const muted = !m.feasible;
                      return (
                        <th
                          key={m.marketId}
                          className={`px-3 py-3 text-right ${
                            win ? "bg-emerald-950/60 ring-2 ring-inset ring-emerald-700/60" : ""
                          } ${muted ? "opacity-50" : ""}`}
                        >
                          <div className="font-semibold text-zinc-200">{m.marketName}</div>
                          {win   ? <div className="mt-1 text-xs font-normal text-emerald-400">Recommended</div> : null}
                          {muted ? <div className="mt-1 text-xs text-red-400">Not feasible</div> : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {(
                    [
                      {
                        label: "Logistics (₹)",
                        fn: (m: MarketCol) => (
                          <span
                            title={`₹18×${m.logisticsBreakdown.distanceKm} + ₹160×${m.logisticsBreakdown.tBaseHr}×(1+1.5×${m.logisticsBreakdown.tau}) + ₹500 = ₹${m.logisticsCost.toFixed(2)}`}
                            className="cursor-help border-b border-dotted border-zinc-600"
                          >
                            {formatInr(m.logisticsCost)}
                          </span>
                        ),
                      },
                      {
                        label: "Expected profit (₹)",
                        fn: (m: MarketCol) => m.feasible
                          ? <strong className="text-emerald-400">{formatInr(m.expectedProfit)}</strong>
                          : <span className="text-zinc-600" title="Not shown — batch would not arrive at acceptable quality">—</span>,
                      },
                      { label: "Distance (km)",    fn: (m: MarketCol) => m.distanceKm },
                      { label: "Est. travel (hr)", fn: (m: MarketCol) => m.effectiveTravelHr.toFixed(2) },
                      { label: "Decay risk",        fn: (m: MarketCol) => m.feasible ? <DecayBadge level={m.decayRisk} /> : <span className="text-zinc-600">—</span> },
                      { label: "Feasible",          fn: (m: MarketCol) => (m.feasible ? "Yes" : "No") },
                    ] as const
                  ).map((row) => (
                    <tr key={row.label} className="border-b border-zinc-800 hover:bg-zinc-800/40">
                      <td className="px-3 py-2 font-medium text-zinc-500">{row.label}</td>
                      {data.markets.map((m) => {
                        const win   = m.marketId === winnerId;
                        const muted = !m.feasible;
                        return (
                          <td
                            key={m.marketId}
                            className={`px-3 py-2 text-right ${win ? "bg-emerald-950/30" : ""} ${
                              muted ? "text-zinc-600" : "text-zinc-300"
                            }`}
                          >
                            {row.fn(m)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.routeWinner ? (
            <div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="flex items-center gap-2 font-bold text-zinc-200">
                  <Truck className="h-4 w-4 text-emerald-500" />
                  Route &amp; risk (winning market)
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/40 px-2.5 py-1 font-medium text-emerald-400 ring-1 ring-emerald-700/40">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Farm
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-950/40 px-2.5 py-1 font-medium text-blue-400 ring-1 ring-blue-700/40">
                    <span className="h-2.5 w-2.5 rounded-full bg-blue-400" />
                    Market
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2.5 py-1 font-medium text-zinc-400 ring-1 ring-zinc-700">
                    <Truck className="h-3.5 w-3.5 text-emerald-500" />
                    Selected route
                  </span>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {routeMapPoints ? (
                  <RecommendedRouteMap farm={routeMapPoints.farm} market={routeMapPoints.market} />
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-500">
                    Route map unavailable — missing farm or market coordinates.
                  </div>
                )}
              </div>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {[
                  ["Route",            `${data.routeWinner.farmName} → ${data.routeWinner.marketName}`],
                  ["Distance",         `${data.routeWinner.distanceKm} km`],
                  ["Est. travel",      `${data.routeWinner.effectiveTravelHr.toFixed(1)} hr`],
                  ["Temperature",      data.routeWinner.temperatureC != null ? `${data.routeWinner.temperatureC} °C` : "—"],
                  ["Humidity",         data.routeWinner.humidityPct != null ? `${data.routeWinner.humidityPct}%` : "—"],
                ].map(([label, val]) => (
                  <div key={String(label)} className="flex justify-between gap-2 border-b border-zinc-800 py-1.5 text-sm">
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="font-mono text-zinc-300">{String(val)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-2 border-b border-zinc-800 py-1.5 text-sm">
                  <dt className="text-zinc-500">Decay risk</dt>
                  <dd><DecayBadge level={data.routeWinner.decayBucket} /></dd>
                </div>
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Simulate tab ───────────────────────────────────────────────────── */}
      {activeTab === "simulate" ? (
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          {/* Sliders */}
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="flex items-center gap-2 text-base font-bold text-zinc-100">
              <FlaskConical className="h-4 w-4 text-violet-400" />
              Condition simulator
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Move the sliders to see how temperature and humidity affect quality at arrival,
              market feasibility, and expected profit for each route.
            </p>

            <div className="mt-5 grid gap-6 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-zinc-400">Temperature</span>
                  <span className="font-mono tabular-nums text-zinc-200">{tempC.toFixed(1)} °C</span>
                </div>
                <input
                  type="range" min={5} max={50} step={0.5} value={tempC}
                  onChange={(e) => setTempC(parseFloat(e.target.value))}
                  className="slider-temp mt-2 w-full"
                />
                <div className="mt-1 flex justify-between text-xs text-zinc-600">
                  <span>5 °C</span><span>50 °C</span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-zinc-400">Relative humidity</span>
                  <span className="font-mono tabular-nums text-zinc-200">{humidity} %</span>
                </div>
                <input
                  type="range" min={20} max={100} step={1} value={humidity}
                  onChange={(e) => setHumidity(parseFloat(e.target.value))}
                  className="slider-humidity mt-2 w-full"
                />
                <div className="mt-1 flex justify-between text-xs text-zinc-600">
                  <span>20 %</span><span>100 %</span>
                </div>
              </div>
            </div>
          </section>

          {/* Simulated recommendation */}
          {simulation ? (
            <>
              <section className={`rounded-2xl border-2 p-6 ${
                simulation.winner
                  ? simWinnerChanged
                    ? "border-violet-700/60 bg-gradient-to-br from-violet-950/60 to-zinc-900"
                    : "border-emerald-700/60 bg-gradient-to-br from-emerald-950/60 to-zinc-900"
                  : "border-red-700/60 bg-gradient-to-br from-red-950/40 to-zinc-900"
              }`}>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Simulated recommendation
                  {simWinnerChanged ? (
                    <span className="ml-2 rounded-full bg-violet-900/40 px-2 py-0.5 text-violet-400 ring-1 ring-violet-700/40">
                      Changed
                    </span>
                  ) : null}
                </p>

                {simulation.winner ? (
                  <>
                    <h2 className="mt-1 text-3xl font-bold text-zinc-100">
                      {simulation.winner.marketName}
                    </h2>
                    <p className="mt-3 text-4xl font-bold tabular-nums text-emerald-400">
                      {formatInr(simulation.winner.simProfit)}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">Simulated expected profit</p>
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span className="text-zinc-500">Quality at arrival</span>
                      <QualityBar value={simulation.winner.qArr} qMin={qMin} />
                    </div>

                    {simWinnerChanged ? (
                      <p className="mt-3 rounded-lg border border-violet-700/40 bg-violet-950/30 px-3 py-2 text-sm text-violet-400">
                        Under live conditions the recommended market is{" "}
                        <strong>{data.evaluation.recommendedMarketName}</strong> — these simulated
                        conditions change the selection.
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-emerald-500">
                        Same market as live recommendation.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <h2 className="mt-1 text-xl font-bold text-red-400">No feasible market</h2>
                    <p className="mt-2 text-sm text-zinc-500">
                      At {tempC.toFixed(1)} °C / {humidity}% humidity, quality at arrival drops
                      below Q_MIN ({qMin}) for every route. The batch cannot be profitably dispatched
                      under these conditions.
                    </p>
                  </>
                )}
              </section>

              {/* Per-market impact table */}
              <section>
                <h2 className="mb-3 text-lg font-bold text-zinc-100">Market impact</h2>
                <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-800/50 text-left text-xs font-semibold uppercase text-zinc-500">
                        <th className="px-3 py-3">Market</th>
                        <th className="px-3 py-3 text-right">Q packed</th>
                        <th className="px-3 py-3">Q at arrival</th>
                        <th className="px-3 py-3 text-center">Feasible</th>
                        <th className="px-3 py-3 text-right">Sim profit</th>
                        <th className="px-3 py-3 text-right">Live profit</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {simulation.markets.map((m) => {
                        const isSimWinner  = m.marketId === simulation.winner?.marketId;
                        const isLiveWinner = m.marketId === winnerId;
                        const feasChanged  = m.simFeasible !== m.feasible;

                        return (
                          <tr
                            key={m.marketId}
                            className={`border-b border-zinc-800 ${
                              isSimWinner
                                ? simWinnerChanged
                                  ? "bg-violet-950/40"
                                  : "bg-emerald-950/40"
                                : "hover:bg-zinc-800/40"
                            }`}
                          >
                            <td className="px-3 py-2.5 font-medium text-zinc-200">
                              {m.marketName}
                              {isSimWinner ? (
                                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                                  simWinnerChanged
                                    ? "bg-violet-900/40 text-violet-400 ring-1 ring-violet-700/40"
                                    : "bg-emerald-900/40 text-emerald-400 ring-1 ring-emerald-700/40"
                                }`}>
                                  {simWinnerChanged ? "Sim winner" : "Winner"}
                                </span>
                              ) : isLiveWinner && simWinnerChanged ? (
                                <span className="ml-1.5 rounded-full bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-500 ring-1 ring-zinc-700">
                                  Live winner
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-zinc-500">
                              {q != null ? q.toFixed(3) : "—"}
                            </td>
                            <td className="px-3 py-2.5">
                              <QualityBar value={m.qArr} qMin={qMin} />
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {m.simFeasible ? (
                                <span className="font-semibold text-emerald-400">Yes</span>
                              ) : (
                                <span className="font-semibold text-red-400">No</span>
                              )}
                              {feasChanged ? (
                                <span className="ml-1 text-xs text-amber-400">
                                  {m.simFeasible ? "(↑ was No)" : "(↓ was Yes)"}
                                </span>
                              ) : null}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono ${
                              m.simFeasible ? "text-emerald-400" : "text-zinc-600"
                            }`}>
                              {m.simFeasible ? formatInr(m.simProfit) : "—"}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono ${
                              m.feasible ? "text-zinc-300" : "text-zinc-600"
                            }`}>
                              {formatInr(m.expectedProfit)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-500">
              Quality packed data not available — run the handling evaluation first.
            </div>
          )}
        </div>
      ) : null}

      {/* ── Forecast tab ───────────────────────────────────────────────────── */}
      {activeTab === "forecast" ? (
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          {forecastLoading ? (
            <div className="flex min-h-[30vh] items-center justify-center text-zinc-500">
              Loading forecast…
            </div>
          ) : forecastErr ? (
            <div className="rounded-xl border border-red-800/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">
              {forecastErr}
            </div>
          ) : !forecastData?.hasData ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-8 text-center text-sm text-zinc-500">
              No forecast data yet — run the full pipeline (including the uncertainty agent) first.
            </div>
          ) : (() => {
            const fd = forecastData;
            const mcWinner = fd.markets.find((m) => m.marketId === fd.mcRecommendedMarketId);
            const gatedMarkets = fd.markets.filter((m) => m.gated);

            // Normalise bar positions across all markets
            const allWorst  = fd.markets.map((m) => m.netProfitWorst);
            const allBest   = fd.markets.map((m) => m.netProfitBest);
            const globalMin = Math.min(...allWorst);
            const globalMax = Math.max(...allBest);
            const PAD = 6; // % padding each side so ticks don't clip
            function toBarPct(v: number): number {
              if (globalMax === globalMin) return PAD;
              return PAD + ((v - globalMin) / (globalMax - globalMin)) * (100 - PAD * 2);
            }

            return (
              <>
                {/* Winner hero */}
                {mcWinner ? (
                  <section className="rounded-2xl border-2 border-emerald-700/60 bg-gradient-to-br from-emerald-950/60 to-zinc-900 p-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-emerald-500">
                      Best market for this batch
                    </p>
                    <h2 className="mt-1 text-2xl font-bold text-zinc-100">{mcWinner.marketName}</h2>

                    <div className="mt-4 flex flex-wrap items-end gap-5">
                      <div>
                        <p className="text-4xl font-bold tabular-nums text-emerald-400">
                          {formatInr(mcWinner.netProfitLikely)}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">Most likely profit</p>
                      </div>
                      <div className="flex gap-3">
                        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-center">
                          <p className="font-mono text-base font-bold text-red-400 tabular-nums">
                            {formatInr(mcWinner.netProfitWorst)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">Worst case</p>
                        </div>
                        <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 px-4 py-2.5 text-center">
                          <p className="font-mono text-base font-bold text-emerald-400 tabular-nums">
                            {formatInr(mcWinner.netProfitBest)}
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">Best case</p>
                        </div>
                      </div>
                    </div>

                    {(() => {
                      const count = Math.round(mcWinner.recommendationStability * mcWinner.nSimulations);
                      const pct = ((count / mcWinner.nSimulations) * 100).toFixed(1).replace(/\.0$/, "");
                      return (
                        <div className="mt-5 flex items-center gap-4 rounded-xl bg-black/20 px-4 py-3">
                          <div className="flex-1">
                            <p className="text-sm font-bold text-zinc-100">
                              {mcWinner.recommendationStability >= 0.85 ? "High confidence" : mcWinner.recommendationStability >= 0.70 ? "Moderate confidence" : "Low confidence"}
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                              This market came out on top in {count.toLocaleString("en-IN")} out of {mcWinner.nSimulations.toLocaleString("en-IN")} scenarios we tested
                            </p>
                          </div>
                          <p className="font-mono text-2xl font-bold text-emerald-400 tabular-nums">
                            {pct}%
                          </p>
                        </div>
                      );
                    })()}
                  </section>
                ) : null}

                {/* Gate warning */}
                {gatedMarkets.length > 0 ? (
                  <div className="rounded-xl border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-sm leading-relaxed text-amber-400">
                    <strong>{gatedMarkets.map((m) => m.marketName).join(", ")}</strong>{" "}
                    {gatedMarkets.length === 1 ? "was" : "were"} excluded — produce arriving there had less than a 70% chance of meeting quality standards.
                    We only recommend markets where your batch is very likely to arrive in good condition.
                  </div>
                ) : null}

                {/* Market range list */}
                <section>
                  <h2 className="mb-3 text-lg font-bold text-zinc-100">Profit forecast per market</h2>
                  <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                    {/* Header */}
                    <div className="grid grid-cols-[140px_1fr_220px_100px] gap-3 border-b border-zinc-800 bg-zinc-800/50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      <div>Market</div>
                      <div>Profit range</div>
                      <div className="grid grid-cols-3 text-center">
                        <span>Worst</span>
                        <span>Likely</span>
                        <span>Best</span>
                      </div>
                      <div className="text-right">Success chance</div>
                    </div>

                    {fd.markets.map((m) => {
                      const isWinner = m.marketId === fd.mcRecommendedMarketId;
                      const worstPct  = toBarPct(m.netProfitWorst);
                      const likelyPct = toBarPct(m.netProfitLikely);
                      const bestPct   = toBarPct(m.netProfitBest);
                      const fillColor = m.gated ? "#ef4444" : isWinner ? "#10b981" : "#f59e0b";
                      const likelyColor = m.gated ? "text-zinc-500" : isWinner ? "text-emerald-400" : "text-amber-400";
                      // recommendationStability = fraction of simulations this market was #1 (mutually exclusive across markets)
                      const successCount = Math.round(m.recommendationStability * m.nSimulations);
                      const successPct = ((successCount / m.nSimulations) * 100).toFixed(1).replace(/\.0$/, "");

                      return (
                        <div
                          key={m.marketId}
                          className={`grid grid-cols-[140px_1fr_220px_100px] gap-3 border-b border-zinc-800/60 px-4 py-4 last:border-b-0 ${
                            isWinner ? "bg-emerald-950/25" : m.gated ? "opacity-45" : ""
                          }`}
                        >
                          {/* Name + badge */}
                          <div className="flex flex-col justify-center gap-1">
                            <span className={`text-sm font-semibold ${m.gated ? "text-zinc-500" : "text-zinc-200"}`}>
                              {m.marketName}
                            </span>
                            {isWinner ? (
                              <span className="inline-block w-fit rounded-full bg-emerald-900/50 px-2 py-0.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-700/40">
                                Recommended
                              </span>
                            ) : m.gated ? (
                              <span className="inline-block w-fit rounded-full bg-red-900/30 px-2 py-0.5 text-xs font-semibold text-red-400 ring-1 ring-red-800/40">
                                Too risky
                              </span>
                            ) : null}
                          </div>

                          {/* Range bar */}
                          <div className="flex items-center">
                            <div className="relative h-6 w-full">
                              {/* Track */}
                              <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-zinc-700/60" />
                              {/* Fill between worst and best */}
                              <div
                                className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
                                style={{
                                  left: `${worstPct}%`,
                                  width: `${bestPct - worstPct}%`,
                                  background: fillColor,
                                  opacity: 0.3,
                                }}
                              />
                              {/* Worst tick */}
                              <div
                                className="absolute top-1/2 w-0.5 -translate-y-1/2 rounded-sm"
                                style={{ left: `${worstPct}%`, height: "12px", marginTop: "-6px", background: "#f87171", opacity: 0.8 }}
                              />
                              {/* Likely tick (wider) */}
                              <div
                                className="absolute top-1/2 w-1 -translate-y-1/2 rounded-sm"
                                style={{ left: `${likelyPct}%`, height: "18px", marginTop: "-9px", background: fillColor }}
                              />
                              {/* Best tick */}
                              <div
                                className="absolute top-1/2 w-0.5 -translate-y-1/2 rounded-sm"
                                style={{ left: `${bestPct}%`, height: "12px", marginTop: "-6px", background: "#34d399", opacity: 0.8 }}
                              />
                            </div>
                          </div>

                          {/* Worst / Likely / Best trio */}
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { v: m.netProfitWorst,  label: "Worst", color: "text-red-400" },
                              { v: m.netProfitLikely, label: "Likely", color: likelyColor },
                              { v: m.netProfitBest,   label: "Best",  color: m.gated ? "text-zinc-500" : "text-zinc-300" },
                            ].map(({ v, label, color }) => (
                              <div key={label} className="rounded-lg bg-zinc-800/60 px-2 py-2 text-center">
                                <p className={`font-mono text-xs font-bold tabular-nums ${color}`}>
                                  {formatInr(v)}
                                </p>
                                <p className="mt-0.5 text-xs text-zinc-600">{label}</p>
                              </div>
                            ))}
                          </div>

                          {/* Success chance */}
                          <div className="flex flex-col items-end justify-center gap-0.5">
                            <span
                              className={`font-mono text-lg font-bold tabular-nums ${
                                m.gated ? "text-red-400" : m.recommendationStability >= 0.85 ? "text-emerald-400" : m.recommendationStability >= 0.70 ? "text-amber-400" : "text-red-400"
                              }`}
                            >
                              {successPct}%
                            </span>
                            <span className="text-xs text-zinc-600">Success chance</span>
                          </div>
                        </div>
                      );
                    })}
                    {/* Remainder: simulations where no market was feasible */}
                    {(() => {
                      const assignedStability = fd.markets.reduce((a, m) => a + m.recommendationStability, 0);
                      const noMarketFrac = Math.max(0, 1 - assignedStability);
                      const noMarketPct = (noMarketFrac * 100).toFixed(1).replace(/\.0$/, "");
                      if (noMarketFrac < 0.0005) return null;
                      return (
                        <div className="grid grid-cols-[140px_1fr_220px_100px] gap-3 border-t border-zinc-800/60 bg-zinc-900/60 px-4 py-3">
                          <div className="col-span-3 flex items-center">
                            <span className="text-xs text-zinc-500">No feasible market — produce below quality threshold in these scenarios</span>
                          </div>
                          <div className="flex flex-col items-end justify-center gap-0.5">
                            <span className="font-mono text-lg font-bold tabular-nums text-zinc-500">{noMarketPct}%</span>
                            <span className="text-xs text-zinc-600">No winner</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </section>


              </>
            );
          })()}
        </div>
      ) : null}

      {/* ── Bottom action bar ──────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-800 bg-zinc-900/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {!data.edge.dispatched ? (
              canDispatch ? (
                <button
                  type="button"
                  onClick={() => { setDispatchErr(null); setConfirmDispatch(true); }}
                  disabled={busy}
                  className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  Confirm recommendation: {wc.marketName}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title={
                    q != null && q < qMin
                      ? "Batch below minimum quality threshold"
                      : data.batch.status !== "Evaluated"
                        ? "Batch must be Evaluated before dispatching"
                        : "Cannot dispatch"
                  }
                  className="cursor-not-allowed rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-bold text-zinc-500"
                >
                  Dispatch disabled
                </button>
              )
            ) : null}
            <Link
              href="/batches"
              className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-700"
            >
              Back to overview
            </Link>
            {userRole === "admin" ? (
              <Link
                href={`/batches/${recordId}/audit`}
                className="inline-flex items-center self-center text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-300"
              >
                Full audit
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Dispatch confirmation modal ────────────────────────────────────── */}
      {confirmDispatch ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <p className="font-semibold text-zinc-100">Confirm recommendation</p>
            <p className="mt-2 text-sm text-zinc-400">
              Record <strong className="text-zinc-200">{wc.marketName}</strong> as the recommended dispatch destination for batch{" "}
              <strong className="text-zinc-200">{data.batch.batchId}</strong>? This cannot be undone.
            </p>
            {dispatchErr ? (
              <p className="mt-3 rounded-lg border border-red-800/40 bg-red-950/30 px-3 py-2 text-sm text-red-400">
                {dispatchErr}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDispatch(false)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void dispatch()}
                disabled={busy}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {busy ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
