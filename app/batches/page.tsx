"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PricingFreshnessBanner } from "../components/pricing-freshness-banner";
import { FARMER_MATURITY_OPTIONS } from "../lib/maturity";
import { ORIGINS } from "../lib/origins";

type OverviewRow = {
  recordId: string;
  batchId: string;
  farmOriginId: string | null;
  farmName: string;
  farmSubtext: string;
  harvestTime: string | null;
  harvestTimeDisplay: string;
  weightKg: number | null;
  maturityGrade: string | null;
  maturitySwatch: string | null;
  qualityPacked: number | null;
  qualityState: "missing" | "computing" | "ok" | "below";
  recommendedMarket: string | null;
  evaluationPending: boolean;
  expectedProfit: number | null;
  status: string;
  evaluationError: boolean;
};

type OverviewResponse = {
  stats: {
    totalBatches: number;
    dispatched: number;
    avgQualityPacked: number | null;
  };
  rows: OverviewRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  qMin: number;
  error?: string;
};

function formatInr(n: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
}

function StatusChip({ status }: { status: string }) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold";
  if (status === "Dispatched")
    return (
      <span className={`${base} bg-emerald-100 text-emerald-900`}>
        Dispatched
      </span>
    );
  if (status === "Evaluated")
    return (
      <span className={`${base} bg-sky-100 text-sky-900`}>Evaluated</span>
    );
  if (status === "Error")
    return <span className={`${base} bg-red-100 text-red-900`}>Error</span>;
  return (
    <span className={`${base} bg-zinc-200 text-zinc-800`}>Submitted</span>
  );
}

