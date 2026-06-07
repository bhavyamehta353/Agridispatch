"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Info,
  RefreshCw,
  Route,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  drawerInterpretation,
  type CombinedRouteHealth,
} from "../lib/route-conditions-health";
import { AgriDispatchLogo } from "../components/agri-dispatch-logo";

const RouteConditionsMap = dynamic(() => import("./route-conditions-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(18rem,45vh,32rem)] w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900 text-sm text-zinc-500 sm:h-[clamp(22rem,50vh,36rem)]">
      Loading map…
    </div>
  ),
});

type Congestion = "low" | "moderate" | "high" | "unknown";
type Decay = "low" | "moderate" | "high" | "unknown";

type Reliability = "consistent" | "variable" | "unpredictable" | "insufficient_data";

type RouteRow = {
  routeRecordId: string;
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
  congestion: Congestion;
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
  decayLevel: Decay;
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

type FarmGroup = {
  farmOriginId: string;
  farmName: string;
  routes: RouteRow[];
};

type HistoryRow = {
  batchRecordId: string;
  batchId: string;
  farmName: string;
  farmOriginId: string | null;
  harvestTime: string | null;
  harvestTimeDisplay: string;
  status: string;
  recommendedMarket: string | null;
  congestion: Congestion;
  decayLevel: Decay;
  tau: number | null;
  temperatureC: number | null;
  humidityPct: number | null;
  qualityPacked: number | null;
  logisticsCost: number | null;
};

type OverviewPayload = {
  timeZone: string;
  qMin: number;
  lastRunIso: string | null;
  lastRunDisplay: string | null;
  summary: {
    traffic: { low: number; moderate: number; high: number };
    environment: { low: number; moderate: number; high: number };
    worstRoute: string | null;
    allRoutesClear: boolean;
    noTrafficRecords: boolean;
    noEnvRecords: boolean;
  };
  map: {
    farms: { id: string; name: string; lat: number; lng: number }[];
    markets: {
      id: string;
      name: string;
      lat: number;
      lng: number;
      location: string;
    }[];
  };
  farms: FarmGroup[];
  history: HistoryRow[];
  error?: string;
};

function formatHours(h: number): string {
  if (!Number.isFinite(h)) return "—";
  if (h < 10) return `${h.toFixed(2)} hr`;
  return `${h.toFixed(1)} hr`;
}

function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function levelLabel(c: Congestion | Decay): string {
  if (c === "low") return "Low";
  if (c === "moderate") return "Moderate";
  if (c === "high") return "High";
  return "No data";
}

const EMPTY_PAYLOAD: OverviewPayload = {
  timeZone: "Asia/Kolkata",
  qMin: 0.60,
  lastRunIso: null,
  lastRunDisplay: null,
  summary: {
    traffic: { low: 0, moderate: 0, high: 0 },
    environment: { low: 0, moderate: 0, high: 0 },
    worstRoute: null,
    allRoutesClear: false,
    noTrafficRecords: true,
    noEnvRecords: true,
  },
  map: { farms: [], markets: [] },
  farms: [],
  history: [],
};

async function loadTrafficOverview(): Promise<OverviewPayload> {
  try {
    const res = await fetch("/api/traffic-overview");
    const json = (await res.json()) as OverviewPayload & { error?: string };
    if (!res.ok) return { ...EMPTY_PAYLOAD, error: json.error ?? "Failed to load." };
    return json;
  } catch {
    return { ...EMPTY_PAYLOAD, error: "Network error." };
  }
}


function CombinedBadge({ health }: { health: CombinedRouteHealth }) {
  const base =
    "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1";
  if (health === "clear")
    return (
      <span className={`${base} bg-emerald-900/40 text-emerald-400 ring-emerald-700/40`}>
        ✓ Clear
      </span>
    );
  if (health === "moderate")
    return (
      <span className={`${base} bg-amber-900/40 text-amber-400 ring-amber-700/40`}>
        ⚠ Moderate
      </span>
    );
  if (health === "high_risk")
    return (
      <span className={`${base} bg-red-900/40 text-red-400 ring-red-700/40`}>
        ✗ High Risk
      </span>
    );
  if (health === "critical")
    return (
      <span className={`${base} bg-red-950 text-red-300 ring-red-800`}>
        ✗✗ Critical
      </span>
    );
  return (
    <span className={`${base} bg-zinc-800 text-zinc-500 ring-zinc-700`}>
      No data
    </span>
  );
}

function ReliabilityBadge({ reliability }: { reliability: Reliability }) {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1";
  if (reliability === "consistent")
    return (
      <span className={`${base} bg-emerald-900/30 text-emerald-400 ring-emerald-700/40`}>
        Consistent
      </span>
    );
  if (reliability === "variable")
    return (
      <span className={`${base} bg-amber-900/30 text-amber-400 ring-amber-700/40`}>
        Variable
      </span>
    );
  if (reliability === "unpredictable")
    return (
      <span className={`${base} bg-red-900/30 text-red-400 ring-red-700/40`}>
        Unpredictable
      </span>
    );
  return (
    <span className={`${base} bg-zinc-800 text-zinc-500 ring-zinc-700`}>
      Too few trips
    </span>
  );
}

function MiniLine({
  data,
  dataKey,
  color,
  valueFormatter,
}: {
  data: { x: number; v: number | null; label?: string }[];
  dataKey: string;
  color: string;
  valueFormatter?: (v: number) => string;
}) {
  if (data.length < 2) return null;
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <XAxis dataKey="x" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 11 }}
            formatter={(v) => [
              typeof v === "number"
                ? (valueFormatter ? valueFormatter(v) : v.toFixed(3))
                : "—",
              dataKey,
            ]}
            labelFormatter={(_, payload) =>
              (payload?.[0] as { payload?: { label?: string } } | undefined)
                ?.payload?.label ?? `Point ${Number(_) + 1}`
            }
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrafficViewClient() {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setData(await loadTrafficOverview());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const next = await loadTrafficOverview();
      if (!cancelled) setData(next);
    };
    void hydrate();
    return () => { cancelled = true; };
  }, []);

  const [drawerId, setDrawerId] = useState<string | null>(null);

  type LiveResult = {
    tau: number | null;
    effectiveTravelHr: number;
    congestion: "low" | "moderate" | "high" | null;
    logisticsCost: number;
    avgTempC: number | null;
    avgHumidity: number | null;
    decayLevel: "low" | "moderate" | "high" | null;
    fetchedAt: string;
    hereAvailable: boolean;
    weatherAvailable: boolean;
  };
  const [liveData, setLiveData] = useState<LiveResult | null>(null);
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);

  const flatRoutes = useMemo(
    () => data?.farms.flatMap((f) => f.routes) ?? [],
    [data]
  );

  const drawerRoute = useMemo(
    () => flatRoutes.find((r) => r.routeRecordId === drawerId) ?? null,
    [flatRoutes, drawerId]
  );

  // Clear live snapshot when drawer switches routes
  useEffect(() => {
    setLiveData(null);
    setLiveError(null);
  }, [drawerId]);

  async function checkLive() {
    if (!drawerRoute) return;
    const market = data?.map.markets.find((m) => m.id === drawerRoute.marketId);
    if (!market?.lat || !market?.lng) {
      setLiveError("Market coordinates not available.");
      return;
    }
    const { originByFarmOriginId: originLookup } = await import("../lib/origins");
    const origin = originLookup(drawerRoute.farmOriginId);
    if (!origin) {
      setLiveError("Farm coordinates not available.");
      return;
    }
    setLiveLoading(true);
    setLiveError(null);
    setLiveData(null);
    try {
      const res = await fetch("/api/traffic-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originLat: origin.origin_lat,
          originLng: origin.origin_lng,
          marketLat: market.lat,
          marketLng: market.lng,
          distanceKm: drawerRoute.distanceKm,
          tBaseHr: drawerRoute.tBaseHr,
        }),
      });
      const json = await res.json() as LiveResult & { error?: string };
      if (!res.ok) { setLiveError(json.error ?? "Live check failed."); return; }
      setLiveData(json);
    } catch {
      setLiveError("Network error.");
    } finally {
      setLiveLoading(false);
    }
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <div className="h-14 border-b border-zinc-800 bg-zinc-900 animate-pulse" />
        <div className="mx-auto max-w-7xl space-y-4 p-4">
          <div className="h-20 animate-pulse rounded-xl bg-zinc-900" />
          <div className="h-20 animate-pulse rounded-xl bg-zinc-900" />
          <div className="h-48 animate-pulse rounded-xl bg-zinc-900" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 pb-32">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-5 py-4">
        <div className="flex items-center gap-3">
          <AgriDispatchLogo className="h-9 w-9" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              AgriDispatch
            </p>
            <h1 className="text-base font-bold leading-tight tracking-tight text-zinc-100">
              Route Conditions
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <Link
            href="/"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Home
          </Link>
          <Link
            href="/batches"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Batches
          </Link>
          <Link
            href="/pricing"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Pricing
          </Link>
          <span className="rounded-md border border-emerald-700/40 bg-emerald-900/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400">
            Routes
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        {data.error ? (
          <p className="rounded-xl border border-red-800/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            {data.error}
          </p>
        ) : null}

        {/* Map */}
        {data.map.markets.length > 0 || data.map.farms.length > 0 ? (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-zinc-500" />
                <h2 className="text-sm font-semibold text-zinc-200">
                  Farm &amp; market map
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-900/30 px-2.5 py-1 font-medium text-emerald-400 ring-1 ring-emerald-700/40">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Farm origin
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-900/30 px-2.5 py-1 font-medium text-sky-400 ring-1 ring-sky-700/40">
                  <span className="h-2 w-2 rounded-full bg-sky-400" />
                  Market
                </span>
              </div>
            </div>
            <RouteConditionsMap
              farms={data.map.farms}
              markets={data.map.markets}
            />
          </section>
        ) : null}

        {/* Route cards per farm */}
        <section className="space-y-8">
          {data.farms.map((farm) => {
            const rankedRoutes = [...farm.routes].sort((a, b) => {
              if (a.avgLogisticsCost != null && b.avgLogisticsCost != null)
                return a.avgLogisticsCost - b.avgLogisticsCost;
              if (a.avgLogisticsCost != null) return -1;
              if (b.avgLogisticsCost != null) return 1;
              return 0;
            });
            return (
              <div key={farm.farmOriginId}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-zinc-200">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  {farm.farmName}
                  <span className="text-xs font-normal text-zinc-600">
                    {farm.farmOriginId}
                  </span>
                </h2>

                {/* Per-farm cost ranking strip */}
                {rankedRoutes.some((r) => r.avgLogisticsCost != null) ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {rankedRoutes.map((r, i) => (
                      <button
                        key={r.routeRecordId}
                        type="button"
                        onClick={() => setDrawerId(r.routeRecordId)}
                        className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs transition hover:border-zinc-700"
                      >
                        <span className="font-bold text-zinc-600">#{i + 1}</span>
                        <span className="font-medium text-zinc-300">{r.marketName}</span>
                        {r.avgLogisticsCost != null ? (
                          <span className="font-mono font-semibold text-emerald-400">
                            {formatInr(r.avgLogisticsCost)}
                          </span>
                        ) : (
                          <span className="text-zinc-600">no data</span>
                        )}
                        {r.reliability !== "consistent" && r.reliability !== "insufficient_data" ? (
                          <ReliabilityBadge reliability={r.reliability} />
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {farm.routes.map((r) => (
                    <button
                      key={r.routeRecordId}
                      type="button"
                      onClick={() => setDrawerId(r.routeRecordId)}
                      className={`group flex flex-col rounded-xl border bg-zinc-900 p-4 text-left transition hover:-translate-y-0.5 hover:border-zinc-700 hover:shadow-lg hover:shadow-black/30 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                        r.combinedHealth === "no_data"
                          ? "border-dashed border-zinc-700"
                          : "border-zinc-800"
                      }`}
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold leading-snug text-zinc-200 group-hover:text-emerald-400 transition-colors">
                          {r.farmName}
                          <span className="font-normal text-zinc-600"> → </span>
                          {r.marketName}
                        </p>
                        <CombinedBadge health={r.combinedHealth} />
                      </div>
                      <p className="text-xs text-zinc-600">
                        {r.distanceKm.toFixed(1)} km
                      </p>

                      {/* Avg cost + reliability */}
                      <div className="mt-3 border-t border-zinc-800 pt-3">
                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                              Avg logistics cost
                            </p>
                            <p className="mt-0.5 text-xl font-bold tabular-nums text-zinc-100">
                              {r.avgLogisticsCost != null
                                ? formatInr(r.avgLogisticsCost)
                                : "—"}
                            </p>
                            {r.tauRecordCount > 0 ? (
                              <p className="mt-0.5 text-[10px] text-zinc-600">
                                over {r.tauRecordCount} trip{r.tauRecordCount !== 1 ? "s" : ""}
                              </p>
                            ) : null}
                          </div>
                          <ReliabilityBadge reliability={r.reliability} />
                        </div>
                      </div>

                      <div className="mt-3 border-t border-zinc-800 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-sky-500">
                          Traffic
                        </p>
                        {r.hasTrafficData ? (
                          <dl className="mt-2 space-y-1 text-xs text-zinc-400">
                            <div className="flex justify-between gap-2">
                              <dt className="text-zinc-600">Est. travel time</dt>
                              <dd className="font-semibold text-zinc-200">
                                {formatHours(r.effectiveTravelHr)}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-zinc-600">Congestion</dt>
                              <dd className={
                                r.congestion === "high" ? "text-red-400" :
                                r.congestion === "moderate" ? "text-amber-400" :
                                "text-emerald-400"
                              }>{levelLabel(r.congestion)}</dd>
                            </div>
                          </dl>
                        ) : (
                          <p className="mt-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950 py-2.5 text-center text-xs text-zinc-600">
                            No traffic data
                          </p>
                        )}
                      </div>

                      <div className="mt-3 border-t border-zinc-800 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                          Environment
                        </p>
                        {r.hasEnvData ? (
                          <dl className="mt-2 space-y-1 text-xs text-zinc-400">
                            <div className="flex justify-between gap-2">
                              <dt className="text-zinc-600">Temp °C</dt>
                              <dd className="text-zinc-300">
                                {r.temperatureC != null
                                  ? r.temperatureC.toFixed(1)
                                  : "—"}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="flex items-center gap-1 text-zinc-600">
                                Humidity %
                                <span
                                  title="High humidity increases fungal decay risk along this route."
                                  className="inline-flex"
                                >
                                  <Info className="h-3 w-3 text-zinc-700" />
                                </span>
                              </dt>
                              <dd className="text-zinc-300">
                                {r.humidityPct != null
                                  ? r.humidityPct.toFixed(0)
                                  : "—"}
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-zinc-600">Decay risk</dt>
                              <dd className={
                                r.decayLevel === "high" ? "text-red-400" :
                                r.decayLevel === "moderate" ? "text-amber-400" :
                                "text-emerald-400"
                              }>{levelLabel(r.decayLevel)}</dd>
                            </div>
                          </dl>
                        ) : (
                          <p className="mt-2 rounded-lg border border-dashed border-zinc-800 bg-zinc-950 py-2.5 text-center text-xs text-zinc-600">
                            No environmental data
                          </p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>

        {/* Dispatch history */}
        <section>
          <h2 className="mb-1 text-sm font-bold text-zinc-200">
            Dispatch history
          </h2>
          <p className="mb-4 text-xs text-zinc-500">
            All batches with the traffic and environmental conditions recorded at evaluation time.
          </p>
          {data.history.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900 px-6 py-10 text-center text-sm text-zinc-600">
              No dispatch records found.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-zinc-800 bg-zinc-800/50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-3">Batch ID</th>
                    <th className="px-3 py-3">Farm</th>
                    <th className="px-3 py-3">Harvest</th>
                    <th className="px-3 py-3">Market</th>
                    <th className="px-3 py-3 text-right">Cost</th>
                    <th className="px-3 py-3">Congestion</th>
                    <th className="px-3 py-3">Temp °C</th>
                    <th className="px-3 py-3">Humidity %</th>
                    <th className="px-3 py-3">Decay</th>
                    <th className="px-3 py-3">Quality</th>
                    <th className="px-3 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.history.map((row) => (
                    <tr
                      key={row.batchRecordId}
                      className="border-b border-zinc-800 hover:bg-zinc-800/40"
                    >
                      <td className="px-3 py-2 font-mono text-xs text-emerald-400">
                        {row.batchId}
                      </td>
                      <td className="px-3 py-2 text-zinc-300">{row.farmName}</td>
                      <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">
                        {row.harvestTimeDisplay}
                      </td>
                      <td className="px-3 py-2">
                        {row.recommendedMarket ? (
                          <span className="rounded-full bg-violet-900/40 px-2 py-0.5 text-xs font-medium text-violet-400 ring-1 ring-violet-700/40">
                            {row.recommendedMarket}
                          </span>
                        ) : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-zinc-300">
                        {row.logisticsCost != null ? formatInr(row.logisticsCost) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-xs ${
                        row.congestion === "high" ? "text-red-400" :
                        row.congestion === "moderate" ? "text-amber-400" :
                        row.congestion === "low" ? "text-emerald-400" :
                        "text-zinc-600"
                      }`}>{levelLabel(row.congestion)}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-zinc-400">
                        {row.temperatureC != null ? row.temperatureC.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-zinc-400">
                        {row.humidityPct != null ? row.humidityPct.toFixed(0) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-xs ${
                        row.decayLevel === "high" ? "text-red-400" :
                        row.decayLevel === "moderate" ? "text-amber-400" :
                        row.decayLevel === "low" ? "text-emerald-400" :
                        "text-zinc-600"
                      }`}>{levelLabel(row.decayLevel)}</td>
                      <td className="px-3 py-2 font-mono text-xs tabular-nums text-zinc-300">
                        {row.qualityPacked != null ? row.qualityPacked.toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          row.status === "Dispatched"
                            ? "bg-emerald-900/40 text-emerald-400 ring-emerald-700/40"
                            : row.status === "Evaluated"
                              ? "bg-sky-900/40 text-sky-400 ring-sky-700/40"
                              : "bg-zinc-800 text-zinc-400 ring-zinc-700"
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Route detail drawer */}
      {drawerRoute ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-zinc-950/70 backdrop-blur-[2px]"
            aria-label="Close drawer"
            onClick={() => setDrawerId(null)}
          />
          <aside className="relative flex h-full w-full max-w-lg flex-col border-l border-zinc-800 bg-zinc-900 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-zinc-800 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Route detail
                </p>
                <h3 className="mt-1 text-lg font-bold text-zinc-100">
                  {drawerRoute.farmName} → {drawerRoute.marketName}
                </h3>
                <p className="text-sm text-zinc-500">
                  {drawerRoute.marketLocation}
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  Origin {drawerRoute.farmOriginId} · {drawerRoute.distanceKm.toFixed(1)}{" "}km
                </p>
                <div className="mt-3">
                  <CombinedBadge health={drawerRoute.combinedHealth} />
                </div>
                <p className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm leading-relaxed text-zinc-400">
                  {drawerInterpretation(drawerRoute.combinedHealth)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerId(null)}
                className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
              <h4 className="font-bold text-sky-500">Traffic</h4>
              <dl className="mt-2 space-y-2 text-zinc-400">
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Estimated travel time</dt>
                  <dd className="font-semibold text-zinc-100">
                    {formatHours(drawerRoute.effectiveTravelHr)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Congestion</dt>
                  <dd className={
                    drawerRoute.congestion === "high" ? "text-red-400" :
                    drawerRoute.congestion === "moderate" ? "text-amber-400" :
                    "text-emerald-400"
                  }>{levelLabel(drawerRoute.congestion)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Logistics cost</dt>
                  <dd className="font-semibold text-zinc-100">
                    {formatInr(drawerRoute.logisticsCost)}
                  </dd>
                </div>
              </dl>

              <h4 className="mt-6 font-bold text-emerald-500">Environment</h4>
              <dl className="mt-2 space-y-2 text-zinc-400">
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Temperature</dt>
                  <dd className="text-zinc-300">
                    {drawerRoute.temperatureC != null
                      ? `${drawerRoute.temperatureC.toFixed(1)} °C`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Humidity</dt>
                  <dd className="text-zinc-300">
                    {drawerRoute.humidityPct != null
                      ? `${drawerRoute.humidityPct.toFixed(0)}%`
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-600">Produce decay risk</dt>
                  <dd className={
                    drawerRoute.decayLevel === "high" ? "text-red-400" :
                    drawerRoute.decayLevel === "moderate" ? "text-amber-400" :
                    "text-emerald-400"
                  }>{levelLabel(drawerRoute.decayLevel)}</dd>
                </div>
              </dl>

              <div className="mt-6 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-600">
                    Traffic trend
                  </p>
                  {drawerRoute.tauHistory.length >= 2 ? (
                    <MiniLine
                      data={[...drawerRoute.tauHistory]
                        .reverse()
                        .map((h, i) => ({
                          x: i,
                          v: h.tau,
                          label: new Intl.DateTimeFormat("en-IN", {
                            timeZone: data.timeZone,
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(h.createdTime)),
                        }))}
                      dataKey="congestion"
                      color="#38bdf8"
                      valueFormatter={(v) => v < 0.2 ? "Low" : v < 0.5 ? "Moderate" : "High"}
                    />
                  ) : null}
                  {drawerRoute.tauHistory.length >= 2 ? (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {[...drawerRoute.tauHistory].reverse().map((h) => (
                          <tr key={h.recordId} className="border-t border-zinc-800">
                            <td className="py-1 text-zinc-600">
                              {new Intl.DateTimeFormat("en-IN", {
                                timeZone: data.timeZone,
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(h.createdTime))}
                            </td>
                            <td className="py-1 text-right text-zinc-400">
                              {h.tau != null ? levelLabel(
                                h.tau < 0.2 ? "low" : h.tau < 0.5 ? "moderate" : "high"
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-zinc-600">
                    Decay risk trend
                  </p>
                  {drawerRoute.envHistory.length >= 2 ? (
                    <MiniLine
                      data={[...drawerRoute.envHistory]
                        .reverse()
                        .map((h, i) => ({
                          x: i,
                          v: h.decayScore,
                          label: new Intl.DateTimeFormat("en-IN", {
                            timeZone: data.timeZone,
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          }).format(new Date(h.createdTime)),
                        }))}
                      dataKey="decay risk"
                      color="#34d399"
                      valueFormatter={(v) => v < 0.35 ? "Low" : v < 0.65 ? "Moderate" : "High"}
                    />
                  ) : null}
                  {drawerRoute.envHistory.length >= 2 ? (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {[...drawerRoute.envHistory].reverse().map((h) => (
                          <tr key={h.recordId} className="border-t border-zinc-800">
                            <td className="py-1 text-zinc-600">
                              {new Intl.DateTimeFormat("en-IN", {
                                timeZone: data.timeZone,
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(h.createdTime))}
                            </td>
                            <td className="py-1 text-right text-zinc-400">
                              {h.decayScore != null ? levelLabel(
                                h.decayScore < 0.35 ? "low" : h.decayScore < 0.65 ? "moderate" : "high"
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              </div>

              {/* Live snapshot */}
              <div className="mt-6 border-t border-zinc-800 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Live snapshot
                  </p>
                  <button
                    type="button"
                    onClick={checkLive}
                    disabled={liveLoading}
                    className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
                  >
                    {liveLoading ? "Checking…" : "Check now"}
                  </button>
                </div>

                {liveError ? (
                  <p className="mt-3 text-xs text-red-400">{liveError}</p>
                ) : liveData ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-[10px] text-zinc-600">
                      Checked{" "}
                      {new Intl.DateTimeFormat("en-IN", {
                        timeZone: data?.timeZone ?? "Asia/Kolkata",
                        day: "2-digit", month: "short",
                        hour: "2-digit", minute: "2-digit",
                      }).format(new Date(liveData.fetchedAt))}
                    </p>

                    <dl className="space-y-2 text-sm text-zinc-400">
                      {liveData.hereAvailable && liveData.congestion != null ? (
                        <>
                          <div className="flex justify-between">
                            <dt className="text-zinc-600">Congestion right now</dt>
                            <dd className={
                              liveData.congestion === "high" ? "font-semibold text-red-400" :
                              liveData.congestion === "moderate" ? "font-semibold text-amber-400" :
                              "font-semibold text-emerald-400"
                            }>
                              {liveData.congestion === "low" ? "Low" : liveData.congestion === "moderate" ? "Moderate" : "High"}
                            </dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-zinc-600">Est. travel time</dt>
                            <dd className="text-zinc-200">{formatHours(liveData.effectiveTravelHr)}</dd>
                          </div>
                          <div className="flex justify-between">
                            <dt className="text-zinc-600">Estimated cost</dt>
                            <dd className="font-semibold text-zinc-100">{formatInr(liveData.logisticsCost)}</dd>
                          </div>
                        </>
                      ) : !liveData.hereAvailable ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 py-2 text-center text-xs text-zinc-600">
                          Traffic check unavailable — HERE_API_KEY not set
                        </div>
                      ) : null}

                      {liveData.weatherAvailable && (liveData.avgTempC != null || liveData.avgHumidity != null) ? (
                        <>
                          {liveData.avgTempC != null ? (
                            <div className="flex justify-between">
                              <dt className="text-zinc-600">Temp right now</dt>
                              <dd className="text-zinc-200">{liveData.avgTempC.toFixed(1)} °C</dd>
                            </div>
                          ) : null}
                          {liveData.avgHumidity != null ? (
                            <div className="flex justify-between">
                              <dt className="text-zinc-600">Humidity right now</dt>
                              <dd className="text-zinc-200">{liveData.avgHumidity}%</dd>
                            </div>
                          ) : null}
                          {liveData.decayLevel != null ? (
                            <div className="flex justify-between">
                              <dt className="text-zinc-600">Decay risk right now</dt>
                              <dd className={
                                liveData.decayLevel === "high" ? "font-semibold text-red-400" :
                                liveData.decayLevel === "moderate" ? "font-semibold text-amber-400" :
                                "font-semibold text-emerald-400"
                              }>
                                {liveData.decayLevel === "low" ? "Low" : liveData.decayLevel === "moderate" ? "Moderate" : "High"}
                              </dd>
                            </div>
                          ) : null}
                        </>
                      ) : !liveData.weatherAvailable ? (
                        <div className="rounded-lg border border-dashed border-zinc-800 py-2 text-center text-xs text-zinc-600">
                          Weather check unavailable — WEATHERAPI_KEY not set
                        </div>
                      ) : null}
                    </dl>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-zinc-600">
                    Fetch live traffic and weather conditions for this route right now.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
