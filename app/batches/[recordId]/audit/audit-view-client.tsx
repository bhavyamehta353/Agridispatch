"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

type AuditPayload = {
  qMin: number;
  review: { flagged: boolean; note: string | null };
  identity: {
    batchId: string;
    recordId: string;
    farmName: string;
    farmOriginId: string | null;
    farmCoords: string | null;
    harvestTime: string | null;
    status: string;
    evaluationTimestamp: string | null;
  };
  pipeline: {
    submitted: { complete: boolean; at: string | null };
    qualityComputed: {
      complete: boolean;
      at: string | null;
      warnBelowQMin: boolean;
    };
    evaluated: { complete: boolean; at: string | null };
    dispatched: { complete: boolean; at: string | null };
  };
  harvest: {
    batchId: string;
    farmOriginId: string | null;
    farmDisplay: string;
    farmCoords: string | null;
    harvestTime: string | null;
    weightKg: number;
    maturityGrade: string | null;
    maturitySwatch: string | null;
    harvestMethod: string | null;
    qualityInitial: number | null;
  };
  handling: {
    packagingType: string | null;
    fillLevel: string | null;
    damageFactor: number;
    sortingBonus: number;
    highDamageNote: boolean;
  };
  quality: {
    notComputed: boolean;
    qualityInitial: number | null;
    damageFactor: number;
    sortingBonus: number;
    qualityPacked: number | null;
    kMultiplier: number;
    formulaResult: number | null;
    feasible: boolean;
  };
  routes: {
    marketId: string;
    marketName: string;
    distanceKm: number;
    tBaseHr: number;
    tau: number | null;
    tauSource: string;
    effectiveTravelHr: number;
    congestion: string;
    logisticsCost: number;
    logisticsFormula: {
      perKm: number;
      timeComponent: number;
      fixed: number;
      tauUsed: number;
    };
  }[];
  environment: {
    marketId: string;
    marketName: string;
    temperatureC: number | null;
    humidityPct: number | null;
    decayRiskScore: number | null;
    decayLevel: string;
    decayHigh: boolean;
    recordUpdatedAt: string | null;
  }[];
  pricing: {
    marketId: string;
    marketName: string;
    recordId: string | null;
    arrivalDay: string | null;
    modalPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
    sourceLabel: string;
    staleAtEval: boolean;
    staleDaysAtEval: number | null;
  }[];
  pricingSummary: {
    anyStaleAtEval: boolean;
    maxStaleDaysAtEval: number | null;
  };
  evaluation: {
    hasEvaluation: boolean;
    rows: {
      marketId: string;
      marketName: string;
      grossRevenue: number | null;
      commissionRate: number;
      commissionAmount: number | null;
      netRevenue: number | null;
      logisticsCost: number;
      expectedProfit: number | null;
      feasible: boolean;
      /** Row highlight: true if Airtable recommended or fallback winner. */
      recommended: boolean;
      /** Raw Market_Evaluation `recommended` field; null if no row or unset. */
      recommendedAirtable: boolean | null;
    }[];
    summary: {
      recommendedMarket: string;
      expectedProfit: number | null;
      marginOverNext: number | null;
      evaluationTimestamp: string | null;
    };
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

function formatShortTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-base font-semibold uppercase tracking-wide text-zinc-500">
      {children}
    </h2>
  );
}