function QualityCell({
  row,
  qMin,
}: {
  row: OverviewRow;
  qMin: number;
}) {
  if (row.qualityState === "computing") {
    return (
      <span className="text-amber-700 text-sm flex items-center gap-1">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
        Computing…
      </span>
    );
  }
  if (row.qualityPacked == null) {
    return <span className="text-zinc-400">—</span>;
  }
  const q = row.qualityPacked;
  const pct = Math.round(Math.min(1, Math.max(0, q)) * 100);
  const color =
    q >= 0.8 ? "bg-emerald-500" : q >= 0.65 ? "bg-amber-500" : "bg-red-500";
  const labelColor =
    q >= 0.8 ? "text-emerald-800" : q >= 0.65 ? "text-amber-800" : "text-red-800";
  return (
    <div className="flex flex-col items-end gap-1 min-w-[7rem]">
      <div
        className="flex h-2 w-full max-w-[120px] overflow-hidden rounded bg-zinc-200"
        title={
          q < qMin
            ? "Below minimum quality threshold"
            : undefined
        }
      >
        <div
          className={`${color} h-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`font-mono text-sm tabular-nums ${labelColor} inline-flex items-center gap-1`}
      >
        {q < qMin ? (
          <span className="text-red-600" aria-label="Below quality threshold">
            ⚠
          </span>
        ) : null}
        {q.toFixed(2)}
      </span>
    </div>
  );
}

export default function BatchOverviewPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [farmOriginId, setFarmOriginId] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [maturityPick, setMaturityPick] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const maturityParam = useMemo(
    () => [...maturityPick].join(","),
    [maturityPick]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (search.trim()) qs.set("search", search.trim());
    if (farmOriginId !== "All") qs.set("farmOriginId", farmOriginId);
    if (statusFilter !== "All") qs.set("status", statusFilter);
    if (dateFrom) qs.set("dateFrom", dateFrom);
    if (dateTo) qs.set("dateTo", dateTo);
    if (maturityParam) qs.set("maturity", maturityParam);
    qs.set("page", String(page));
    qs.set("pageSize", "20");
    try {
      const res = await fetch(`/api/batch-overview?${qs.toString()}`);
      const json = (await res.json()) as OverviewResponse;
      if (!res.ok) {
        setError(json.error ?? "Failed to load");
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError("Network error");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [search, farmOriginId, statusFilter, dateFrom, dateTo, maturityParam, page]);

  useEffect(() => {
    load();
  }, [load]);

  const qMin = data?.qMin ?? 0.65;
  const rows = data?.rows ?? [];
  const stats = data?.stats;
  const pagination = data?.pagination;

  async function markDispatched(recordId: string) {
    setActionId(recordId);
    try {
      const res = await fetch(`/api/batches/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Dispatched" }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        alert(j.error ?? "Update failed");
        return;
      }
      await load();
    } finally {
      setActionId(null);
    }
  }

  function toggleMaturity(m: string) {
    setMaturityPick((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
    setPage(1);
  }

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <PricingFreshnessBanner />
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Dashboard
            </p>
            <h1 className="text-2xl font-bold tracking-tight">Batch overview</h1>
            <p className="mt-1 text-sm text-zinc-600">
              What came in, where it is in the pipeline, and what was decided.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link
              href="/farmer"
              className="rounded-lg bg-[#2e7d32] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#27692a]"
            >
              Farmer intake
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              Pricing
            </Link>
            <Link href="/" className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:underline">
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">Total batches</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {stats?.totalBatches ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">Dispatched</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
              {stats?.dispatched ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-zinc-500">
              Avg quality (packed)
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {stats?.avgQualityPacked != null
                ? stats.avgQualityPacked.toFixed(2)
                : "—"}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <label className="block text-sm">
              <span className="text-zinc-600">Search batch ID</span>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                placeholder="BATCH001"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">Farm location</span>
              <select
                value={farmOriginId}
                onChange={(e) => {
                  setFarmOriginId(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="All">All farms</option>
                {ORIGINS.map((o) => (
                  <option key={o.farm_origin_id} value={o.farm_origin_id}>
                    {o.origin_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">Pipeline status</span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="All">All</option>
                <option value="Pending">Pending</option>
                <option value="Evaluated">Evaluated</option>
                <option value="Dispatched">Dispatched</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">Harvest from</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-600">Harvest to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-4">
            <span className="text-sm text-zinc-600">Maturity grade</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {FARMER_MATURITY_OPTIONS.map((opt) => {
                const on = maturityPick.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleMaturity(opt.value)}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                      on
                        ? "border-[#2e7d32] ring-2 ring-[#4caf50]/40"
                        : "border-zinc-200 hover:border-zinc-400"
                    }`}
                  >
                    <span
                      className="h-5 w-5 rounded border border-zinc-200"
                      style={{ background: opt.swatch }}
                    />
                    {opt.value}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        {!loading && rows.length === 0 && data ? (
          <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
            <div className="text-4xl" aria-hidden>
              📦
            </div>
            <p className="mt-4 text-lg font-semibold text-zinc-800">
              {data.stats.totalBatches === 0
                ? "No batches yet"
                : "No batches match your filters"}
            </p>
            <p className="mt-2 max-w-md text-sm text-zinc-600">
              {data.stats.totalBatches === 0
                ? "Start by submitting harvest data from the farmer form."
                : "Try adjusting search, location, dates, or maturity filters."}
            </p>
            {data.stats.totalBatches === 0 ? (
              <Link
                href="/farmer"
                className="mt-6 text-sm font-semibold text-[#2e7d32] underline"
              >
                Open farmer intake
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Desktop table */}
        <div className="mt-6 hidden md:block overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-3">Batch ID</th>
                <th className="px-3 py-3">Farm</th>
                <th className="px-3 py-3">Harvest</th>
                <th className="px-3 py-3 text-right">Weight (kg)</th>
                <th className="px-3 py-3">Maturity</th>
                <th className="px-3 py-3 text-right">Quality</th>
                <th className="px-3 py-3">Market</th>
                <th className="px-3 py-3 text-right">Profit</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center text-zinc-500">
                    Loading…
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.recordId}
                    className="cursor-pointer border-b border-zinc-100 hover:bg-zinc-50"
                    onClick={() => router.push(`/batches/${row.recordId}`)}
                  >
                    <td className="px-3 py-3 font-mono text-xs text-sky-700">
                      <Link
                        href={`/batches/${row.recordId}`}
                        className="underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.batchId}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-zinc-900">
                        {row.farmName}
                      </div>
                      {row.farmSubtext ? (
                        <div className="text-xs text-zinc-500">
                          {row.farmSubtext}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-zinc-700">
                      {row.harvestTimeDisplay}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">
                      {row.weightKg ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {row.maturitySwatch ? (
                          <span
                            className="h-4 w-4 shrink-0 rounded border border-zinc-200"
                            style={{ background: row.maturitySwatch }}
                          />
                        ) : null}
                        <span>{row.maturityGrade ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <QualityCell row={row} qMin={qMin} />
                    </td>
                    <td className="px-3 py-3">
                      {row.evaluationPending ? (
                        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700">
                          Pending
                        </span>
                      ) : row.recommendedMarket ? (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900">
                          {row.recommendedMarket}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                      {row.expectedProfit != null
                        ? formatInr(row.expectedProfit)
                        : "—"}
                    </td>
                    <td className="px-3 py-3">
                      <StatusChip status={row.evaluationError ? "Error" : row.status} />
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-1">
                        <Link
                          href={`/batches/${row.recordId}`}
                          className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-50"
                        >
                          Details
                        </Link>
                        {row.status === "Evaluated" ? (
                          <button
                            type="button"
                            disabled={actionId === row.recordId}
                            onClick={() => markDispatched(row.recordId)}
                            className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            Mark dispatched
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="mt-6 space-y-3 md:hidden">
          {loading ? (
            <p className="text-center text-zinc-500 py-8">Loading…</p>
          ) : (
            rows.map((row) => (
              <button
                key={row.recordId}
                type="button"
                onClick={() => router.push(`/batches/${row.recordId}`)}
                className="w-full rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-semibold text-sky-800">
                      {row.batchId}
                    </p>
                    <p className="text-sm font-medium text-zinc-900">
                      {row.farmName}
                    </p>
                    <p className="text-xs text-zinc-500">{row.harvestTimeDisplay}</p>
                  </div>
                  <StatusChip status={row.evaluationError ? "Error" : row.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-600">
                  <div>
                    Weight:{" "}
                    <span className="font-mono text-zinc-900">
                      {row.weightKg ?? "—"} kg
                    </span>
                  </div>
                  <div className="text-right">
                    {row.evaluationPending ? (
                      <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-zinc-800">
                        Market pending
                      </span>
                    ) : (
                      <span className="text-violet-800">{row.recommendedMarket}</span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {pagination && pagination.total > 0 ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total}{" "}
              batches)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-medium hover:bg-zinc-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-medium hover:bg-zinc-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
