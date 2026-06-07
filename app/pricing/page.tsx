"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AgriDispatchLogo } from "../components/agri-dispatch-logo";

type Latest = {
  recordId: string;
  arrivalDay: string | null;
  arrivalRaw: unknown;
  modalPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  createdTime: string | null;
  cardStaleLevel: "ok" | "yesterday" | "stale";
  previousModalPrice: number | null;
};

type MarketCard = {
  id: string;
  marketName: string;
  location: string;
  commissionDisplay: string;
  latest: Latest | null;
};

type HistoryRow = {
  recordId: string;
  marketId: string;
  marketName: string;
  arrivalDay: string | null;
  modalPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  createdTime: string | null;
  isActive: boolean;
};

type Overview = {
  freshness: {
    level: string;
    headline: string;
    detail?: string;
  };
  markets: MarketCard[];
  history: HistoryRow[];
  historyRange: { from: string; to: string };
  timeZone: string;
};

function formatInrKg(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}/kg`;
}

function formatInrKgRange(
  min: number | null,
  max: number | null
): string {
  if (min == null || max == null) return "—";
  return `₹${min.toFixed(0)} — ₹${max.toFixed(0)}/kg`;
}

function formatTonnes(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })} t`;
}

function formatEnteredAt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export default function MarketPricingPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyMarketId, setHistoryMarketId] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyDays, setHistoryDays] = useState(7);
  const [toast, setToast] = useState<string | null>(null);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [autoFilling, setAutoFilling] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editMarket, setEditMarket] = useState<MarketCard | null>(null);
  const [formArrival, setFormArrival] = useState("");
  const [formModal, setFormModal] = useState("");
  const [formMin, setFormMin] = useState("");
  const [formMax, setFormMax] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (historyFrom) p.set("historyFrom", historyFrom);
    if (historyTo) p.set("historyTo", historyTo);
    if (!historyFrom && !historyTo) p.set("historyDays", String(historyDays));
    if (historyMarketId) p.set("historyMarketId", historyMarketId);
    return p.toString();
  }, [historyFrom, historyTo, historyDays, historyMarketId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/market-pricing?${qs}`);
      const json = (await res.json()) as Overview & { error?: string };
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
  }, [qs]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function openEdit(m: MarketCard) {
    setEditMarket(m);
    const l = m.latest;
    const today = new Date().toISOString().slice(0, 10);
    setFormArrival(l?.arrivalDay ?? today);
    setFormModal(l?.modalPrice != null ? String(l.modalPrice) : "");
    setFormMin(l?.minPrice != null ? String(l.minPrice) : "");
    setFormMax(l?.maxPrice != null ? String(l.maxPrice) : "");
    setFormError(null);
    setModalOpen(true);
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (!editMarket) return;
    setFormError(null);

    const minP = parseFloat(formMin);
    const maxP = parseFloat(formMax);
    const modalP = parseFloat(formModal);

    if (!Number.isFinite(minP) || !Number.isFinite(maxP) || !Number.isFinite(modalP)) {
      setFormError("All price fields are required.");
      return;
    }
    if (minP >= maxP) {
      setFormError("Min price must be less than max price.");
      return;
    }
    if (!(modalP > minP && modalP < maxP)) {
      setFormError("Modal price must be strictly between min and max.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/market-pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: editMarket.id,
          arrival_date: formArrival,
          modal_price: modalP,
          min_price: minP,
          max_price: maxP,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFormError(j.error ?? "Save failed");
        return;
      }
      setModalOpen(false);
      setToast(`Prices updated for ${editMarket.marketName}`);
      await load();
    } catch {
      setFormError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function fetchAgmarknet(marketAirtableId?: string) {
    setFetchingId(marketAirtableId ?? "ALL");
    try {
      const res = await fetch("/api/market-pricing/agmarknet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: marketAirtableId ? JSON.stringify({ marketAirtableId }) : "{}",
      });
      const j = (await res.json()) as {
        results?: { marketName: string; status: string; message?: string; modal?: number }[];
        error?: string;
      };
      if (!res.ok) {
        setToast(j.error ?? "Agmarknet fetch failed");
        return;
      }
      const results = j.results ?? [];
      const ok = results.filter((r) => r.status === "ok");
      const failed = results.filter((r) => r.status !== "ok");
      if (ok.length > 0) {
        const names = ok.map((r) => `${r.marketName} ₹${r.modal}/kg`).join(", ");
        setToast(`Updated: ${names}${failed.length > 0 ? ` · ${failed.length} failed` : ""}`);
      } else {
        const msg = failed.map((r) => r.message ?? r.status).join("; ");
        setToast(`No data fetched. ${msg}`);
      }
      await load();
    } catch {
      setToast("Network error fetching Agmarknet prices");
    } finally {
      setFetchingId(null);
    }
  }

  async function autoFillFromAgmarknet() {
    if (!editMarket) return;
    setAutoFilling(true);
    setFormError(null);
    try {
      const res = await fetch(
        `/api/market-pricing/agmarknet?marketAirtableId=${editMarket.id}`
      );
      const j = (await res.json()) as {
        result?: { min: number; max: number; modal: number; arrivalDay: string } | null;
        error?: string;
      };
      if (!j.result) {
        setFormError(j.error ?? "No Agmarknet data available for this market");
        return;
      }
      const r = j.result;
      setFormArrival(r.arrivalDay);
      setFormModal(String(r.modal));
      setFormMin(String(r.min));
      setFormMax(String(r.max));
    } catch {
      setFormError("Network error fetching Agmarknet data");
    } finally {
      setAutoFilling(false);
    }
  }

  const bannerBg =
    loading && !data
      ? "bg-zinc-600"
      : error || !data
        ? "bg-red-700"
        : data.freshness.level === "green"
          ? "bg-emerald-700"
          : data.freshness.level === "amber"
            ? "bg-amber-600"
            : "bg-red-700";

  const bestMarketId = useMemo(() => {
    if (!data) return null;
    let best: string | null = null;
    let bestPrice = -Infinity;
    for (const m of data.markets) {
      if (m.latest?.modalPrice != null && m.latest.modalPrice > bestPrice) {
        bestPrice = m.latest.modalPrice;
        best = m.id;
      }
    }
    return best;
  }, [data]);

  return (
    <div className="min-h-full bg-zinc-950 text-zinc-100">
      {/* Freshness banner */}
      <div className={`w-full text-white ${bannerBg} px-4 py-3 text-sm shadow-sm`}>
        <div className="mx-auto max-w-7xl">
          {loading && !data ? (
            <p className="opacity-90">Loading price freshness…</p>
          ) : error || !data ? (
            <p className="font-semibold">{error ?? "Could not load pricing data"}</p>
          ) : (
            <>
              <p className="font-semibold leading-snug">{data.freshness.headline}</p>
              {data.freshness.detail ? (
                <p className="mt-0.5 text-xs text-white/90">{data.freshness.detail}</p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Header — matches farmer page style */}
      <header className="shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-5 py-4">
        <div className="flex items-center gap-3">
          <AgriDispatchLogo className="h-9 w-9" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              AgriDispatch
            </p>
            <h1 className="text-base font-bold leading-tight tracking-tight text-zinc-100">
              Market Pricing
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchAgmarknet()}
            disabled={fetchingId !== null || loading}
            className="rounded-md border border-emerald-700/50 bg-emerald-900/20 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 transition-colors hover:border-emerald-600 hover:bg-emerald-900/40 disabled:opacity-50"
          >
            {fetchingId === "ALL" ? "Fetching…" : "Fetch all from Agmarknet"}
          </button>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <Link
            href="/batches"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Batches
          </Link>
          <Link
            href="/"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Home
          </Link>
          <span className="rounded-md border border-emerald-700/40 bg-emerald-900/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-400">
            Pricing
          </span>
        </div>
      </header>

      {error ? (
        <p className="mx-auto max-w-7xl px-4 py-4 text-sm text-red-400 sm:px-6">
          {error}
        </p>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 shadow-lg">
          {toast}
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Market cards */}
        <div className="grid gap-4 lg:grid-cols-3">
          {(data?.markets ?? []).map((m) => {
            const hasData = m.latest != null;
            const stale = m.latest?.cardStaleLevel;
            const isBest = m.id === bestMarketId;
            const modal = m.latest?.modalPrice ?? null;
            const prev = m.latest?.previousModalPrice ?? null;
            const delta = modal != null && prev != null ? modal - prev : null;
            return (
              <div
                key={m.id}
                className={`rounded-2xl border bg-zinc-900 p-5 ${
                  isBest
                    ? "border-emerald-700/60"
                    : hasData
                      ? "border-zinc-800"
                      : "border-2 border-dashed border-amber-700/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-zinc-100">{m.marketName}</h2>
                    {m.location ? (
                      <p className="text-xs text-zinc-500">{m.location}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isBest && hasData ? (
                      <span className="rounded-md bg-emerald-900/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400 border border-emerald-700/40">
                        Best
                      </span>
                    ) : null}
                    {hasData && stale !== "ok" ? (
                      <span
                        className="text-amber-500 text-sm"
                        title={stale === "yesterday" ? "Price data from yesterday" : "Stale price data"}
                      >
                        ⚠
                      </span>
                    ) : null}
                  </div>
                </div>

                {hasData && m.latest ? (
                  <div className="mt-4 rounded-xl bg-zinc-800/60 px-4 py-3">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-xs text-zinc-500 mb-0.5">Modal price</p>
                        <p className="font-mono text-2xl font-bold text-emerald-400">
                          {formatInrKg(m.latest.modalPrice)}
                        </p>
                      </div>
                      {delta !== null ? (
                        <span className={`mb-1 text-xs font-semibold font-mono ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-zinc-500"}`}>
                          {delta > 0 ? "▲" : delta < 0 ? "▼" : "—"} ₹{Math.abs(delta).toFixed(2)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="text-zinc-500">Range</span>
                      <span className="font-mono text-zinc-400">
                        {formatInrKgRange(m.latest.minPrice, m.latest.maxPrice)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-600">As of</span>
                      <span className="text-zinc-500">{m.latest.arrivalDay ?? "—"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-amber-700/50 bg-amber-950/20 px-4 py-3 text-center text-sm text-amber-500">
                    No price data yet
                  </div>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => fetchAgmarknet(m.id)}
                    disabled={fetchingId !== null}
                    className="flex-1 rounded-lg border border-emerald-700/50 bg-emerald-900/20 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-900/40 disabled:opacity-50"
                  >
                    {fetchingId === m.id ? "Fetching…" : "Fetch Agmarknet"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(m)}
                    className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700"
                  >
                    {hasData ? "Edit" : "Enter manually"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* History */}
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-zinc-100">Price history</h2>
              <p className="text-xs text-zinc-500">Append-only log · active row per market highlighted</p>
            </div>
            {/* Compact inline filters */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={historyMarketId}
                onChange={(e) => setHistoryMarketId(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
              >
                <option value="">All markets</option>
                {(data?.markets ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.marketName}</option>
                ))}
              </select>
              <select
                value={historyDays}
                onChange={(e) => {
                  setHistoryDays(Number(e.target.value));
                  setHistoryFrom("");
                  setHistoryTo("");
                }}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
              <input
                type="date"
                value={historyFrom}
                onChange={(e) => setHistoryFrom(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
                placeholder="From"
              />
              <input
                type="date"
                value={historyTo}
                onChange={(e) => setHistoryTo(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
                placeholder="To"
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900">
            <table className="min-w-[680px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-800/50 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3">Market</th>
                  <th className="px-4 py-3">Arrival date</th>
                  <th className="px-4 py-3 text-right">Modal (₹/kg)</th>
                  <th className="px-4 py-3 text-right">Range (₹/kg)</th>
                  <th className="px-4 py-3">Entered at</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                      Loading…
                    </td>
                  </tr>
                ) : (data?.history ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-zinc-500">
                      No records in this range.
                    </td>
                  </tr>
                ) : (
                  (data?.history ?? []).map((row) => (
                    <tr
                      key={row.recordId}
                      className={`border-b border-zinc-800 ${
                        row.isActive
                          ? "bg-emerald-950/40 ring-1 ring-inset ring-emerald-800/60"
                          : "hover:bg-zinc-800/40"
                      }`}
                    >
                      <td className="px-4 py-2.5 font-medium text-zinc-200">{row.marketName}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-zinc-400">
                        {row.arrivalDay ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-emerald-400">
                        {row.modalPrice != null ? `₹${row.modalPrice}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-zinc-400">
                        {formatInrKgRange(row.minPrice, row.maxPrice)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-zinc-500">
                        {formatEnteredAt(row.createdTime)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Modal */}
      {modalOpen && editMarket ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
            role="dialog"
            aria-labelledby="pricing-form-title"
          >
            <h2 id="pricing-form-title" className="text-lg font-bold text-zinc-100">
              Price entry — {editMarket.marketName}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              Creates a new Market_Pricing record (history preserved).
            </p>

            <div className="mt-4 rounded-xl border border-emerald-700/40 bg-emerald-950/30 p-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-500 mb-2">Recommended</p>
              <button
                type="button"
                onClick={autoFillFromAgmarknet}
                disabled={autoFilling}
                className="w-full rounded-xl bg-emerald-700 py-3 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {autoFilling ? "Fetching from Agmarknet…" : "Auto-fill from Agmarknet"}
              </button>
              <p className="mt-2 text-center text-xs text-zinc-500">
                Pulls today&apos;s live prices and fills the fields below for review before saving.
              </p>
            </div>

            <form onSubmit={submitForm} className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="text-zinc-400">Market</span>
                <select
                  disabled
                  value={editMarket.id}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-400"
                >
                  <option value={editMarket.id}>{editMarket.marketName}</option>
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-zinc-400">Arrival date</span>
                <input
                  type="date"
                  required
                  value={formArrival}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFormArrival(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200"
                />
              </label>

              <label className="block text-sm">
                <span className="text-zinc-400">Modal price (₹/kg)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  required
                  value={formModal}
                  onChange={(e) => setFormModal(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono text-zinc-200"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-zinc-400">Min (₹/kg)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    required
                    value={formMin}
                    onChange={(e) => setFormMin(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono text-zinc-200"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-400">Max (₹/kg)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    required
                    value={formMax}
                    onChange={(e) => setFormMax(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm font-mono text-zinc-200"
                  />
                </label>
              </div>

              {formError ? (
                <p className="text-sm text-red-400">{formError}</p>
              ) : null}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-xl border border-zinc-700 py-2.5 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Save new record"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
