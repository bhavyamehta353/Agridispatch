"use client";

import dynamic from "next/dynamic";
import { MapPinned, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

const RecommendedRouteMap = dynamic(() => import("./recommended-route-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(16rem,38vh,24rem)] w-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-100 text-sm text-zinc-500 sm:h-[clamp(18rem,42vh,28rem)]">
      Loading route map...
    </div>
  ),
});

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
  grossRevenue: number | null;
  commissionAmount: number | null;
  netRevenue: number | null;
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

function formatInr(n: number | null): string {
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
    tier === "good"
      ? "bg-emerald-500"
      : tier === "mid"
        ? "bg-amber-500"
        : tier === "bad"
          ? "bg-red-500"
          : "bg-zinc-400";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${cls}`}
      title="Quality packed"
    />
  );
}

function DecayBadge({ level }: { level: string }) {
  const cls =
    level === "Low"
      ? "bg-emerald-100 text-emerald-900"
      : level === "Medium"
        ? "bg-amber-100 text-amber-900"
        : "bg-red-100 text-red-900";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {level}
    </span>
  );
}

async function loadRecommendation(recordId: string): Promise<RecPayload> {
  const res = await fetch(`/api/batches/${recordId}/recommendation`);
  const json = (await res.json()) as RecPayload;
  if (!res.ok) {
    throw new Error(json.error ?? "Failed to load");
  }
  return json;
}

export function RecommendationClient({ recordId }: { recordId: string }) {
  const [data, setData] = useState<RecPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDispatch, setConfirmDispatch] = useState(false);
  const [busy, setBusy] = useState(false);

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
        if (!cancelled) {
          setData(next);
        }
      } catch (error) {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Network error");
          setData(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
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
      if (!res.ok) {
        alert(j.error ?? "Dispatch failed");
        return;
      }
      setConfirmDispatch(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rerunEval() {
    setBusy(true);
    try {
      const res = await fetch(`/api/batches/${recordId}/evaluate`, {
        method: "POST",
      });
      const j = (await res.json()) as { message?: string };
      alert(j.message ?? (res.ok ? "OK" : "Not available"));
    } finally {
      setBusy(false);
    }
  }

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

  const q = data.handling.qualityPacked;
  const qMin = data.qMin;
  const canDispatch =
    data.batch.status === "Evaluated" &&
    q != null &&
    q >= qMin &&
    !data.edge.dispatched;
  const winnerId = data.evaluation.winnerMarketId;

  if (!data.evaluation.hasEvaluation) {
    return (
      <div className="pb-28">
        <div className="border-b border-zinc-200 bg-white px-4 py-4 shadow-sm sm:px-6">
          <p className="text-xs uppercase text-zinc-500">Batch</p>
          <p className="font-mono font-semibold text-zinc-900">
            {data.batch.batchId}
          </p>
        </div>
        <div className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-lg font-semibold text-zinc-900">
            No evaluation yet for this batch.
          </p>
          <p className="mt-2 text-sm text-zinc-600">
            Run the evaluation pipeline to compare markets and see a recommended
            dispatch.
          </p>
          <button
            type="button"
            onClick={() => rerunEval()}
            disabled={busy}
            className="mt-6 rounded-xl bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Re-run Evaluation
          </button>
          <Link
            href="/batches"
            className="mt-4 block text-sm text-sky-700 underline"
          >
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  const wc = data.winnerCard;
  const secondName =
    [...data.markets]
      .filter((m) => m.marketId !== winnerId)
      .sort((a, b) => (b.expectedProfit ?? -1e9) - (a.expectedProfit ?? -1e9))[0]
      ?.marketName ?? "next best";
  const routeMapReady =
    data.routeWinner?.farmLat != null &&
    data.routeWinner.farmLng != null &&
    data.routeWinner.marketLat != null &&
    data.routeWinner.marketLng != null;

  return (
    <div className="pb-32">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 text-sm">
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
            <span className="font-mono tabular-nums">
              {q != null ? q.toFixed(2) : "—"}
            </span>
          </div>
          <div className="text-xs text-zinc-600">
            Eval:{" "}
            {data.evaluation.evaluationTime
              ? formatHarvest(data.evaluation.evaluationTime)
              : "—"}
          </div>
          <div className="flex items-center gap-1 text-xs text-zinc-600">
            <span>Prices: {data.headerMeta.pricingActiveDay ?? "—"}</span>
            {data.headerMeta.pricingStale ? (
              <span className="text-amber-700" title="Not today's date in Asia/Kolkata">
                stale
              </span>
            ) : null}
          </div>
        </div>
      </header>

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
          <h1 className="mt-1 text-3xl font-bold text-zinc-900">
            {wc.marketName}
          </h1>
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
                {wc.effectiveTravelHr != null
                  ? `${wc.effectiveTravelHr.toFixed(2)} hr`
                  : "—"}
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
          <h2 className="mb-3 text-lg font-bold text-zinc-900">
            Market comparison
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50">
                  <th className="px-3 py-3 text-left text-xs font-semibold uppercase text-zinc-500">
                    Metric
                  </th>
                  {data.markets.map((m) => {
                    const win = m.marketId === winnerId;
                    const muted = !m.feasible;
                    return (
                      <th
                        key={m.marketId}
                        className={`px-3 py-3 text-right ${
                          win
                            ? "bg-emerald-100/90 ring-2 ring-inset ring-emerald-500"
                            : ""
                        } ${muted ? "opacity-60" : ""}`}
                      >
                        <div className="font-semibold text-zinc-900">
                          {m.marketName}
                        </div>
                        {win ? (
                          <div className="mt-1 text-xs font-normal text-emerald-800">
                            Recommended
                          </div>
                        ) : null}
                        {muted ? (
                          <div className="mt-1 text-xs text-red-700">
                            Not feasible
                          </div>
                        ) : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {(
                  [
                    {
                      label: "Modal (₹/kg)",
                      fn: (m: MarketCol) => (
                        <span className="inline-flex items-center gap-1">
                          {m.modalPrice ?? "—"}
                          {m.priceStale ? (
                            <span className="text-amber-600" title="Stale price">
                              !
                            </span>
                          ) : null}
                        </span>
                      ),
                    },
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
                      label: "Commission (₹)",
                      fn: (m: MarketCol) => formatInr(m.commissionAmount),
                    },
                    {
                      label: "Gross revenue (₹)",
                      fn: (m: MarketCol) => formatInr(m.grossRevenue),
                    },
                    {
                      label: "Net revenue (₹)",
                      fn: (m: MarketCol) => formatInr(m.netRevenue),
                    },
                    {
                      label: "Expected profit (₹)",
                      fn: (m: MarketCol) => (
                        <strong>{formatInr(m.expectedProfit)}</strong>
                      ),
                    },
                    {
                      label: "Distance (km)",
                      fn: (m: MarketCol) => m.distanceKm,
                    },
                    {
                      label: "Est. travel (hr)",
                      fn: (m: MarketCol) => m.effectiveTravelHr.toFixed(2),
                    },
                    {
                      label: "Decay risk",
                      fn: (m: MarketCol) => <DecayBadge level={m.decayRisk} />,
                    },
                    {
                      label: "Feasible",
                      fn: (m: MarketCol) => (m.feasible ? "Yes" : "No"),
                    },
                  ] as const
                ).map((row) => (
                  <tr
                    key={row.label}
                    className="border-b border-zinc-100 hover:bg-zinc-50/80"
                  >
                    <td className="px-3 py-2 font-medium text-zinc-600">
                      {row.label}
                    </td>
                    {data.markets.map((m) => {
                      const win = m.marketId === winnerId;
                      const muted = !m.feasible;
                      return (
                        <td
                          key={m.marketId}
                          className={`px-3 py-2 text-right ${
                            win ? "bg-emerald-50/50" : ""
                          } ${muted ? "text-zinc-400" : "text-zinc-900"}`}
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
                  {routeMapReady ? (
                    <RecommendedRouteMap
                      farm={{
                        id: data.batch.farmOriginId ?? data.batch.recordId,
                        name: data.routeWinner.farmName,
                        lat: data.routeWinner.farmLat,
                        lng: data.routeWinner.farmLng,
                      }}
                      market={{
                        id: winnerId ?? data.routeWinner.marketName,
                        name: data.routeWinner.marketName,
                        lat: data.routeWinner.marketLat,
                        lng: data.routeWinner.marketLng,
                      }}
                    />
                  ) : (
                    <div className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                      Route map unavailable because this route is missing farm or
                      market coordinates.
                    </div>
                  )}
                  <p className="text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      <MapPinned className="h-3.5 w-3.5" />
                      Chosen path for this batch: {data.routeWinner.farmName} →{" "}
                      {data.routeWinner.marketName}
                    </span>
                  </p>
                </div>
                <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">Route</dt>
                    <dd>
                      {data.routeWinner.farmName} → {data.routeWinner.marketName}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">Distance</dt>
                    <dd className="font-mono">{data.routeWinner.distanceKm} km</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">Base travel (hr)</dt>
                    <dd className="font-mono">{data.routeWinner.tBaseHr}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">Delay τ</dt>
                    <dd className="font-mono">{data.routeWinner.tau}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">Effective travel (hr)</dt>
                    <dd className="font-mono">
                      {data.routeWinner.effectiveTravelHr.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">Temperature (°C)</dt>
                    <dd className="font-mono">{data.routeWinner.temperatureC ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">
                      <span
                        title="High humidity increases fungal decay risk along this route."
                        className="cursor-help border-b border-dotted border-zinc-400"
                      >
                        Humidity (%)
                      </span>
                    </dt>
                    <dd
                      className="font-mono"
                      title="High humidity increases fungal decay risk along this route."
                    >
                      {data.routeWinner.humidityPct ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                    <dt className="text-zinc-500">Decay risk</dt>
                    <dd>
                      <DecayBadge level={data.routeWinner.decayBucket} />
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

        <section className="rounded-xl border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-4 py-3 font-semibold text-zinc-900">
            Decision factors breakdown
          </div>
          <div className="space-y-6 px-4 py-4 text-sm">
            <div>
              <h3 className="font-bold text-zinc-800">Quality &amp; handling</h3>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">Initial quality</dt>
                  <dd className="font-mono">{data.formula.qualityInitial ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">Damage factor</dt>
                  <dd className="font-mono">{data.handling.damageFactor}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">Sorting bonus</dt>
                  <dd className="font-mono">{data.handling.sortingBonus}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">Packed quality</dt>
                  <dd className="font-mono">{data.handling.qualityPacked ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">k_multiplier</dt>
                  <dd className="font-mono">{data.handling.kMultiplier}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">Packaging</dt>
                  <dd>{data.handling.packagingType ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-2 border-b border-zinc-100 py-1">
                  <dt className="text-zinc-500">Fill level</dt>
                  <dd>{data.handling.fillLevel ?? "—"}</dd>
                </div>
              </dl>
              {data.formula.qualityInitial != null ? (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">
                  {`quality_packed = ${data.formula.qualityInitial} × (1 − 0.6 × ${data.formula.damageFactor}) × (1 + 0.2 × ${data.formula.sortingBonus})\n             = ${data.formula.result != null ? data.formula.result.toFixed(4) : "—"}`}
                </pre>
              ) : null}
            </div>

            
          </div>
        </section>
      </div>

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
            <button
              type="button"
              onClick={() => rerunEval()}
              disabled={busy}
              className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              Re-run Evaluation
            </button>
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
                onClick={() => dispatch()}
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