function Step({
  label,
  complete,
  warn,
  at,
}: {
  label: string;
  complete: boolean;
  warn?: boolean;
  at: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
          complete
            ? warn
              ? "bg-amber-500 text-white"
              : "bg-emerald-600 text-white"
            : "border-2 border-dashed border-zinc-300 bg-white text-zinc-400"
        }`}
      >
        {complete ? (warn ? "!" : "✓") : ""}
      </div>
      <p className="text-xs font-medium text-zinc-800">{label}</p>
      <p className="text-[10px] text-zinc-500">{at ? formatShortTs(at) : "—"}</p>
    </div>
  );
}

export function AuditViewClient({ recordId }: { recordId: string }) {
  const [data, setData] = useState<AuditPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flagOpen, setFlagOpen] = useState(false);
  const [flagNote, setFlagNote] = useState("");
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/batches/${recordId}/audit`);
      const json = (await res.json()) as AuditPayload & { error?: string };
      if (!res.ok) {
        setData(null);
        setLoadError(json.error ?? "Failed to load audit data.");
        return;
      }
      setData(json);
    } catch {
      setData(null);
      setLoadError("Network error.");
    }
  }, [recordId]);

  useEffect(() => {
    load();
  }, [load]);

  const rerun = async () => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/batches/${recordId}/evaluate`, {
        method: "POST",
      });
      const json = (await res.json()) as { message?: string; ok?: boolean };
      if (res.status === 501) {
        setActionMsg(json.message ?? "Evaluation trigger not connected yet.");
      } else if (!res.ok) {
        setActionMsg(json.message ?? "Request failed.");
      } else {
        setActionMsg("Evaluation requested.");
        await load();
      }
    } catch {
      setActionMsg("Network error.");
    } finally {
      setActionBusy(false);
    }
  };

  const submitFlag = async () => {
    setActionBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/batches/${recordId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flag_for_review: true,
          review_note: flagNote.trim() || undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setActionMsg(
          json.error ??
            "Could not save flag. Add flag_for_review / review_note fields in Airtable if missing."
        );
        return;
      }
      setFlagOpen(false);
      setFlagNote("");
      setActionMsg("Batch flagged for review.");
      await load();
    } catch {
      setActionMsg("Network error.");
    } finally {
      setActionBusy(false);
    }
  };

  if (loadError && !data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-red-700">{loadError}</p>
        <Link
          href="/batches"
          className="mt-4 inline-block text-[#2E7D32] underline"
        >
          Back to overview
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <div className="h-8 max-w-xl animate-pulse rounded bg-zinc-200" />
      </div>
    );
  }

  const q = data.quality;
  const qi = q.qualityInitial ?? 0;
  const df = q.damageFactor;
  const sb = q.sortingBonus;

  return (
    <div className="pb-28">
      {data.review.flagged ? (
        <div className="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950">
          This batch has been flagged for review
          {data.review.note ? ` — ${data.review.note}` : ""}
        </div>
      ) : null}

      <header className="border-b border-zinc-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-sm text-zinc-600">
              Batch {data.identity.batchId || data.identity.recordId}
            </p>
            <p className="text-lg font-semibold text-zinc-900">
              {data.identity.farmName}
            </p>
            <p className="text-xs text-zinc-500">
              Harvest {formatHarvest(data.identity.harvestTime)} · Status{" "}
              <span className="font-medium text-zinc-700">
                {data.identity.status}
              </span>
            </p>
            <p className="text-xs text-zinc-500">
              Evaluation{" "}
              {data.identity.evaluationTimestamp
                ? formatHarvest(data.identity.evaluationTimestamp)
                : "—"}
            </p>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              href={`/batches/${recordId}`}
              className="text-[#2E7D32] underline underline-offset-2"
            >
              Dispatcher recommendation
            </Link>
            <Link href="/batches" className="text-zinc-600 underline">
              Batch overview
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
        <section>
          <SectionTitle>Pipeline status</SectionTitle>
          <div className="flex items-start justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-4">
            <Step
              label="Submitted"
              complete={data.pipeline.submitted.complete}
              at={data.pipeline.submitted.at}
            />
            <span className="mt-4 text-zinc-300">→</span>
            <Step
              label="Quality computed"
              complete={data.pipeline.qualityComputed.complete}
              warn={data.pipeline.qualityComputed.warnBelowQMin}
              at={data.pipeline.qualityComputed.at}
            />
            <span className="mt-4 text-zinc-300">→</span>
            <Step
              label="Evaluated"
              complete={data.pipeline.evaluated.complete}
              at={data.pipeline.evaluated.at}
            />
            <span className="mt-4 text-zinc-300">→</span>
            <Step
              label="Dispatched"
              complete={data.pipeline.dispatched.complete}
              at={data.pipeline.dispatched.at}
            />
          </div>
          {data.pipeline.qualityComputed.warnBelowQMin ? (
            <p className="mt-2 text-sm text-red-700">
              Packed quality is below Q_MIN ({data.qMin}) — dispatch should remain
              blocked until quality improves or policy overrides apply.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <SectionTitle>1 — Harvest &amp; handling inputs</SectionTitle>
          <h3 className="mb-2 text-sm font-semibold text-zinc-800">Harvest</h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">batch_id</dt>
              <dd className="font-mono">{data.harvest.batchId || "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">farm_origin_id</dt>
              <dd>
                {data.harvest.farmDisplay}
                {data.harvest.farmCoords ? (
                  <span className="text-zinc-500">
                    {" "}
                    ({data.harvest.farmCoords})
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">harvest_time</dt>
              <dd>{formatHarvest(data.harvest.harvestTime)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">weight_kg</dt>
              <dd>
                {data.harvest.weightKg != null
                  ? `${data.harvest.weightKg} kg`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">maturity_grade</dt>
              <dd className="flex items-center gap-2">
                {data.harvest.maturityGrade ?? "—"}
                {data.harvest.maturitySwatch ? (
                  <span
                    className="inline-block h-4 w-4 rounded border border-zinc-200"
                    style={{ background: data.harvest.maturitySwatch }}
                    title={data.harvest.maturityGrade ?? ""}
                  />
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-zinc-500">harvest_method</dt>
              <dd>{data.harvest.harvestMethod ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">quality_initial</dt>
              <dd>
                {data.harvest.qualityInitial != null
                  ? data.harvest.qualityInitial.toFixed(3)
                  : "—"}
              </dd>
            </div>
          </dl>
          <h3 className="mb-2 mt-6 text-sm font-semibold text-zinc-800">
            Handling
          </h3>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-zinc-500">packaging_type</dt>
              <dd>{data.handling.packagingType ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">fill_level</dt>
              <dd>{data.handling.fillLevel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">damage_factor</dt>
              <dd>{df.toFixed(3)}</dd>
            </div>
            <div>
              <dt className="text-zinc-500">sorting_bonus</dt>
              <dd>{sb.toFixed(3)}</dd>
            </div>
          </dl>
          {data.handling.highDamageNote ? (
            <p className="mt-3 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">
              High damage factor — significant quality reduction expected.
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <SectionTitle>2 — Quality computation</SectionTitle>
          {q.notComputed ? (
            <p className="text-sm text-zinc-600">Quality not yet computed.</p>
          ) : (
            <>
              <pre className="overflow-x-auto rounded-lg bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-800">
                {`quality_packed = quality_initial × (1 − 0.6 × damage_factor) × (1 + 0.2 × sorting_bonus)
             = ${qi.toFixed(3)} × (1 − 0.6 × ${df.toFixed(3)}) × (1 + 0.2 × ${sb.toFixed(3)})
             = ${q.formulaResult != null ? q.formulaResult.toFixed(3) : "—"}`}
                {q.qualityPacked != null
                  ? `\n(stored quality_packed: ${q.qualityPacked.toFixed(3)})`
                  : ""}
                {`\n\nk_multiplier = 1 + 0.8 × damage_factor
             = 1 + 0.8 × ${df.toFixed(3)}
             = ${q.kMultiplier.toFixed(3)}`}
              </pre>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-zinc-500">
                    <th className="py-2 pr-2">Output</th>
                    <th className="py-2 pr-2">Value</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-zinc-100">
                    <td className="py-2">quality_packed</td>
                    <td className="tabular-nums">
                      {q.qualityPacked != null ? q.qualityPacked.toFixed(3) : "—"}
                    </td>
                    <td>
                      {q.qualityPacked == null
                        ? "—"
                        : q.qualityPacked >= data.qMin
                          ? "✓ Above Q_MIN"
                          : "✗ Below Q_MIN"}
                    </td>
                  </tr>
                  <tr className="border-b border-zinc-100">
                    <td className="py-2">k_multiplier</td>
                    <td className="tabular-nums">{q.kMultiplier.toFixed(3)}</td>
                    <td>—</td>
                  </tr>
                  <tr className="border-b border-zinc-100">
                    <td className="py-2">Q_MIN</td>
                    <td className="tabular-nums">{data.qMin}</td>
                    <td>constant</td>
                  </tr>
                  <tr
                    className={
                      q.feasible ? "bg-emerald-50/80" : "bg-red-50/80"
                    }
                  >
                    <td className="py-2 font-medium">Feasible for dispatch</td>
                    <td className="py-2">{q.feasible ? "Yes" : "No"}</td>
                    <td className="py-2">—</td>
                  </tr>
                </tbody>
              </table>
            </>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <SectionTitle>3 — Route &amp; traffic</SectionTitle>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-2 pr-2">Market</th>
                  <th className="py-2 pr-2">Distance (km)</th>
                  <th className="py-2 pr-2">Base (hr)</th>
                  <th className="py-2 pr-2">τ</th>
                  <th className="py-2 pr-2">Effective (hr)</th>
                  <th className="py-2 pr-2">Congestion</th>
                  <th className="py-2">Logistics (₹)</th>
                </tr>
              </thead>
              <tbody>
                {data.routes.map((r) => (
                  <tr key={r.marketId} className="border-t border-zinc-100">
                    <td className="py-2 pr-2 font-medium">{r.marketName}</td>
                    <td className="py-2 pr-2 tabular-nums">
                      {r.distanceKm.toFixed(1)}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {r.tBaseHr.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {r.tau != null ? r.tau.toFixed(3) : "—"}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {r.effectiveTravelHr.toFixed(2)}
                    </td>
                    <td className="py-2 pr-2 capitalize">{r.congestion}</td>
                    <td className="py-2 tabular-nums">
                      {formatInr(r.logisticsCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 space-y-2 text-xs text-zinc-700">
            {data.routes.map((r) => (
              <p key={r.marketId} className="font-mono leading-relaxed">
                <span className="font-sans font-medium text-zinc-600">
                  {r.marketName}:{" "}
                </span>
                Cost = (₹12 × {r.distanceKm}) + ₹150 × {r.tBaseHr} × (1 + 1.5 ×{" "}
                {r.logisticsFormula.tauUsed}) + ₹500 = {formatInr(r.logisticsCost)}
                <span className="ml-2 text-zinc-500">
                  (τ from {r.tauSource})
                </span>
              </p>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <SectionTitle>4 — Environmental data</SectionTitle>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-2 pr-2">Market</th>
                  <th className="py-2 pr-2">Temp (°C)</th>
                  <th
                    className="py-2 pr-2"
                    title="High humidity increases fungal decay risk."
                  >
                    Humidity (%)
                  </th>
                  <th className="py-2 pr-2">Decay score</th>
                  <th className="py-2 pr-2">Level</th>
                  <th className="py-2">Record time</th>
                </tr>
              </thead>
              <tbody>
                {data.environment.map((e) => (
                  <tr key={e.marketId} className="border-t border-zinc-100">
                    <td className="py-2 pr-2 font-medium">{e.marketName}</td>
                    <td className="py-2 pr-2 tabular-nums">
                      {e.temperatureC != null ? e.temperatureC.toFixed(1) : "—"}
                    </td>
                    <td
                      className="py-2 pr-2 tabular-nums"
                      title="High humidity increases fungal decay risk along this route."
                    >
                      {e.humidityPct != null ? e.humidityPct.toFixed(0) : "—"}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {e.decayRiskScore != null
                        ? e.decayRiskScore.toFixed(3)
                        : "—"}
                      {e.decayHigh ? (
                        <span className="ml-1 text-red-600" title="Score &gt; 0.65">
                          ●
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-2">{e.decayLevel}</td>
                    <td className="py-2 text-xs text-zinc-500">
                      {formatShortTs(e.recordUpdatedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <SectionTitle>5 — Market pricing used (at evaluation)</SectionTitle>
          {data.pricingSummary.anyStaleAtEval ? (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Prices were {data.pricingSummary.maxStaleDaysAtEval} calendar day
              {data.pricingSummary.maxStaleDaysAtEval === 1 ? "" : "s"} old when
              this evaluation ran (arrival_date before evaluation day).
            </p>
          ) : null}
          <p className="mb-3 text-xs text-zinc-500">
            Rows use the latest Market_Pricing row per market with arrival_date ≤
            evaluation calendar day (Asia/Kolkata). Without stored pricing IDs on
            Market_Evaluation, this is reconstructed for audit — confirm with your
            team if snapshots differ.
          </p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="py-2 pr-2">Market</th>
                  <th className="py-2 pr-2">Arrival date</th>
                  <th className="py-2 pr-2">Modal ₹/kg</th>
                  <th className="py-2 pr-2">Min</th>
                  <th className="py-2 pr-2">Max</th>
                  <th className="py-2 pr-2">Source</th>
                  <th className="py-2">Stale at eval?</th>
                </tr>
              </thead>
              <tbody>
                {data.pricing.map((p) => (
                  <tr key={p.marketId} className="border-t border-zinc-100">
                    <td className="py-2 pr-2 font-medium">{p.marketName}</td>
                    <td className="py-2 pr-2">{p.arrivalDay ?? "—"}</td>
                    <td className="py-2 pr-2 tabular-nums">
                      {p.modalPrice != null ? p.modalPrice.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {p.minPrice != null ? p.minPrice.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-2 tabular-nums">
                      {p.maxPrice != null ? p.maxPrice.toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-2">{p.sourceLabel}</td>
                    <td className="py-2">
                      {p.staleAtEval ? (
                        <span className="text-amber-800">
                          Yes
                          {p.staleDaysAtEval != null
                            ? ` (${p.staleDaysAtEval}d)`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-zinc-600">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <SectionTitle>6 — Evaluation outputs</SectionTitle>
          {!data.evaluation.hasEvaluation ? (
            <p className="text-sm text-zinc-600">
              No evaluation on record for this batch.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-2 pr-2">Market</th>
                      <th className="py-2 pr-2">Gross ₹</th>
                      <th className="py-2 pr-2">Commission ₹</th>
                      <th className="py-2 pr-2">Net ₹</th>
                      <th className="py-2 pr-2">Logistics ₹</th>
                      <th className="py-2 pr-2">Expected profit ₹</th>
                      <th className="py-2 pr-2">Feasible</th>
                      <th className="py-2">Recommended</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.evaluation.rows.map((row) => (
                      <tr
                        key={row.marketId}
                        className={`border-t border-zinc-100 ${
                          row.recommended
                            ? "bg-sky-50/90"
                            : !row.feasible
                              ? "opacity-60"
                              : ""
                        }`}
                      >
                        <td className="py-2 pr-2 font-medium">
                          {row.marketName}
                          {row.recommended ? (
                            <span className="ml-1 text-xs font-normal text-sky-700">
                              ★
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-2 tabular-nums">
                          {formatInr(row.grossRevenue)}
                        </td>
                        <td className="py-2 pr-2 tabular-nums">
                          {formatInr(row.commissionAmount)}
                        </td>
                        <td className="py-2 pr-2 tabular-nums">
                          {formatInr(row.netRevenue)}
                        </td>
                        <td className="py-2 pr-2 tabular-nums">
                          {formatInr(row.logisticsCost)}
                        </td>
                        <td className="py-2 pr-2 tabular-nums">
                          {formatInr(row.expectedProfit)}
                        </td>
                        <td className="py-2 pr-2">
                          {row.feasible ? "Yes" : "No"}
                        </td>
                        <td className="py-2 font-medium">
                          {row.recommendedAirtable === true
                            ? "Yes"
                            : row.recommendedAirtable === false
                              ? "No"
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <pre className="mt-4 rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-800">
                {`Recommended: ${data.evaluation.summary.recommendedMarket}
