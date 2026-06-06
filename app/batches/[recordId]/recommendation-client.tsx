"use client";

import dynamic from "next/dynamic";
import { FlaskConical, MapPinned, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UserRole } from "../../lib/auth";

const RecommendedRouteMap = dynamic(() => import("./recommended-route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(16rem,38vh,24rem)] w-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-100 text-sm text-zinc-500 sm:h-[clamp(18rem,42vh,28rem)]">
      Loading route map...
    </div>
  ),
});

// ── Types ────────────────────────────────────────────────────────────────────
type MarketCol = {
  marketId: string;
  marketName: string;
  marketLat: number | null;
  marketLng: number | null;
  modalPrice: number | null;
  priceArrivalDay: string | null;
  priceStale: boolean;
  distanceKm: number;
  tBaseHr: number;
  tau: number;
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
    level === "Low" ? "bg-emerald-100 text-emerald-900"
    : level === "Medium" ? "bg-amber-100 text-amber-900"
    : "bg-red-100 text-red-900";
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
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs tabular-nums ${
        value >= 0.85 ? "text-emerald-700"
        : value >= qMin ? "text-amber-700"
        : "text-red-600"
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
  void userRole; // available for future role-gating

  const [data, setData] = useState<RecPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDispatch, setConfirmDispatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<"recommendation" | "simulate">("recommendation");

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
      if (!res.ok) { alert(j.error ?? "Dispatch failed"); return; }
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

    const markets = data.markets.map((m) => {
      const qArr       = computeQualityArrival(data.handling.qualityPacked!, ke, m.effectiveTravelHr);
      const simFeasible = qArr >= data.qMin;
      // net_profit = gross × (1 − MARKET_FEE_PCT − COMMISSION_PCT) − logistics_cost
      // math_models.py §6: MARKET_FEE_PCT=0.01, COMMISSION_PCT=0.025
      const simProfit  = simFeasible && m.modalPrice != null
        ? Math.round(m.modalPrice * data.batch.weightKg * (1 - MARKET_FEE_PCT - COMMISSION_PCT) - m.logisticsCost)
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
        <p className="text-red-700">{err ?? "Unknown error"}</p>
        <Link href="/batches" className="mt-4 inline-block text-sky-700 underline">
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
        <div className="border-b border-zinc-200 bg-white px-4 py-4 shadow-sm sm:px-6">
          <p className="text-xs uppercase text-zinc-500">Batch</p>
          <p className="font-mono font-semibold text-zinc-900">{data.batch.batchId}</p>
        </div>
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-lg font-semibold text-zinc-900">No evaluation yet for this batch.</p>
          <p className="mt-2 text-sm text-zinc-600">
            Run the evaluation pipeline to compare markets and see a recommended dispatch.
          </p>
          <Link href="/batches" className="mt-4 block text-sm text-sky-700 underline">
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
    simulation?.winner != null &&
    simulation.winner.marketId !== winnerId;

  return (
    <div className="pb-32">
      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <div>
            <span className="text-zinc-500">Batch</span>{" "}
            <span className="font-mono font-semibold">{data.batch.batchId}</span>
          </div>
          <div>
            <span className="text-zinc-500">Farm</span>{" "}
            <span className="font-medium">{data.batch.farmName}</span>
          </div>
          <div>
            <span className="text-zinc-500">Harvest</span>{" "}
            {formatHarvest(data.batch.harvestTime)}
          </div>
          <div>
            <span className="text-zinc-500">Weight</span>{" "}
            <span className="font-mono">{data.batch.weightKg} kg</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Quality</span>
            <QualityDot tier={data.handling.qualityTier} />
            <span className="font-mono tabular-nums">{q != null ? q.toFixed(2) : "—"}</span>
          </div>
          <div className="text-xs text-zinc-600">
            Eval:{" "}
            {data.evaluation.evaluationTime ? formatHarvest(data.evaluation.evaluationTime) : "—"}
          </div>
          <div className="flex items-center gap-1 text-xs text-zinc-600">
            <span>Prices: {data.headerMeta.pricingActiveDay ?? "—"}</span>
            {data.headerMeta.pricingStale ? (
              <span className="text-amber-700" title="Not today's date in Asia/Kolkata">stale</span>
            ) : null}
          </div>

          {/* Tab toggle — top-right */}
          <div className="ml-auto flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab("recommendation")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === "recommendation"
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              Recommendation
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("simulate")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === "simulate"
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              <FlaskConical className="h-3 w-3" />
              Simulate
            </button>
          </div>
        </div>
      </header>

      {/* ── Recommendation tab ─────────────────────────────────────────────── */}
      {activeTab === "recommendation" ? (
        <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
          {data.edge.allInfeasible ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              No feasible market — quality below Q_MIN ({qMin}) for all routes.
            </div>
          ) : null}

          {data.edge.dispatched ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              Dispatched to <strong>{wc.marketName}</strong>. Status is read-only.
            </div>
          ) : null}

          <section className="rounded-2xl border-2 border-emerald-600 bg-gradient-to-br from-emerald-50 to-white p-6 shadow-md">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
              Recommended dispatch
            </p>
            <h1 className="mt-1 text-3xl font-bold text-zinc-900">{wc.marketName}</h1>
            <p className="mt-3 text-4xl font-bold text-emerald-800 tabular-nums">
              {formatInr(wc.expectedProfit)}
            </p>
            <p className="mt-1 text-sm text-zinc-600">Expected profit</p>

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-zinc-700">
              <div>
                <span className="text-zinc-500">Modal price</span>{" "}
                <span className="font-mono font-semibold">
                  {wc.modalPrice != null ? `₹${wc.modalPrice}/kg` : "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Distance</span>{" "}
                <span className="font-mono">
                  {wc.distanceKm != null ? `${wc.distanceKm} km` : "—"}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Est. travel</span>{" "}
                <span className="font-mono">
                  {wc.effectiveTravelHr != null ? `${wc.effectiveTravelHr.toFixed(2)} hr` : "—"}
                </span>
              </div>
            </div>

            {wc.marginOverNext != null && wc.marginOverNext > 0 ? (
              <p className="mt-4 text-sm font-medium text-zinc-800">
                {formatInr(wc.marginOverNext)} ahead of {secondName}
              </p>
            ) : null}

            {wc.closeCall ? (
              <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
                Close call — verify current prices before dispatching.
              </p>
            ) : null}

            <div className="mt-4">
              {wc.feasible ? (
                <span className="inline-flex rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold text-white">
                  Feasible
                </span>
              ) : (
                <span className="inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
                  Below threshold
                </span>
              )}
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-bold text-zinc-900">Market comparison</h2>
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 bg-zinc-50">
                    <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-zinc-500">
                      Metric
                    </th>
                    {data.markets.map((m) => {
                      const win  = m.marketId === winnerId;
                      const muted = !m.feasible;
                      return (
                        <th
                          key={m.marketId}
                          className={`px-3 py-3 text-right ${
                            win ? "bg-emerald-100/90 ring-2 ring-inset ring-emerald-500" : ""
                          } ${muted ? "opacity-60" : ""}`}
                        >
                          <div className="font-semibold text-zinc-900">{m.marketName}</div>
                          {win  ? <div className="mt-1 text-xs font-normal text-emerald-800">Recommended</div> : null}
                          {muted ? <div className="mt-1 text-xs text-red-700">Not feasible</div> : null}
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
                            title={`₹12×${m.logisticsBreakdown.distanceKm} + ₹150×${m.logisticsBreakdown.tBaseHr}×(1+1.5×${m.logisticsBreakdown.tau}) + ₹500 = ₹${m.logisticsCost.toFixed(2)}`}
                            className="cursor-help border-b border-dotted border-zinc-400"
                          >
                            {formatInr(m.logisticsCost)}
                          </span>
                        ),
                      },
                      {
                        label: "Expected profit (₹)",
                        fn: (m: MarketCol) => <strong>{formatInr(m.expectedProfit)}</strong>,
                      },
                      { label: "Distance (km)",    fn: (m: MarketCol) => m.distanceKm },
                      { label: "Est. travel (hr)", fn: (m: MarketCol) => m.effectiveTravelHr.toFixed(2) },
                      { label: "Decay risk",        fn: (m: MarketCol) => <DecayBadge level={m.decayRisk} /> },
                      { label: "Feasible",          fn: (m: MarketCol) => (m.feasible ? "Yes" : "No") },
                    ] as const
                  ).map((row) => (
                    <tr key={row.label} className="border-b border-zinc-100 hover:bg-zinc-50/80">
                      <td className="px-3 py-2 font-medium text-zinc-600">{row.label}</td>
                      {data.markets.map((m) => {
                        const win  = m.marketId === winnerId;
                        const muted = !m.feasible;
                        return (
                          <td
                            key={m.marketId}
                            className={`px-3 py-2 text-right ${win ? "bg-emerald-50/50" : ""} ${
                              muted ? "text-zinc-400" : "text-zinc-900"
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
                <h3 className="flex items-center gap-2 font-bold text-zinc-800">
                  <Truck className="h-4.5 w-4.5 text-emerald-700" />
                  Route &amp; risk (winning market)
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900 ring-1 ring-emerald-200">
                    <span className="h-2.5 w-2.5 rounded-full border border-emerald-900/30 bg-emerald-500" />
                    Farm
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-900 ring-1 ring-blue-200">
                    <span className="h-2.5 w-2.5 rounded-full border border-blue-900/30 bg-blue-400" />
                    Market
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-zinc-50 px-2.5 py-1 font-medium text-zinc-700 ring-1 ring-zinc-200">
                    <Truck className="h-3.5 w-3.5 text-emerald-700" />
                    Selected route
                  </span>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {routeMapPoints ? (
                  <RecommendedRouteMap farm={routeMapPoints.farm} market={routeMapPoints.market} />
                ) : (
                  <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                    Route map unavailable — missing farm or market coordinates.
                  </div>
                )}
                <p className="text-xs text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <MapPinned className="h-3.5 w-3.5" />
                    Chosen path: {data.routeWinner.farmName} → {data.routeWinner.marketName}
                  </span>
                </p>
              </div>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                {[
                  ["Route",                `${data.routeWinner.farmName} → ${data.routeWinner.marketName}`],
                  ["Distance",             `${data.routeWinner.distanceKm} km`],
                  ["Base travel (hr)",     String(data.routeWinner.tBaseHr)],
                  ["Delay τ",              String(data.routeWinner.tau)],
                  ["Effective travel (hr)", data.routeWinner.effectiveTravelHr.toFixed(2)],
                  ["Temperature (°C)",     data.routeWinner.temperatureC ?? "—"],
                  ["Humidity (%)",         data.routeWinner.humidityPct ?? "—"],
                ].map(([label, val]) => (
                  <div key={String(label)} className="flex justify-between gap-2 border-b border-zinc-100 py-1 text-sm">
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="font-mono">{String(val)}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1 text-sm">
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
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-bold text-zinc-900">
              <FlaskConical className="h-4 w-4 text-violet-600" />
              Condition simulator
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Move the sliders to see how temperature and humidity affect quality at arrival,
              market feasibility, and expected profit for each route.
            </p>

            <div className="mt-5 grid gap-6 sm:grid-cols-2">
              {/* Temperature */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-zinc-700">Temperature</span>
                  <span className="font-mono tabular-nums text-zinc-900">{tempC.toFixed(1)} °C</span>
                </div>
                <input
                  type="range" min={5} max={50} step={0.5} value={tempC}
                  onChange={(e) => setTempC(parseFloat(e.target.value))}
                  className="mt-2 w-full accent-violet-600"
                />
                <div className="mt-1 flex justify-between text-xs text-zinc-400">
                  <span>5 °C</span><span>50 °C</span>
                </div>
              </div>

              {/* Humidity */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-zinc-700">Relative humidity</span>
                  <span className="font-mono tabular-nums text-zinc-900">{humidity} %</span>
                </div>
                <input
                  type="range" min={20} max={100} step={1} value={humidity}
                  onChange={(e) => setHumidity(parseFloat(e.target.value))}
                  className="mt-2 w-full accent-violet-600"
                />
                <div className="mt-1 flex justify-between text-xs text-zinc-400">
                  <span>20 %</span><span>100 %</span>
                </div>
              </div>
            </div>

            {/* Derived decay params */}
            {simulation ? (
              <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs text-zinc-500">VPD</p>
                  <p className="font-mono tabular-nums">{simulation.vpd.toFixed(3)} kPa</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">k_base</p>
                  <p className="font-mono tabular-nums">{simulation.kb.toFixed(5)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">k_eff</p>
                  <p className="font-mono tabular-nums">{simulation.ke.toFixed(5)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Season ({simulation.month})</p>
                  <p className="font-mono tabular-nums">
                    {(SEASONAL_FACTOR[simulation.month] ?? 1.0).toFixed(4)}
                  </p>
                </div>
              </div>
            ) : null}

            <p className="mt-3 text-xs text-zinc-400">
              k_base = K_REF({K_REF}) × S_month × exp(β({BETA_TEMP}) × (T − T_ref({T_REF}))) × (1 + δ_h·H) × (1 + δ_v·VPD)
              &nbsp;·&nbsp;
              Maturity: {data.handling.maturityGrade} (×{MATURITY_DECAY[data.handling.maturityGrade] ?? 1.0})
              &nbsp;·&nbsp;
              k_mult: {data.handling.kMultiplier.toFixed(3)}
              &nbsp;·&nbsp;
              Q_MIN = {qMin}
            </p>
          </section>

          {/* Simulated recommendation */}
          {simulation ? (
            <>
              <section className={`rounded-2xl border-2 p-6 shadow-md ${
                simulation.winner
                  ? simWinnerChanged
                    ? "border-violet-500 bg-gradient-to-br from-violet-50 to-white"
                    : "border-emerald-600 bg-gradient-to-br from-emerald-50 to-white"
                  : "border-red-400 bg-gradient-to-br from-red-50 to-white"
              }`}>
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Simulated recommendation
                  {simWinnerChanged ? (
                    <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-violet-800">
                      Changed
                    </span>
                  ) : null}
                </p>

                {simulation.winner ? (
                  <>
                    <h2 className="mt-1 text-3xl font-bold text-zinc-900">
                      {simulation.winner.marketName}
                    </h2>
                    <p className="mt-3 text-4xl font-bold tabular-nums text-zinc-900">
                      {formatInr(simulation.winner.simProfit)}
                    </p>
                    <p className="mt-1 text-sm text-zinc-600">Simulated expected profit</p>
                    <div className="mt-3 flex items-center gap-2 text-sm">
                      <span className="text-zinc-500">Quality at arrival</span>
                      <QualityBar value={simulation.winner.qArr} qMin={qMin} />
                      <span className="text-xs text-zinc-400">
                        (Q_MIN = {qMin})
                      </span>
                    </div>

                    {simWinnerChanged ? (
                      <p className="mt-3 rounded-lg bg-violet-100 px-3 py-2 text-sm text-violet-900">
                        Under live conditions the recommended market is{" "}
                        <strong>{data.evaluation.recommendedMarketName}</strong> — these simulated
                        conditions change the selection.
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-emerald-800">
                        Same market as live recommendation.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <h2 className="mt-1 text-xl font-bold text-red-800">No feasible market</h2>
                    <p className="mt-2 text-sm text-zinc-600">
                      At {tempC.toFixed(1)} °C / {humidity}% humidity, quality at arrival drops
                      below Q_MIN ({qMin}) for every route. The batch cannot be profitably dispatched
                      under these conditions.
                    </p>
                  </>
                )}
              </section>

              {/* Per-market impact table */}
              <section>
                <h2 className="mb-3 text-lg font-bold text-zinc-900">Market impact</h2>
                <p className="mb-3 text-xs text-zinc-500">
                  Profit = modal_price × weight × (1 − {(MARKET_FEE_PCT * 100).toFixed(0)}% market fee − {(COMMISSION_PCT * 100).toFixed(1)}% commission) − logistics cost
                </p>
                <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-semibold uppercase text-zinc-500">
                        <th className="px-3 py-3">Market</th>
                        <th className="px-3 py-3 text-right">Q packed</th>
                        <th className="px-3 py-3">Q at arrival</th>
                        <th className="px-3 py-3 text-center">Feasible</th>
                        <th className="px-3 py-3 text-right">Sim profit</th>
                        <th className="px-3 py-3 text-right">Live profit</th>
                        <th className="px-3 py-3 text-center">Status</th>
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
                            className={`border-b border-zinc-100 ${
                              isSimWinner
                                ? simWinnerChanged
                                  ? "bg-violet-50/60"
                                  : "bg-emerald-50/60"
                                : "hover:bg-zinc-50/60"
                            }`}
                          >
                            <td className="px-3 py-2.5 font-medium text-zinc-900">
                              {m.marketName}
                              {isSimWinner ? (
                                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                                  simWinnerChanged ? "bg-violet-100 text-violet-800" : "bg-emerald-100 text-emerald-800"
                                }`}>
                                  {simWinnerChanged ? "Sim winner" : "Winner"}
                                </span>
                              ) : isLiveWinner && simWinnerChanged ? (
                                <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
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
                                <span className="font-semibold text-emerald-700">Yes</span>
                              ) : (
                                <span className="font-semibold text-red-600">No</span>
                              )}
                              {feasChanged ? (
                                <span className="ml-1 text-xs text-amber-600">
                                  {m.simFeasible ? "(↑ was No)" : "(↓ was Yes)"}
                                </span>
                              ) : null}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono ${
                              m.simFeasible ? "text-zinc-900" : "text-zinc-400"
                            }`}>
                              {m.simFeasible ? formatInr(m.simProfit) : "—"}
                            </td>
                            <td className={`px-3 py-2.5 text-right font-mono ${
                              m.feasible ? "text-zinc-900" : "text-zinc-400"
                            }`}>
                              {formatInr(m.expectedProfit)}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {feasChanged ? (
                                <DecayBadge level={m.simFeasible ? "Low" : "High"} />
                              ) : (
                                <span className="text-xs text-zinc-400">—</span>
                              )}
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
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
              Quality packed data not available — run the handling evaluation first.
            </div>
          )}
        </div>
      ) : null}

      {/* ── Bottom action bar ──────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {!data.edge.dispatched ? (
              canDispatch ? (
                <button
                  type="button"
                  onClick={() => setConfirmDispatch(true)}
                  disabled={busy}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Dispatch to {wc.marketName}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title={
                    q != null && q < qMin
                      ? "Batch below minimum quality threshold"
                      : data.batch.status !== "Evaluated"
                        ? "Mark batch as Evaluated in Airtable first"
                        : "Cannot dispatch"
                  }
                  className="cursor-not-allowed rounded-xl bg-zinc-300 px-4 py-2.5 text-sm font-bold text-zinc-600"
                >
                  Dispatch disabled
                </button>
              )
            ) : null}
            <Link
              href="/batches"
              className="inline-flex items-center rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            >
              Back to overview
            </Link>
            <Link
              href={`/batches/${recordId}/audit`}
              className="inline-flex items-center self-center text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-700"
            >
              Full audit
            </Link>
          </div>
        </div>
      </div>

      {/* ── Dispatch confirmation modal ────────────────────────────────────── */}
      {confirmDispatch ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <p className="font-semibold text-zinc-900">Confirm dispatch</p>
            <p className="mt-2 text-sm text-zinc-600">
              Confirm dispatch of <strong>{data.batch.batchId}</strong> to{" "}
              <strong>{wc.marketName}</strong>? This cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDispatch(false)}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void dispatch()}
                disabled={busy}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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
