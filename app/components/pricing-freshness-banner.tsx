"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type FreshnessPayload = {
  level: "none" | "green" | "amber" | "red";
  headline: string;
  detail?: string;
  error?: string;
};

export function PricingFreshnessBanner({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [data, setData] = useState<FreshnessPayload | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/market-pricing/freshness");
      const json = (await res.json()) as FreshnessPayload & { error?: string };
      if (!res.ok) {
        setData({
          level: "red",
          headline: json.error ?? "Could not load pricing freshness.",
        });
        return;
      }
      setData(json);
    } catch {
      setData({
        level: "red",
        headline: "Could not load pricing freshness.",
      });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <div
        className={`w-full animate-pulse bg-zinc-200 ${compact ? "py-2" : "py-3"}`}
        aria-hidden
      />
    );
  }

  const bg =
    data.level === "green"
      ? "bg-emerald-700"
      : data.level === "amber"
        ? "bg-amber-600"
        : "bg-red-700";

  return (
    <div
      className={`w-full text-white ${bg} ${compact ? "px-3 py-2 text-sm" : "px-4 py-3 text-sm shadow-sm"}`}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <p className="font-semibold leading-snug">{data.headline}</p>
          {data.detail ? (
            <p className="mt-0.5 text-xs text-white/90">{data.detail}</p>
          ) : null}
        </div>
        <Link
          href="/pricing"
          className="shrink-0 text-xs font-medium underline decoration-white/70 underline-offset-2 hover:decoration-white"
        >
          Open pricing panel
        </Link>
      </div>
    </div>
  );
}