Expected profit: ${formatInr(data.evaluation.summary.expectedProfit)}
Margin over next best: ${data.evaluation.summary.marginOverNext != null ? formatInr(data.evaluation.summary.marginOverNext) : "—"}
Evaluation run at: ${data.evaluation.summary.evaluationTimestamp ? formatHarvest(data.evaluation.summary.evaluationTimestamp) : "—"}`}
              </pre>
            </>
          )}
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            Internal audit view — dispatch only from the recommendation screen.
          </p>
          <div className="flex flex-wrap gap-2">
            {actionMsg ? (
              <span className="self-center text-xs text-zinc-600">{actionMsg}</span>
            ) : null}
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => rerun()}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              Re-run evaluation
            </button>
            <button
              type="button"
              disabled={actionBusy}
              onClick={() => setFlagOpen(true)}
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Flag for review
            </button>
          </div>
        </div>
      </div>

      {flagOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="text-lg font-semibold">Flag batch for review</h3>
            <p className="mt-1 text-sm text-zinc-600">
              Sets <code className="text-xs">flag_for_review</code> on Farmer_Batches
              (and optional note). Requires those fields in Airtable.
            </p>
            <label className="mt-3 block text-sm">
              <span className="text-zinc-600">Note (optional)</span>
              <textarea
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setFlagOpen(false)}
                className="rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => submitFlag()}
                className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Save flag
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
