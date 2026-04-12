"use client";

import { useMemo, useState } from "react";
import { FARMER_MATURITY_OPTIONS } from "../lib/maturity";
import { ORIGINS, originByName } from "../lib/origins";

const MATURITY_OPTIONS = FARMER_MATURITY_OPTIONS;

type MaturityValue = (typeof MATURITY_OPTIONS)[number]["value"];

function IconHarvest() {
  return (
    <svg
      className="h-6 w-6 shrink-0 text-farmer-green-light"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
      />
    </svg>
  );
}

function IconScale() {
  return (
    <svg
      className="h-6 w-6 shrink-0 text-farmer-green-light"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
      />
    </svg>
  );
}

function IconBox() {
  return (
    <svg
      className="h-6 w-6 shrink-0 text-farmer-accent-light"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function IconTag() {
  return (
    <svg
      className="h-6 w-6 shrink-0 text-farmer-green-light"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
      />
    </svg>
  );
}

function IconMapPin() {
  return (
    <svg
      className="h-6 w-6 shrink-0 text-farmer-green-light"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

export default function FarmerPage() {
  const [batchId, setBatchId] = useState("");
  const [originName, setOriginName] = useState<string>(ORIGINS[0].origin_name);
  const [harvestTime, setHarvestTime] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [maturity, setMaturity] = useState<MaturityValue>("Breaker");
  const [harvestMethod, setHarvestMethod] = useState("Mixed");
  const [packaging, setPackaging] = useState("Plastic Crate");
  const [fillLevel, setFillLevel] = useState("Medium");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "err">(
    "idle"
  );
  const [message, setMessage] = useState("");

  const selectedOrigin = useMemo(
    () => originByName(originName) ?? ORIGINS[0],
    [originName]
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    const weight = parseInt(weightKg, 10);
    const trimmedBatchId = batchId.trim();
    const batchPayload =
      /^\d+$/.test(trimmedBatchId) ? parseInt(trimmedBatchId, 10) : trimmedBatchId;

    const payload = {
      batch_id: batchPayload,
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
        hint?: string;
        batchRecordId?: string;
      };

      if (!res.ok) {
        setStatus("err");
        const parts = [
          data.error ?? "Something went wrong.",
          data.batchRecordId
            ? `Batch record id: ${data.batchRecordId}`
            : null,
          data.hint ?? null,
        ].filter(Boolean);
        setMessage(parts.join(" "));
        return;
      }

      setStatus("ok");
      setMessage("Saved to Airtable. You can submit another batch.");
      setBatchId("");
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
      className="min-h-full bg-farmer-cream text-farmer-muted"
      style={{
        fontFamily: "var(--font-farmer-body), system-ui, sans-serif",
      }}
    >
      <header className="bg-farmer-green text-white shadow-md">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <p className="text-sm font-medium uppercase tracking-wider text-white/80">
            Digital twin
          </p>
          <h1
            className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl"
            style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
          >
            Harvest &amp; handling
          </h1>
          <p className="mt-2 max-w-xl text-sm text-white/90">
            Record your batch, harvest, and how the crop is packed. Data is sent
            securely to Airtable.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <form onSubmit={onSubmit} className="space-y-6">
          <section
            className="rounded-2xl border border-farmer-earth-light bg-white p-5 shadow-sm sm:p-6"
            aria-labelledby="harvest-heading"
          >
            <div className="flex items-start gap-3">
              <IconHarvest />
              <div>
                <h2
                  id="harvest-heading"
                  className="text-lg font-bold text-farmer-green"
                  style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
                >
                  Harvest
                </h2>
                <p className="mt-0.5 text-sm text-farmer-earth">
                  Identify your batch and record what came from the field.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="batch_id"
                  className="flex items-center gap-2 text-sm font-medium text-farmer-earth"
                >
                  <IconTag />
                  Batch ID
                </label>
                <input
                  id="batch_id"
                  name="batch_id"
                  type="text"
                  required
                  autoComplete="off"
                  placeholder="e.g. B-2026-0142 or your farm code"
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-farmer-earth-light bg-farmer-cream/50 px-3 py-3 text-farmer-muted outline-none ring-farmer-green-light focus:ring-2"
                  style={{
                    fontFamily: "var(--font-farmer-mono), ui-monospace, monospace",
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="origin_name"
                  className="flex items-center gap-2 text-sm font-medium text-farmer-earth"
                >
                  <IconMapPin />
                  Farm location
                </label>
                <select
                  id="origin_name"
                  name="origin_name"
                  required
                  value={originName}
                  onChange={(e) => setOriginName(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-farmer-earth-light bg-farmer-cream/50 px-3 py-3 text-farmer-muted outline-none ring-farmer-green-light focus:ring-2"
                >
                  {ORIGINS.map((o) => (
                    <option key={o.origin_id} value={o.origin_name}>
                      {o.origin_name}
                    </option>
                  ))}
                </select>
                <div
                  className="mt-2 rounded-xl border border-farmer-earth-light/80 bg-farmer-cream/40 px-3 py-2.5 text-xs text-farmer-earth"
                  aria-live="polite"
                >
                  <p className="font-medium text-farmer-muted">Saved with batch</p>
                  <dl className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-3 sm:gap-x-3">
                    <div>
                      <dt className="text-farmer-earth/80">Origin ID</dt>
                      <dd
                        className="font-mono text-farmer-muted"
                        style={{
                          fontFamily:
                            "var(--font-farmer-mono), ui-monospace, monospace",
                        }}
                      >
                        {selectedOrigin.origin_id}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-farmer-earth/80">Latitude</dt>
                      <dd
                        className="font-mono text-farmer-muted"
                        style={{
                          fontFamily:
                            "var(--font-farmer-mono), ui-monospace, monospace",
                        }}
                      >
                        {selectedOrigin.origin_lat}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-farmer-earth/80">Longitude</dt>
                      <dd
                        className="font-mono text-farmer-muted"
                        style={{
                          fontFamily:
                            "var(--font-farmer-mono), ui-monospace, monospace",
                        }}
                      >
                        {selectedOrigin.origin_lng}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div>
                <label
                  htmlFor="harvest_time"
                  className="block text-sm font-medium text-farmer-earth"
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
                  className="mt-1.5 w-full rounded-xl border border-farmer-earth-light bg-farmer-cream/50 px-3 py-3 text-farmer-muted outline-none ring-farmer-green-light focus:ring-2"
                  style={{
                    fontFamily: "var(--font-farmer-mono), ui-monospace, monospace",
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="weight_harvest_kg"
                  className="flex items-center gap-2 text-sm font-medium text-farmer-earth"
                >
                  <IconScale />
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
                  className="mt-1.5 w-full rounded-xl border border-farmer-earth-light bg-farmer-cream/50 px-3 py-3 text-farmer-muted outline-none ring-farmer-green-light focus:ring-2"
                  style={{
                    fontFamily: "var(--font-farmer-mono), ui-monospace, monospace",
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="harvest_method"
                  className="block text-sm font-medium text-farmer-earth"
                >
                  Harvest method
                </label>
                <select
                  id="harvest_method"
                  name="harvest_method"
                  value={harvestMethod}
                  onChange={(e) => setHarvestMethod(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-farmer-earth-light bg-farmer-cream/50 px-3 py-3 text-farmer-muted outline-none ring-farmer-green-light focus:ring-2"
                >
                  <option value="Mixed">Mixed</option>
                  <option value="Selective">Selective</option>
                  <option value="Hand-picked">Hand-picked</option>
                </select>
              </div>

              <div>
                <span
                  id="maturity_label"
                  className="block text-sm font-medium text-farmer-earth"
                >
                  Maturity grade
                </span>
                <div
                  className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5"
                  role="radiogroup"
                  aria-labelledby="maturity_label"
                >
                  {MATURITY_OPTIONS.map((opt) => {
                    const selected = maturity === opt.value;
                    return (
                      <label key={opt.value} className="cursor-pointer">
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
                          className={`aspect-square w-full rounded-xl shadow-sm transition-all ${
                            selected
                              ? "ring-4 ring-farmer-green ring-offset-2 ring-offset-white"
                              : "ring-2 ring-farmer-earth-light/80 hover:ring-farmer-green-light/70"
                          }`}
                          style={{ background: opt.swatch }}
                          aria-hidden
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section
            className="rounded-2xl border border-farmer-earth-light bg-white p-5 shadow-sm sm:p-6"
            aria-labelledby="handling-heading"
          >
            <div className="flex items-start gap-3">
              <IconBox />
              <div>
                <h2
                  id="handling-heading"
                  className="text-lg font-bold text-farmer-accent"
                  style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
                >
                  Handling
                </h2>
                <p className="mt-0.5 text-sm text-farmer-earth">
                  How the harvest is packed before it moves downstream.
                </p>
              </div>
            </div>

            <div className="mt-6 space-y-5">
              <div>
                <label
                  htmlFor="packaging_type"
                  className="block text-sm font-medium text-farmer-earth"
                >
                  Packaging type
                </label>
                <select
                  id="packaging_type"
                  name="packaging_type"
                  value={packaging}
                  onChange={(e) => setPackaging(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-farmer-earth-light bg-farmer-cream/50 px-3 py-3 text-farmer-muted outline-none ring-farmer-accent-light focus:ring-2"
                >
                  <option value="Wooden Crate">Wooden Crate</option>
                  <option value="Plastic Crate">Plastic Crate</option>
                  <option value="Gunny Bag">Gunny Bag</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="fill_level"
                  className="block text-sm font-medium text-farmer-earth"
                >
                  Fill level
                </label>
                <select
                  id="fill_level"
                  name="fill_level"
                  value={fillLevel}
                  onChange={(e) => setFillLevel(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-farmer-earth-light bg-farmer-cream/50 px-3 py-3 text-farmer-muted outline-none ring-farmer-accent-light focus:ring-2"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>
          </section>

          {message ? (
            <div
              role="status"
              className={`rounded-xl px-4 py-3 text-sm ${
                status === "ok"
                  ? "bg-farmer-green-light/15 text-farmer-green"
                  : "bg-red-50 text-red-800"
              }`}
            >
              {message}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full rounded-2xl bg-linear-to-r from-farmer-accent to-farmer-accent-light py-4 text-base font-bold text-white shadow-lg transition-opacity hover:opacity-95 disabled:opacity-60"
            style={{ fontFamily: "var(--font-farmer-heading), sans-serif" }}
          >
            {status === "loading" ? "Saving…" : "Submit to Airtable"}
          </button>
        </form>
      </main>

      <footer className="border-t border-farmer-earth-light bg-white/80 py-6 text-center text-xs text-farmer-earth">
        Your Batch ID is stored on the batch row; handling is linked to that
        record in Airtable.
      </footer>
    </div>
  );
}
