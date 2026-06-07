"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PricingFreshnessBanner } from "../components/pricing-freshness-banner";
import { FARMER_MATURITY_OPTIONS } from "../lib/maturity";
import { ORIGINS } from "../lib/origins";
import { AgriDispatchLogo } from "../components/agri-dispatch-logo";

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
      <span className={`${base} bg-emerald-900/60 text-emerald-400 ring-1 ring-emerald-700/40`}>
        Dispatched
      </span>
    );
  if (status === "Evaluated")
    return (
      <span className={`${base} bg-sky-900/40 text-sky-400 ring-1 ring-sky-700/40`}>Evaluated</span>
    );
  if (status === "Error")
    return <span className={`${base} bg-red-900/40 text-red-400 ring-1 ring-red-700/40`}>Error</span>;
  return (
    <span className={`${base} bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700`}>Submitted</span>
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
      <span className="text-amber-400 text-sm flex items-center gap-1">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
        Computing…
      </span>
    );
  }
  if (row.qualityPacked == null) {
    return <span className="text-zinc-600">—</span>;
  }
  const q = row.qualityPacked;
  const pct = Math.round(Math.min(1, Math.max(0, q)) * 100);
  const color =
    q >= 0.8 ? "bg-emerald-500" : q >= 0.65 ? "bg-amber-500" : "bg-red-500";
  const labelColor =
    q >= 0.8 ? "text-emerald-400" : q >= 0.65 ? "text-amber-400" : "text-red-400";
  return (
    <div className="flex flex-col items-end gap-1 min-w-[7rem]">
      <div
        className="flex h-2 w-full max-w-[120px] overflow-hidden rounded bg-zinc-700"
        title={q < qMin ? "Below minimum quality threshold" : undefined}
      >
        <div
          className={`${color} h-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`font-mono text-sm tabular-nums ${labelColor} inline-flex items-center gap-1`}>
        {q < qMin ? (
          <span className="text-red-400" aria-label="Below quality threshold">⚠</span>
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
  const [toast, setToast] = useState<{ msg: string; type: "error" | "ok" } | null>(null);

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

  const pendingCount = useMemo(
    () => rows.filter((r) => !r.evaluationPending && r.status === "Submitted" && !r.evaluationError).length,
    [rows]
  );

  const hasActiveFilters =
    search.trim() !== "" ||
    farmOriginId !== "All" ||
    statusFilter !== "All" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    maturityPick.size > 0;

  function clearFilters() {
    setSearch("");
    setFarmOriginId("All");
    setStatusFilter("All");
    setDateFrom("");
    setDateTo("");
    setMaturityPick(new Set());
    setPage(1);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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
        setToast({ msg: j.error ?? "Update failed", type: "error" });
        return;
      }
      setToast({ msg: "Batch marked as dispatched", type: "ok" });
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
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      <PricingFreshnessBanner />

      {/* Header — matches farmer/pricing page style */}
      <header className="shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-5 py-4">
        <div className="flex items-center gap-3">
          <AgriDispatchLogo className="h-9 w-9" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              AgriDispatch
            </p>
            <h1 className="text-base font-bold leading-tight tracking-tight text-zinc-100">
              Batch Overview
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <Link
            href="/"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Home
          </Link>
          <Link
            href="/pricing"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Pricing
          </Link>
          <Link
            href="/farmer"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Intake
          </Link>
          <span className="rounded-md border border-emerald-700/40 bg-emerald-900/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400">
            Batches
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Total batches</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">
              {stats?.totalBatches ?? "—"}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Dispatched</p>
            <div className="mt-1 flex items-end gap-2">
              <p className="text-2xl font-bold tabular-nums text-emerald-400">
                {stats?.dispatched ?? "—"}
              </p>
              {stats != null && stats.totalBatches > 0 ? (
                <p className="mb-0.5 text-sm text-zinc-500">
                  / {stats.totalBatches} ({Math.round((stats.dispatched / stats.totalBatches) * 100)}%)
                </p>
              ) : null}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Avg quality (packed)</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-zinc-100">
              {stats?.avgQualityPacked != null ? stats.avgQualityPacked.toFixed(2) : "—"}
            </p>
          </div>
        </div>

        {/* Pipeline health */}
        {pendingCount > 0 ? (
          <p className="mt-3 text-xs text-amber-400">
            {pendingCount} batch{pendingCount > 1 ? "es" : ""} submitted but awaiting evaluation
          </p>
        ) : null}

        {/* Filters */}
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <label className="block text-sm">
              <span className="text-zinc-400">Search batch ID</span>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
                placeholder="BATCH001"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-400">Farm location</span>
              <select
                value={farmOriginId}
                onChange={(e) => { setFarmOriginId(e.target.value); setPage(1); }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
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
              <span className="text-zinc-400">Pipeline status</span>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="All">All</option>
                <option value="Pending">Pending</option>
                <option value="Evaluated">Evaluated</option>
                <option value="Dispatched">Dispatched</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-zinc-400">Harvest from</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
              />
            </label>
            <label className="block text-sm">
              <span className="text-zinc-400">Harvest to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
              />
            </label>
          </div>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div className="flex-1">
              <span className="text-sm text-zinc-400">Maturity grade</span>
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
                          ? "border-emerald-600 bg-emerald-900/20 text-emerald-400 ring-1 ring-emerald-700/40"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      <span
                        className="h-4 w-4 rounded border border-zinc-700"
                        style={{ background: opt.swatch }}
                      />
                      {opt.value}
                    </button>
                  );
                })}
              </div>
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:border-zinc-600 hover:text-zinc-200 transition-colors"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>

        {error ? (
          <p className="mt-6 rounded-lg border border-red-800/40 bg-red-950/30 px-4 py-3 text-sm text-red-400">
            {error}
          </p>
        ) : null}

        {toast ? (
          <div className={`fixed bottom-4 right-4 z-50 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            toast.type === "error"
              ? "border-red-800/40 bg-zinc-900 text-red-400"
              : "border-zinc-700 bg-zinc-800 text-zinc-100"
          }`}>
            {toast.msg}
          </div>
        ) : null}

        {!loading && rows.length === 0 && data ? (
          <div className="mt-8 flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 px-6 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-800">
              <svg className="h-6 w-6 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
              </svg>
            </div>
            <p className="mt-4 text-lg font-semibold text-zinc-200">
              {data.stats.totalBatches === 0 ? "No batches yet" : "No batches match your filters"}
            </p>
            <p className="mt-2 max-w-md text-sm text-zinc-500">
              {data.stats.totalBatches === 0
                ? "Start by submitting harvest data from the farmer intake form."
                : "Try adjusting search, location, dates, or maturity filters."}
            </p>
            {data.stats.totalBatches === 0 ? (
              <Link href="/farmer" className="mt-6 text-sm font-semibold text-emerald-400 underline underline-offset-2">
                Open farmer intake
              </Link>
            ) : null}
          </div>
        ) : null}

        {/* Desktop table */}
        <div className="mt-6 hidden md:block overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
          <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-800/50 text-xs uppercase tracking-wide text-zinc-500">
                <th className="px-3 py-3">Batch ID</th>
                <th className="px-3 py-3">Farm</th>
                <th className="px-3 py-3">Harvest</th>
                <th className="px-3 py-3 text-right">Weight (kg)</th>
                <th className="px-3 py-3">Maturity</th>
                <th className="px-3 py-3 text-right">Quality</th>
                <th className="px-3 py-3">Market</th>
                <th className="px-3 py-3 text-right">Profit</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-zinc-500">
                    Loading…
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.recordId}
                    className="cursor-pointer border-b border-zinc-800 hover:bg-zinc-800/40"
                    onClick={() => router.push(`/batches/${row.recordId}`)}
                  >
                    <td className="px-3 py-3 font-mono text-xs text-emerald-400">
                      <Link
                        href={`/batches/${row.recordId}`}
                        className="underline-offset-2 hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {row.batchId}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-zinc-200">{row.farmName}</div>
                      {row.farmSubtext ? (
                        <div className="text-xs text-zinc-500">{row.farmSubtext}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-zinc-400">
                      {row.harvestTimeDisplay}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-zinc-300">
                      {row.weightKg ?? "—"}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {row.maturitySwatch ? (
                          <span
                            className="h-4 w-4 shrink-0 rounded border border-zinc-700"
                            style={{ background: row.maturitySwatch }}
                          />
                        ) : null}
                        <span className="text-zinc-300">{row.maturityGrade ?? "—"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <QualityCell row={row} qMin={qMin} />
                    </td>
                    <td className="px-3 py-3">
                      {row.evaluationPending ? (
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-400">
                          Pending
                        </span>
                      ) : row.recommendedMarket ? (
                        <span className="rounded-full bg-violet-900/40 px-2 py-0.5 text-xs font-medium text-violet-400 ring-1 ring-violet-700/40">
                          {row.recommendedMarket}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-sm tabular-nums text-zinc-300">
                      {row.expectedProfit != null ? formatInr(row.expectedProfit) : "—"}
                    </td>
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <StatusChip status={row.evaluationError ? "Error" : row.status} />
                        {row.status === "Evaluated" ? (
                          <button
                            type="button"
                            disabled={actionId === row.recordId}
                            onClick={() => markDispatched(row.recordId)}
                            className="rounded bg-emerald-700 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            {actionId === row.recordId ? "Saving…" : "Mark dispatched"}
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
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm font-semibold text-emerald-400">
                      {row.batchId}
                    </p>
                    <p className="text-sm font-medium text-zinc-200">{row.farmName}</p>
                    <p className="text-xs text-zinc-500">{row.harvestTimeDisplay}</p>
                  </div>
                  <StatusChip status={row.evaluationError ? "Error" : row.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
                  <div>
                    Weight:{" "}
                    <span className="font-mono text-zinc-300">{row.weightKg ?? "—"} kg</span>
                  </div>
                  <div className="text-right">
                    {row.evaluationPending ? (
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                        Market pending
                      </span>
                    ) : (
                      <span className="text-violet-400">{row.recommendedMarket}</span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {pagination && pagination.total > 0 ? (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-500">
            <span>
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} batches)
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-zinc-300 font-medium hover:bg-zinc-700 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-zinc-300 font-medium hover:bg-zinc-700 disabled:opacity-40"
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
