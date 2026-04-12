"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Info,
  Leaf,
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

const RouteConditionsMap = dynamic(() => import("./route-conditions-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[clamp(18rem,45vh,32rem)] w-full items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-100 text-sm text-zinc-500 sm:h-[clamp(22rem,50vh,36rem)]">
      Loading map…
    </div>
  ),
});

type Congestion = "low" | "moderate" | "high" | "unknown";
type Decay = "low" | "moderate" | "high" | "unknown";

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
};

type FarmGroup = {
  farmOriginId: string;
  farmName: string;
  routes: RouteRow[];
};

type ExposureRow = {
  batchRecordId: string;
  batchId: string;
  farmName: string;
  farmOriginId: string | null;
  status: string;
  recommendedMarket: string | null;
  congestion: Congestion;
  decayLevel: Decay;
  qualityPacked: number | null;
  exposureNote: string;
  exposureRank: number;
};

type OverviewPayload = {
  timeZone: string;
  qMin: number;
  pageTone: "none" | "green" | "amber" | "red";
  trafficFreshness: {
    level: string;
    headline: string;
    detail?: string;
    lastUpdatedIso: string | null;
    ageHours: number | null;
    lastUpdatedDisplay: string | null;
  };
  envFreshness: {
    level: string;
    headline: string;
    detail?: string;
    lastUpdatedIso: string | null;
    ageHours: number | null;
    lastUpdatedDisplay: string | null;
  };
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
  exposure: ExposureRow[];
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

async function loadTrafficOverview(): Promise<OverviewPayload> {
  try {
    const res = await fetch("/api/traffic-overview");
    const json = (await res.json()) as OverviewPayload & { error?: string };
    if (!res.ok) {
      return {
        error: json.error ?? "Failed to load.",
        timeZone: "Asia/Kolkata",
        qMin: 0.65,
        pageTone: "red",
        trafficFreshness: {
          level: "red",
          headline: json.error ?? "Error",
          lastUpdatedIso: null,
          ageHours: null,
          lastUpdatedDisplay: null,
        },
        envFreshness: {
          level: "red",
          headline: "",
          lastUpdatedIso: null,
          ageHours: null,
          lastUpdatedDisplay: null,
        },
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
        exposure: [],
      };
    }

    return json;
  } catch {
    return {
      error: "Network error.",
      timeZone: "Asia/Kolkata",
      qMin: 0.65,
      pageTone: "red",
      trafficFreshness: {
        level: "red",
        headline: "Could not load.",
        lastUpdatedIso: null,
        ageHours: null,
        lastUpdatedDisplay: null,
      },
      envFreshness: {
        level: "red",
        headline: "",
        lastUpdatedIso: null,
        ageHours: null,
        lastUpdatedDisplay: null,
      },
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
      exposure: [],
    };
  }
}

function FreshBanner({
  tone,
  icon: Icon,
  title,
  headline,
  detail,
  onRefresh,
}: {
  tone: "green" | "amber" | "red" | "neutral";
  icon: typeof Activity;
  title: string;
  headline: string;
  detail?: string;
  onRefresh: () => void;
}) {
  const bg =
    tone === "green"
      ? "from-emerald-800 to-emerald-900"
      : tone === "amber"
        ? "from-amber-700 to-amber-900"
        : tone === "red"
          ? "from-red-800 to-red-950"
          : "from-zinc-700 to-zinc-900";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${bg} p-4 text-white shadow-lg`}
    >
      <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <Icon className="mt-0.5 h-5 w-5 shrink-0 opacity-90" aria-hidden />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">
              {title}
            </p>
            <p className="font-semibold leading-snug">{headline}</p>
            {detail ? (
              <p className="mt-1 text-xs text-white/85">{detail}</p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-2 inline-flex items-center gap-1 self-start rounded-lg bg-white/15 px-2 py-1 text-xs font-medium hover:bg-white/25 sm:mt-0"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>
    </div>
  );
}

function toneFromLevel(
  level: string
): "green" | "amber" | "red" | "neutral" {
  if (level === "green") return "green";
  if (level === "amber") return "amber";
  if (level === "red" || level === "none") return "red";
  return "neutral";
}

function CombinedBadge({ health }: { health: CombinedRouteHealth }) {
  const base =
    "inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-center text-sm font-black tracking-tight shadow-md";
  if (health === "clear")
    return (
      <span className={`${base} bg-emerald-500 text-white ring-2 ring-emerald-300/50`}>
        ✓ Clear
      </span>
    );
  if (health === "moderate")
    return (
      <span className={`${base} bg-amber-500 text-white ring-2 ring-amber-200/50`}>
        ⚠ Moderate
      </span>
    );
  if (health === "high_risk")
    return (
      <span className={`${base} bg-red-600 text-white ring-2 ring-red-300/40`}>
        ✗ High Risk
      </span>
    );
  if (health === "critical")
    return (
      <span className={`${base} bg-red-950 text-red-50 ring-2 ring-red-800`}>
        ✗✗ Critical
      </span>
    );
  return (
    <span
      className={`${base} border-2 border-dashed border-zinc-400 bg-zinc-100 text-zinc-600 ring-0`}
    >
      No condition data
    </span>
  );
}

function MiniLine({
  data,
  dataKey,
  color,
}: {
  data: { x: number; v: number | null }[];
  dataKey: string;
  color: string;
}) {
  if (data.length < 2) return null;
  return (
    <div className="h-24 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <XAxis dataKey="x" hide />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            formatter={(v) => [
              typeof v === "number" ? v.toFixed(3) : String(v ?? "—"),
              dataKey,
            ]}
            labelFormatter={(i) => `Point ${Number(i) + 1}`}
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

  const load = useCallback(async () => {
    setData(await loadTrafficOverview());
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const next = await loadTrafficOverview();
      if (!cancelled) {
        setData(next);
      }
    };

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, []);

  const [drawerId, setDrawerId] = useState<string | null>(null);

  const flatRoutes = useMemo(
    () => data?.farms.flatMap((f) => f.routes) ?? [],
    [data]
  );

  const drawerRoute = useMemo(
    () => flatRoutes.find((r) => r.routeRecordId === drawerId) ?? null,
    [flatRoutes, drawerId]
  );

  const pageHeaderClass =
    data?.pageTone === "green"
      ? "from-emerald-950 via-slate-900 to-slate-950"
      : data?.pageTone === "amber"
        ? "from-amber-950 via-slate-900 to-slate-950"
        : "from-red-950 via-slate-950 to-slate-950";

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-950">
        <div className="h-48 animate-pulse bg-slate-800" />
        <div className="mx-auto max-w-7xl p-4">
          <div className="h-64 animate-pulse rounded-2xl bg-slate-800" />
        </div>
      </div>
    );
  }

  const t = data.summary.traffic;
  const e = data.summary.environment;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200/80 text-slate-900 pb-32">
      <header
        className={`border-b border-white/10 bg-gradient-to-r ${pageHeaderClass} px-4 py-8 text-white shadow-xl`}
      >
        <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/90">
              Operations monitor
            </p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight sm:text-4xl">
              Route conditions
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-300">
              Traffic congestion and environmental decay risk across all
              farm-to-market routes. Combined health highlights routes where both
              stressors align.
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-sm">
            <Link href="/" className="text-emerald-200 underline-offset-4 hover:underline">
              Home
            </Link>
            <Link
              href="/batches"
              className="text-emerald-200 underline-offset-4 hover:underline"
            >
              Batches
            </Link>
            <Link
              href="/pricing"
              className="text-emerald-200 underline-offset-4 hover:underline"
            >
              Pricing
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        {data.error ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {data.error}
          </p>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <FreshBanner
            tone={toneFromLevel(data.trafficFreshness.level)}
            icon={Activity}
            title="Traffic freshness"
            headline={data.trafficFreshness.headline}
            detail={data.trafficFreshness.detail}
            onRefresh={load}
          />
          <FreshBanner
            tone={toneFromLevel(data.envFreshness.level)}
            icon={Leaf}
            title="Environmental freshness"
            headline={data.envFreshness.headline || "—"}
            detail={data.envFreshness.detail}
            onRefresh={load}
          />
        </div>

        <section
          className={`rounded-2xl border p-4 shadow-sm ${
            data.summary.allRoutesClear
              ? "border-emerald-200 bg-emerald-50/90"
              : "border-slate-200 bg-white"
          }`}
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Risk summary
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  Traffic
                </span>
                {(
                  [
                    ["low", t.low],
                    ["moderate", t.moderate],
                    ["high", t.high],
                  ] as const
                ).map(([k, n]) => (
                  <span
                    key={k}
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-slate-200 bg-slate-50 ${
                      k === "high" && n > 0
                        ? "bg-red-50 font-bold text-red-700 ring-red-200"
                        : ""
                    }`}
                  >
                    {levelLabel(k as Congestion)}: {n}
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-600">
                  Environment
                </span>
                {(
                  [
                    ["low", e.low],
                    ["moderate", e.moderate],
                    ["high", e.high],
                  ] as const
                ).map(([k, n]) => (
                  <span
                    key={k}
                    className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-slate-200 bg-slate-50 ${
                      k === "high" && n > 0
                        ? "bg-red-50 font-bold text-red-700 ring-red-200"
                        : ""
                    }`}
                  >
                    {levelLabel(k as Decay)}: {n}
                  </span>
                ))}
              </div>
            </div>
            {data.summary.worstRoute ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 lg:max-w-md">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold">Worst route</p>
                  <p className="mt-0.5">{data.summary.worstRoute}</p>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {data.map.markets.length > 0 || data.map.farms.length > 0 ? (
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-md">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Route className="h-5 w-5 text-slate-500" />
                <h2 className="text-lg font-semibold text-slate-800">
                  Farm &amp; market map
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-900 ring-1 ring-emerald-200">
                  <span className="h-2.5 w-2.5 rounded-full border border-emerald-900/30 bg-emerald-500" />
                  Farm origin
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-900 ring-1 ring-blue-200">
                  <span className="h-2.5 w-2.5 rounded-full border border-blue-900/30 bg-blue-400" />
                  Market
                </span>
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-500">
              Green: farm origins · Blue: APMC markets (needs{" "}
              <code className="rounded bg-slate-100 px-1">market_lat</code> /{" "}
              <code className="rounded bg-slate-100 px-1">market_lng</code> in
              Airtable).
            </p>
            <RouteConditionsMap
              farms={data.map.farms}
              markets={data.map.markets}
            />
          </section>
        ) : null}

        <section className="space-y-8">
          {data.farms.map((farm) => (
            <div key={farm.farmOriginId}>
              <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {farm.farmName}
                <span className="text-sm font-normal text-slate-500">
                  {farm.farmOriginId}
                </span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {farm.routes.map((r) => (
                  <button
                    key={r.routeRecordId}
                    type="button"
                    onClick={() => setDrawerId(r.routeRecordId)}
                    className={`group flex flex-col rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/30 ${
                      r.combinedHealth === "no_data"
                        ? "border-dashed border-amber-300"
                        : "border-slate-200/90"
                    }`}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug text-slate-800 group-hover:text-emerald-800">
                        {r.farmName}
                        <span className="font-normal text-slate-400"> → </span>
                        {r.marketName}
                      </p>
                      <CombinedBadge health={r.combinedHealth} />
                    </div>
                    <p className="text-xs text-slate-500">
                      {r.distanceKm.toFixed(1)} km
                    </p>

                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700">
                        Traffic
                      </p>
                      {r.hasTrafficData ? (
                        <dl className="mt-2 space-y-1 text-xs text-slate-700">
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">τ</dt>
                            <dd className="font-mono">{r.tau?.toFixed(2)}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Effective</dt>
                            <dd className="font-semibold">
                              {formatHours(r.effectiveTravelHr)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Congestion</dt>
                            <dd>{levelLabel(r.congestion)}</dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 py-3 text-center text-xs text-slate-500">
                          No traffic data
                        </p>
                      )}
                    </div>

                    <div className="mt-3 border-t border-slate-100 pt-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                        Environment
                      </p>
                      {r.hasEnvData ? (
                        <dl className="mt-2 space-y-1 text-xs text-slate-700">
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Temp °C</dt>
                            <dd>
                              {r.temperatureC != null
                                ? r.temperatureC.toFixed(1)
                                : "—"}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="flex items-center gap-1 text-slate-500">
                              Humidity %
                              <span
                                title="High humidity increases fungal decay risk along this route."
                                className="inline-flex"
                              >
                                <Info className="h-3.5 w-3.5 text-slate-400" />
                              </span>
                            </dt>
                            <dd>
                              {r.humidityPct != null
                                ? r.humidityPct.toFixed(0)
                                : "—"}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt className="text-slate-500">Decay risk</dt>
                            <dd>{levelLabel(r.decayLevel)}</dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 py-3 text-center text-xs text-slate-500">
                          No environmental data
                        </p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-2 text-lg font-bold text-slate-800">
            Batch exposure
          </h2>
          <p className="mb-4 text-sm text-slate-600">
            Pending batches (Submitted / Evaluated) and recommended route
            conditions.
          </p>
          {data.exposure.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-600">
              No pending batches in the system.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-3">Batch ID</th>
                    <th className="px-3 py-3">Farm</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Recommended</th>
                    <th className="px-3 py-3">Congestion</th>
                    <th className="px-3 py-3">Decay</th>
                    <th className="px-3 py-3">Quality</th>
                    <th className="px-3 py-3">Exposure</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exposure.map((row) => (
                    <tr
                      key={row.batchRecordId}
                      className={`border-b border-slate-100 ${
                        row.exposureRank >= 80
                          ? "bg-amber-50/90"
                          : "hover:bg-slate-50/80"
                      }`}
                    >
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.batchId}
                      </td>
                      <td className="px-3 py-2">{row.farmName}</td>
                      <td className="px-3 py-2">{row.status}</td>
                      <td className="px-3 py-2">
                        {row.recommendedMarket ?? "—"}
                      </td>
                      <td className="px-3 py-2">{levelLabel(row.congestion)}</td>
                      <td className="px-3 py-2">{levelLabel(row.decayLevel)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {row.qualityPacked != null
                          ? row.qualityPacked.toFixed(2)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {row.exposureNote || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {drawerRoute ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            aria-label="Close drawer"
            onClick={() => setDrawerId(null)}
          />
          <aside className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Route detail
                </p>
                <h3 className="mt-1 text-xl font-bold text-slate-900">
                  {drawerRoute.farmName} → {drawerRoute.marketName}
                </h3>
                <p className="text-sm text-slate-600">
                  {drawerRoute.marketLocation}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Origin {drawerRoute.farmOriginId} · {drawerRoute.distanceKm.toFixed(1)}{" "}
                  km
                </p>
                <div className="mt-3">
                  <CombinedBadge health={drawerRoute.combinedHealth} />
                </div>
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-800">
                  {drawerInterpretation(drawerRoute.combinedHealth)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawerId(null)}
                className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
              <h4 className="font-bold text-sky-800">Traffic</h4>
              <dl className="mt-2 space-y-2 text-slate-700">
                <div className="flex justify-between">
                  <dt className="text-slate-500">τ</dt>
                  <dd className="font-mono">
                    {drawerRoute.tau != null ? drawerRoute.tau.toFixed(3) : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Base time</dt>
                  <dd>{formatHours(drawerRoute.tBaseHr)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Effective</dt>
                  <dd className="font-semibold">
                    {formatHours(drawerRoute.effectiveTravelHr)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Congestion</dt>
                  <dd>{levelLabel(drawerRoute.congestion)}</dd>
                </div>
              </dl>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 font-mono text-xs leading-relaxed">
                Cost = (₹12 × {drawerRoute.distanceKm}) + ₹150 ×{" "}
                {drawerRoute.tBaseHr} × (1 + 1.5 ×{" "}
                {drawerRoute.logisticsBreakdown.tauUsed}) + ₹500 ={" "}
                {formatInr(drawerRoute.logisticsCost)}
              </div>

              <h4 className="mt-6 font-bold text-emerald-800">Environment</h4>
              <dl className="mt-2 space-y-2 text-slate-700">
                <div className="flex justify-between">
                  <dt className="text-slate-500">Temperature °C</dt>
                  <dd>
                    {drawerRoute.temperatureC != null
                      ? drawerRoute.temperatureC.toFixed(1)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="flex items-center gap-1 text-slate-500">
                    Humidity %
                    <span title="High humidity increases fungal decay risk along this route.">
                      <Info className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                    </span>
                  </dt>
                  <dd>
                    {drawerRoute.humidityPct != null
                      ? drawerRoute.humidityPct.toFixed(0)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Decay score</dt>
                  <dd className="font-mono">
                    {drawerRoute.decayRiskScore != null
                      ? drawerRoute.decayRiskScore.toFixed(3)
                      : "—"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-500">Decay level</dt>
                  <dd>{levelLabel(drawerRoute.decayLevel)}</dd>
                </div>
              </dl>

              <div className="mt-6 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    τ history
                  </p>
                  {drawerRoute.tauHistory.length >= 2 ? (
                    <MiniLine
                      data={[...drawerRoute.tauHistory]
                        .reverse()
                        .map((h, i) => ({
                          x: i,
                          v: h.tau,
                        }))}
                      dataKey="τ"
                      color="#0284c7"
                    />
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Historical tracking not yet enabled for this data source (need
                      multiple Traffic_Estimates rows per route).
                    </p>
                  )}
                  {drawerRoute.tauHistory.length >= 2 ? (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {[...drawerRoute.tauHistory].reverse().map((h) => (
                          <tr key={h.recordId} className="border-t border-slate-100">
                            <td className="py-1 text-slate-500">
                              {new Intl.DateTimeFormat("en-IN", {
                                timeZone: data.timeZone,
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(h.createdTime))}
                            </td>
                            <td className="py-1 text-right font-mono">
                              {h.tau != null ? h.tau.toFixed(3) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Decay history
                  </p>
                  {drawerRoute.envHistory.length >= 2 ? (
                    <MiniLine
                      data={[...drawerRoute.envHistory]
                        .reverse()
                        .map((h, i) => ({
                          x: i,
                          v: h.decayScore,
                        }))}
                      dataKey="decay"
                      color="#059669"
                    />
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Historical tracking not yet enabled for this data source (need
                      multiple Environmental_Risk rows per route).
                    </p>
                  )}
                  {drawerRoute.envHistory.length >= 2 ? (
                    <table className="mt-2 w-full text-xs">
                      <tbody>
                        {[...drawerRoute.envHistory].reverse().map((h) => (
                          <tr key={h.recordId} className="border-t border-slate-100">
                            <td className="py-1 text-slate-500">
                              {new Intl.DateTimeFormat("en-IN", {
                                timeZone: data.timeZone,
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }).format(new Date(h.createdTime))}
                            </td>
                            <td className="py-1 text-right font-mono">
                              {h.decayScore != null ? h.decayScore.toFixed(3) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
