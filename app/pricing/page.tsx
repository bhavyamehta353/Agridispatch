"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Latest = {
  recordId: string;
  arrivalDay: string | null;
  arrivalRaw: unknown;
  modalPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  createdTime: string | null;
  cardStaleLevel: "ok" | "yesterday" | "stale";
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
        result?: {
          min: number;
          max: number;
          modal: number;
          arrivalDay: string;
        } | null;
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

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      {/* Freshness banner */}
      <div
        className={`w-full text-white ${bannerBg} px-4 py-4 shadow-md sm:px-6`}
      >
        <div className="mx-auto max-w-7xl">
          {loading && !data ? (
            <p className="text-sm opacity-90">Loading price freshness…</p>
          ) : error || !data ? (
            <p className="font-semibold">
              {error ?? "Could not load pricing data"}
            </p>
          ) : (
            <>
              <p className="text-lg font-semibold">{data.freshness.headline}</p>
              {data.freshness.detail ? (
                <p className="mt-1 text-sm text-white/90">
                  {data.freshness.detail}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">
              APMC data
            </p>
            <h1 className="text-2xl font-bold tracking-tight">
              Market pricing panel
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              Manual daily prices for three markets. Append-only history for
              audit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fetchAgmarknet()}
              disabled={fetchingId !== null || loading}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sky-700 disabled:opacity-50"
            >
              {fetchingId === "ALL" ? "Fetching…" : "Fetch all from Agmarknet"}
            </button>
            <button
              type="button"
              onClick={() => load()}
              disabled={loading}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <Link
              href="/batches"
              className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:underline"
            >
              Batch overview
            </Link>
            <Link href="/" className="rounded-lg px-4 py-2 text-sm text-zinc-600 hover:underline">
              Home
            </Link>
          </div>
        </div>
      </header>

      {error ? (
        <p className="mx-auto max-w-7xl px-4 py-4 text-sm text-red-700 sm:px-6">
          {error}
        </p>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-zinc-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        {/* Market cards */}
        <div className="grid gap-4 lg:grid-cols-3">
          {(data?.markets ?? []).map((m) => {
            const hasData = m.latest != null;
            const stale = m.latest?.cardStaleLevel;
            return (
              <div
                key={m.id}
                className={`rounded-2xl border bg-white p-5 shadow-sm ${
                  hasData
                    ? "border-zinc-200"
                    : "border-dashed border-amber-400/60 border-2"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-zinc-900">
                      {m.marketName}
                    </h2>
                    {m.location ? (
                      <p className="text-sm text-zinc-500">{m.location}</p>
                    ) : null}
                  </div>
                  {hasData && stale !== "ok" ? (
                    <span
                      className="text-amber-600"
                      title={
                        stale === "yesterday"
                          ? "Price data from yesterday"
                          : "Stale price data"
                      }
                    >
                      ⚠
                    </span>
                  ) : null}
                </div>

                {hasData && m.latest ? (
                  <div className="mt-4 space-y-1.5 rounded-xl bg-zinc-50 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Modal price</span>
                      <span className="font-mono font-semibold text-zinc-900">
                        {formatInrKg(m.latest.modalPrice)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-500">Range</span>
                      <span className="font-mono text-zinc-700">
                        {formatInrKgRange(m.latest.minPrice, m.latest.maxPrice)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">As of</span>
                      <span className="text-zinc-500">{m.latest.arrivalDay ?? "—"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm text-amber-800">
                    No price data yet
                  </div>
                )}

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => fetchAgmarknet(m.id)}
                    disabled={fetchingId !== null}
                    className="flex-1 rounded-xl bg-sky-600 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                  >
                    {fetchingId === m.id ? "Fetching…" : "Fetch Agmarknet"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(m)}
                    className="flex-1 rounded-xl border border-zinc-300 bg-white py-2 text-sm font-medium hover:bg-zinc-50"
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
          <h2 className="text-lg font-bold text-zinc-900">Price history</h2>
          <p className="text-sm text-zinc-600">
            Append-only log. Active row for each market is highlighted.
          </p>

          <div className="mt-4 flex flex-wrap gap-3 rounded-xl border border-zinc-200 bg-white p-4">
            <label className="text-sm">
              <span className="text-zinc-600">Market</span>
              <select
                value={historyMarketId}
                onChange={(e) => setHistoryMarketId(e.target.value)}
                className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="">All markets</option>
                {(data?.markets ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.marketName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-zinc-600">From</span>
              <input
                type="date"
                value={historyFrom}
                onChange={(e) => setHistoryFrom(e.target.value)}
                className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-zinc-600">To</span>
              <input
                type="date"
                value={historyTo}
                onChange={(e) => setHistoryTo(e.target.value)}
                className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-zinc-600">Quick range</span>
              <select
                value={historyDays}
                onChange={(e) => {
                  setHistoryDays(Number(e.target.value));
                  setHistoryFrom("");
                  setHistoryTo("");
                }}
                className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </label>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <table className="min-w-[900px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <th className="px-3 py-3">Market</th>
                  <th className="px-3 py-3">Arrival date</th>
                  <th className="px-3 py-3 text-right">Modal (₹/kg)</th>
                  <th className="px-3 py-3 text-right">Min (₹/kg)</th>
                  <th className="px-3 py-3 text-right">Max (₹/kg)</th>
                  <th className="px-3 py-3">Entered at</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                      Loading…
                    </td>
                  </tr>
                ) : (data?.history ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                      No records in this range.
                    </td>
                  </tr>
                ) : (
                  (data?.history ?? []).map((row) => (
                    <tr
                      key={row.recordId}
                      className={`border-b border-zinc-100 ${
                        row.isActive
                          ? "bg-emerald-50/80 ring-1 ring-inset ring-emerald-200"
                          : ""
                      }`}
                    >
                      <td className="px-3 py-2 font-medium">{row.marketName}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {row.arrivalDay ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {row.modalPrice ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {row.minPrice ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">
                        {row.maxPrice ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-600">
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
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-labelledby="pricing-form-title"
          >
            <h2 id="pricing-form-title" className="text-lg font-bold">
              Price entry — {editMarket.marketName}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Creates a new Market_Pricing record (history preserved).
            </p>

            <div className="mt-4">
              <button
                type="button"
                onClick={autoFillFromAgmarknet}
                disabled={autoFilling}
                className="w-full rounded-xl border border-sky-300 bg-sky-50 py-2.5 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50"
              >
                {autoFilling ? "Fetching from Agmarknet…" : "Auto-fill from Agmarknet"}
              </button>
              <p className="mt-1.5 text-center text-xs text-zinc-500">
                Fetches latest Agmarknet data and populates the fields below for review.
              </p>
            </div>

            <form onSubmit={submitForm} className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="text-zinc-600">Market</span>
                <select
                  disabled
                  value={editMarket.id}
                  className="mt-1 w-full rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm"
                >
                  <option value={editMarket.id}>{editMarket.marketName}</option>
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-zinc-600">Arrival date</span>
                <input
                  type="date"
                  required
                  value={formArrival}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setFormArrival(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
                />
              </label>

              <label className="block text-sm">
                <span className="text-zinc-600">Modal price (₹/kg)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  required
                  value={formModal}
                  onChange={(e) => setFormModal(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-zinc-600">Min (₹/kg)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    required
                    value={formMin}
                    onChange={(e) => setFormMin(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-zinc-600">Max (₹/kg)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    required
                    value={formMax}
                    onChange={(e) => setFormMax(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm font-mono"
                  />
                </label>
              </div>

              {formError ? (
                <p className="text-sm text-red-700">{formError}</p>
              ) : null}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-xl border border-zinc-300 py-2.5 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-xl bg-[#2e7d32] py-2.5 text-sm font-semibold text-white disabled:opacity-50"
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
