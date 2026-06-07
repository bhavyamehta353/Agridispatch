"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FARMER_MATURITY_OPTIONS } from "../lib/maturity";
import { ORIGINS, originByName } from "../lib/origins";

const MATURITY_OPTIONS = FARMER_MATURITY_OPTIONS;
type MaturityValue = (typeof MATURITY_OPTIONS)[number]["value"];

type RecentBatch = {
  recordId: string;
  batchId: string;
  harvestTimeDisplay: string;
  weightKg: number | null;
  maturityGrade: string | null;
  maturitySwatch: string | null;
  status: string;
  evaluationError: boolean;
};

export default function FarmerPage() {
  const [originName, setOriginName] = useState<string>(ORIGINS[0].origin_name);
  const [harvestTime, setHarvestTime] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [maturity, setMaturity] = useState<MaturityValue>("Breaker");
  const [harvestMethod, setHarvestMethod] = useState("Mixed");
  const [packaging, setPackaging] = useState("Plastic Crate");
  const [fillLevel, setFillLevel] = useState("Medium");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [message, setMessage] = useState("");
  const [recentBatches, setRecentBatches] = useState<RecentBatch[]>([]);

  const selectedOrigin = useMemo(
    () => originByName(originName) ?? ORIGINS[0],
    [originName]
  );

  const fetchRecent = useCallback(async (farmOriginId: string) => {
    try {
      const qs = new URLSearchParams({ farmOriginId, pageSize: "3", page: "1" });
      const res = await fetch(`/api/batch-overview?${qs}`);
      if (!res.ok) return;
      const data = (await res.json()) as { rows?: RecentBatch[] };
      setRecentBatches(data.rows ?? []);
    } catch {
      setRecentBatches([]);
    }
  }, []);

  useEffect(() => {
    fetchRecent(selectedOrigin.farm_origin_id);
  }, [selectedOrigin.farm_origin_id, fetchRecent]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    const weight = parseInt(weightKg, 10);

    const payload = {
      origin_name: originName,
      harvest_time: new Date(harvestTime).toISOString(),
      weight_harvest_kg: weight,
      maturity_grade: maturity,
      harvest_method: harvestMethod,
      packaging_type: packaging,
      fill_level: fillLevel,
    };

    try {
      const res = await fetch("/api/farmer-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        error?: string;
        status?: string;
        batch_id?: string;
      };

      if (!res.ok) {
        setStatus("err");
        setMessage(data.error ?? "Something went wrong.");
        return;
      }

      setStatus("ok");
      setMessage(
        `Batch ${data.batch_id ?? "submitted"} — pipeline is now running.`
      );
      setOriginName(ORIGINS[0].origin_name);
      setHarvestTime("");
      setWeightKg("");
      setMaturity("Breaker");
      setHarvestMethod("Mixed");
      setPackaging("Plastic Crate");
      setFillLevel("Medium");
    } catch {
      setStatus("err");
      setMessage("Network error. Check your connection and try again.");
    }
  }

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-zinc-950 text-zinc-100"
      style={{ fontFamily: "var(--font-farmer-body), system-ui, sans-serif" }}
    >
      {/* ── Header ── */}
      <header className="shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-green-800/40 bg-green-900/20 text-lg">
            🌱
          </div>
          <div>
            <p
              className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
              style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
            >
              AgriDispatch
            </p>
            <h1
              className="text-base font-bold leading-tight tracking-tight text-zinc-100"
              style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
            >
              Harvest &amp; Handling
            </h1>
          </div>
        </div>
        <nav className="flex items-center gap-2">
          <a
            href="/"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Home
          </a>
          <a
            href="/batches"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Batches
          </a>
          <a
            href="/pricing"
            className="rounded-md border border-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-300"
          >
            Pricing
          </a>
          <span className="rounded-md border border-green-700/40 bg-green-900/10 px-3 py-1.5 text-[11px] font-semibold text-green-400">
            Intake
          </span>
        </nav>
      </header>

      {/* ── Main ── */}
      <main className="flex flex-1 flex-col gap-3 overflow-hidden px-5 py-4">
        <form onSubmit={onSubmit} className="flex flex-1 flex-col gap-3 overflow-hidden">

          {/* Two columns */}
          <div className="grid flex-1 grid-cols-2 gap-3 overflow-hidden">

            {/* ── Left panel: Location & Timing ── */}
            <div className="flex flex-col gap-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4">
              <div className="border-b border-zinc-800 pb-3">
                <p
                  className="text-base font-bold text-zinc-100"
                  style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
                >
                  Location &amp; Timing
                </p>
                <p
                  className="mt-1 text-xs text-zinc-500"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Identify your batch
                </p>
              </div>

              {/* Farm location */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="origin_name"
                  className="text-sm font-semibold text-zinc-300"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Farm location
                </label>
                <select
                  id="origin_name"
                  name="origin_name"
                  required
                  value={originName}
                  onChange={(e) => setOriginName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-600/20"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  {ORIGINS.map((o) => (
                    <option key={o.origin_id} value={o.origin_name}>
                      {o.origin_name}
                    </option>
                  ))}
                </select>
                <div
                  className="grid grid-cols-3 gap-2 rounded-lg border border-zinc-800/60 bg-zinc-950 px-3 py-2"
                  aria-live="polite"
                >
                  {[
                    { key: "Origin ID", val: selectedOrigin.origin_id },
                    { key: "Latitude", val: String(selectedOrigin.origin_lat) },
                    { key: "Longitude", val: String(selectedOrigin.origin_lng) },
                  ].map(({ key, val }) => (
                    <div key={key}>
                      <dt
                        className="text-[10px] uppercase tracking-wider text-zinc-600"
                        style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                      >
                        {key}
                      </dt>
                      <dd
                        className="text-xs text-zinc-400"
                        style={{ fontFamily: "var(--font-farmer-mono), monospace" }}
                      >
                        {val}
                      </dd>
                    </div>
                  ))}
                </div>
              </div>

              {/* Harvest time */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="harvest_time"
                  className="text-sm font-semibold text-zinc-300"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Harvest time
                </label>
                <input
                  id="harvest_time"
                  name="harvest_time"
                  type="datetime-local"
                  required
                  value={harvestTime}
                  onChange={(e) => setHarvestTime(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-600/20"
                  style={{ fontFamily: "var(--font-farmer-mono), monospace" }}
                />
              </div>

              {/* Weight */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="weight_harvest_kg"
                  className="text-sm font-semibold text-zinc-300"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Weight harvested (kg)
                </label>
                <input
                  id="weight_harvest_kg"
                  name="weight_harvest_kg"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  required
                  placeholder="e.g. 1200"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-600/20 placeholder:text-zinc-600"
                  style={{ fontFamily: "var(--font-farmer-mono), monospace" }}
                />
              </div>

              {/* Recent batches from this farm */}
              {recentBatches.length > 0 && (
                <div className="flex flex-1 flex-col gap-2 overflow-hidden">
                  <div className="flex items-center justify-between">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-widest text-zinc-600"
                      style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                    >
                      Recent from this farm
                    </span>
                    <a
                      href={`/batches?farmOriginId=${selectedOrigin.farm_origin_id}`}
                      className="text-[10px] text-zinc-600 transition hover:text-zinc-400"
                      style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                    >
                      View all →
                    </a>
                  </div>
                  <div className="flex flex-1 flex-col justify-between gap-1.5">
                    {recentBatches.map((b) => {
                      const displayStatus = b.evaluationError ? "Error" : b.status;
                      const chipClass =
                        displayStatus === "Dispatched"
                          ? "bg-emerald-900/30 text-emerald-400 border-emerald-800/40"
                          : displayStatus === "Evaluated"
                          ? "bg-sky-900/30 text-sky-400 border-sky-800/40"
                          : displayStatus === "Error"
                          ? "bg-red-900/30 text-red-400 border-red-800/40"
                          : "bg-zinc-800/60 text-zinc-500 border-zinc-700/40";
                      return (
                        <a
                          key={b.recordId}
                          href={`/batches/${b.recordId}`}
                          className="flex flex-1 items-center gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950 px-3 transition hover:border-zinc-700"
                        >
                          {b.maturitySwatch && (
                            <span
                              className="h-6 w-6 shrink-0 rounded"
                              style={{ background: b.maturitySwatch }}
                            />
                          )}
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <p
                              className="text-xs font-semibold text-zinc-300"
                              style={{ fontFamily: "var(--font-farmer-mono), monospace" }}
                            >
                              {b.batchId}
                            </p>
                            <p
                              className="truncate text-[11px] text-zinc-500"
                              style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                            >
                              {b.harvestTimeDisplay}
                              {b.weightKg != null ? ` · ${b.weightKg.toLocaleString()} kg` : ""}
                              {b.maturityGrade ? ` · ${b.maturityGrade}` : ""}
                            </p>
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${chipClass}`}
                            style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                          >
                            {displayStatus}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* ── Right panel: Crop & Packaging ── */}
            <div className="flex flex-col gap-4 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-4">
              <div className="border-b border-zinc-800 pb-3">
                <p
                  className="text-base font-bold text-zinc-100"
                  style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
                >
                  Crop &amp; Packaging
                </p>
                <p
                  className="mt-1 text-xs text-zinc-500"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Quality and handling
                </p>
              </div>

              {/* Maturity grade */}
              <div className="flex flex-col gap-2.5">
                <span
                  className="text-sm font-semibold text-zinc-300"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Maturity grade
                </span>
                <div
                  className="grid grid-cols-5 gap-2.5"
                  role="radiogroup"
                  aria-label="Maturity grade"
                >
                  {MATURITY_OPTIONS.map((opt) => {
                    const selected = maturity === opt.value;
                    return (
                      <label key={opt.value} className="flex cursor-pointer flex-col items-center gap-2">
                        <input
                          type="radio"
                          name="maturity_grade"
                          value={opt.value}
                          checked={selected}
                          onChange={() => setMaturity(opt.value)}
                          className="sr-only"
                          aria-label={opt.value}
                        />
                        <div
                          className={`h-10 w-full rounded-lg transition-all ${
                            selected
                              ? "ring-2 ring-green-500 ring-offset-2 ring-offset-zinc-900"
                              : "ring-1 ring-zinc-700/50 hover:ring-zinc-600"
                          }`}
                          style={{ background: opt.swatch }}
                          aria-hidden
                        />
                        <span
                          className={`text-[11px] leading-none ${
                            selected ? "font-semibold text-green-400" : "text-zinc-500"
                          }`}
                          style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                        >
                          {opt.value}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Harvest method */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="harvest_method"
                  className="text-sm font-semibold text-zinc-300"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Harvest method
                </label>
                <select
                  id="harvest_method"
                  name="harvest_method"
                  value={harvestMethod}
                  onChange={(e) => setHarvestMethod(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-600/20"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  <option value="Mixed">Mixed</option>
                  <option value="Selective">Selective</option>
                  <option value="Hand-picked">Hand-picked</option>
                </select>
              </div>

              {/* Packaging type */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="packaging_type"
                  className="text-sm font-semibold text-zinc-300"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Packaging type
                </label>
                <select
                  id="packaging_type"
                  name="packaging_type"
                  value={packaging}
                  onChange={(e) => setPackaging(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-green-600 focus:ring-2 focus:ring-green-600/20"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  <option value="Wooden Crate">Wooden Crate</option>
                  <option value="Plastic Crate">Plastic Crate</option>
                  <option value="Gunny Bag">Gunny Bag</option>
                </select>
              </div>

              {/* Fill level */}
              <div className="flex flex-col gap-2">
                <span
                  className="text-sm font-semibold text-zinc-300"
                  style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                >
                  Fill level
                </span>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Fill level">
                  {(["Low", "Medium", "High"] as const).map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setFillLevel(level)}
                      className={`rounded-lg py-2.5 text-sm font-semibold transition-all ${
                        fillLevel === level
                          ? "border border-green-700/40 bg-green-900/20 text-green-400"
                          : "border border-zinc-800 bg-zinc-950 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                      }`}
                      style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── Status message ── */}
          {message ? (
            <div
              role="status"
              className={`shrink-0 rounded-lg px-4 py-3 text-sm ${
                status === "ok"
                  ? "border border-green-800/50 bg-green-900/20 text-green-400"
                  : "border border-red-800/50 bg-red-900/20 text-red-400"
              }`}
              style={{ fontFamily: "var(--font-farmer-body), sans-serif" }}
            >
              {message}
            </div>
          ) : null}

          {/* ── Submit ── */}
          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full shrink-0 rounded-xl bg-gradient-to-r from-green-800 to-green-600 py-3.5 text-sm font-bold tracking-wide text-white shadow-lg shadow-green-900/30 transition hover:brightness-110 disabled:opacity-50"
            style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
          >
            {status === "loading" ? "Submitting…" : "Submit Batch →"}
          </button>

        </form>
      </main>
    </div>
  );
}
