import { NextRequest, NextResponse } from "next/server";

// IST = UTC + 5:30
const IST_MS = 5.5 * 60 * 60 * 1000;

function nowIST() {
  return new Date(Date.now() + IST_MS);
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Locked constants from math_models.py
const K_REF = 0.015;
const T_REF = 25.0;
const BETA_TEMP = 0.08;
const DELTA_HUM = 0.00351;
const DELTA_VPD = 0.252462;
const COST_PER_KM = 18;
const TIME_RATE = 160;
const FIXED_COST = 500;
const TAU_MULT = 1.5;

const SEASONAL_FACTOR: Record<string, number> = {
  Jan: 0.7465, Feb: 0.9368, Mar: 1.2625,
  Apr: 1.6207, May: 1.5692, Jun: 1.0012,
  Jul: 0.7987, Aug: 0.7779, Sep: 0.7885,
  Oct: 0.9048, Nov: 0.8516, Dec: 0.7416,
};

function kBase(tempC: number, humidityPct: number, month: string): number {
  const es = 0.6108 * Math.exp(17.27 * tempC / (tempC + 237.3));
  const vpd = es * (1 - humidityPct / 100);
  const humFactor = (1 + DELTA_HUM * humidityPct) * (1 + DELTA_VPD * vpd);
  const seasonal = SEASONAL_FACTOR[month] ?? 1.0;
  return K_REF * seasonal * Math.exp(BETA_TEMP * (tempC - T_REF)) * humFactor;
}

function decayLevelFromKBase(kb: number): "low" | "moderate" | "high" {
  if (kb < 0.025) return "low";
  if (kb < 0.05) return "moderate";
  return "high";
}

function congestionFromTau(tau: number): "low" | "moderate" | "high" {
  if (tau < 0.2) return "low";
  if (tau < 0.5) return "moderate";
  return "high";
}

async function fetchHere(
  originLat: number, originLng: number,
  marketLat: number, marketLng: number,
): Promise<{ tau: number; tActualHr: number; tBaseHr: number } | null> {
  const key = process.env.HERE_API_KEY;
  if (!key) return null;

  const ist = nowIST();
  const pad = (n: number) => String(n).padStart(2, "0");
  const departureTime =
    `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}` +
    `T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:00+05:30`;

  const params = new URLSearchParams({
    apikey: key,
    transportMode: "truck",
    origin: `${originLat},${originLng}`,
    destination: `${marketLat},${marketLng}`,
    return: "summary",
    departureTime,
  });

  try {
    const res = await fetch(`https://router.hereapi.com/v8/routes?${params}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { routes?: { sections?: { summary?: { length?: number; baseDuration?: number; duration?: number } }[] }[] };
    const summary = json.routes?.[0]?.sections?.[0]?.summary;
    if (!summary?.length || !summary.baseDuration || !summary.duration) return null;

    const tBaseHr = summary.baseDuration / 3600;
    const tActualHr = Math.max(summary.duration / 3600, tBaseHr);
    const tau = Math.max(0, (tActualHr - tBaseHr) / tBaseHr);
    return { tau, tActualHr, tBaseHr };
  } catch {
    return null;
  }
}

async function fetchWeather(lat: number, lng: number): Promise<{ tempC: number; humidity: number } | null> {
  const key = process.env.WEATHERAPI_KEY;
  if (!key) return null;
  const params = new URLSearchParams({ key, q: `${lat},${lng}`, aqi: "no" });
  try {
    const res = await fetch(`http://api.weatherapi.com/v1/current.json?${params}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { current?: { temp_c?: number; humidity?: number } };
    const c = json.current;
    if (c?.temp_c == null || c?.humidity == null) return null;
    return { tempC: c.temp_c, humidity: c.humidity };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      originLat: number; originLng: number;
      marketLat: number; marketLng: number;
      distanceKm: number; tBaseHr: number;
    };
    const { originLat, originLng, marketLat, marketLng, distanceKm, tBaseHr } = body;

    const midLat = (originLat + marketLat) / 2;
    const midLng = (originLng + marketLng) / 2;

    const [hereResult, wOrigin, wMid, wMarket] = await Promise.all([
      fetchHere(originLat, originLng, marketLat, marketLng),
      fetchWeather(originLat, originLng),
      fetchWeather(midLat, midLng),
      fetchWeather(marketLat, marketLng),
    ]);

    const tau = hereResult?.tau ?? null;
    const tActualHr = hereResult?.tActualHr ?? null;

    const weatherPoints = [wOrigin, wMid, wMarket].filter(Boolean) as { tempC: number; humidity: number }[];
    const avgTempC = weatherPoints.length > 0
      ? weatherPoints.reduce((s, w) => s + w.tempC, 0) / weatherPoints.length
      : null;
    const avgHumidity = weatherPoints.length > 0
      ? weatherPoints.reduce((s, w) => s + w.humidity, 0) / weatherPoints.length
      : null;

    const ist = nowIST();
    const month = MONTH_NAMES[ist.getUTCMonth()];
    const decayRiskScore = avgTempC != null && avgHumidity != null
      ? kBase(avgTempC, avgHumidity, month)
      : null;
    const decayLevel = decayRiskScore != null ? decayLevelFromKBase(decayRiskScore) : null;

    const tauUsed = tau ?? 0;
    const logisticsCost = Math.round(
      COST_PER_KM * distanceKm +
      TIME_RATE * tBaseHr * (1 + TAU_MULT * tauUsed) +
      FIXED_COST
    );
    const effectiveTravelHr = tBaseHr * (1 + TAU_MULT * tauUsed);

    return NextResponse.json({
      tau,
      tActualHr,
      effectiveTravelHr,
      congestion: tau != null ? congestionFromTau(tau) : null,
      logisticsCost,
      avgTempC: avgTempC != null ? Math.round(avgTempC * 10) / 10 : null,
      avgHumidity: avgHumidity != null ? Math.round(avgHumidity) : null,
      decayLevel,
      fetchedAt: new Date().toISOString(),
      hereAvailable: !!process.env.HERE_API_KEY,
      weatherAvailable: !!process.env.WEATHERAPI_KEY,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Live check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
