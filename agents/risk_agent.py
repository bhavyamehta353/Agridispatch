# risk_agent.py
import argparse, json, requests
from datetime import datetime, timezone, timedelta, date as date_type
from config import require_env, T_HANDLING, T_TRAFFIC, T_RISK, T_FARMER_BATCHES, T_MARKETS, WEATHERAPI_KEY
from airtable_client import AirtableClient, q, make_pair_key
from math_models import (
    P, MATURITY_DECAY, SEASONAL_FACTOR,
    k_base, k_eff, quality_arrival,
    saturation_vapour_pressure, vapour_pressure_deficit,
)

IST = timezone(timedelta(hours=5, minutes=30))

# ---------------------------------------------------------------------------
# WeatherAPI.com endpoints
# ---------------------------------------------------------------------------
WEATHERAPI_CURRENT_URL = "http://api.weatherapi.com/v1/current.json"
WEATHERAPI_HISTORY_URL = "http://api.weatherapi.com/v1/history.json"

# ---------------------------------------------------------------------------
# fetch_weather()
# Two separate code paths:
#   1. Historical (dispatch_date != today) — uses history.json
#      Uses actual dispatch_hour from harvest_time for accurate conditions
#      Falls back to current.json if history unavailable (plan expired etc.)
#   2. Current (dispatch_date == today or no date) — uses current.json
# ---------------------------------------------------------------------------
def fetch_weather(
    lat: float,
    lng: float,
    label: str,
    dispatch_date: str | None = None,   # "YYYY-MM-DD" or None
    dispatch_hour: int = 6,             # hour of day (0-23), default 6am
) -> dict | None:
    """
    Fetches temperature and humidity for a coordinate.

    If dispatch_date is provided and is NOT today:
        → Attempts history.json at the actual dispatch_hour
        → Falls back to current.json if history unavailable

    If dispatch_date is today or not provided:
        → Uses current.json directly (reflects current conditions)

    Returns dict with temp_c and humidity, or None if all fetches fail.
    """
    if not WEATHERAPI_KEY:
        print(f"  [risk] WEATHERAPI_KEY not set — skipping live weather for {label}")
        return None

    today_ist   = datetime.now(IST).strftime("%Y-%m-%d")
    use_history = (
        dispatch_date is not None
        and dispatch_date != today_ist
    )
    # Clamp hour to valid range
    hour_index = max(0, min(23, dispatch_hour))

    # -------------------------------------------------------------------
    # PATH 1: Historical weather (dispatch_date is in the past)
    # -------------------------------------------------------------------
    if use_history:
        print(f"  [risk] Fetching historical weather for {label} "
              f"on {dispatch_date} at {hour_index:02d}:00")
        try:
            r = requests.get(
                WEATHERAPI_HISTORY_URL,
                params={
                    "key": WEATHERAPI_KEY,
                    "q":   f"{lat},{lng}",
                    "dt":  dispatch_date,
                },
                timeout=15,
            )
            r.raise_for_status()
            data   = r.json()
            hourly = data["forecast"]["forecastday"][0]["hour"]

            # Use actual dispatch hour — not hardcoded 6am
            hour_data = hourly[hour_index]
            temp_c    = float(hour_data["temp_c"])
            humidity  = float(hour_data["humidity"])

            print(f"  [risk] Weather [{label}] "
                  f"({dispatch_date} {hour_index:02d}:00): "
                  f"{temp_c}°C, {humidity}% humidity")
            return {"temp_c": temp_c, "humidity": humidity}

        except requests.exceptions.Timeout:
            print(f"  [risk] History API timeout for {label} — falling back to current")
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response else "?"
            print(f"  [risk] History API HTTP {status} for {label} "
                  f"(plan may have expired) — falling back to current")
        except Exception as e:
            print(f"  [risk] History API error for {label}: {e} — falling back to current")

        print(f"  [risk] Using current weather as fallback for {label}")

    # -------------------------------------------------------------------
    # PATH 2: Current weather (today or fallback from failed history)
    # -------------------------------------------------------------------
    try:
        r = requests.get(
            WEATHERAPI_CURRENT_URL,
            params={"key": WEATHERAPI_KEY, "q": f"{lat},{lng}", "aqi": "no"},
            timeout=15,
        )
        r.raise_for_status()
        current  = r.json()["current"]
        temp_c   = float(current["temp_c"])
        humidity = float(current["humidity"])
        source   = "current" if not use_history else "current (history fallback)"
        print(f"  [risk] Weather [{label}] ({source}): {temp_c}°C, {humidity}% humidity")
        return {"temp_c": temp_c, "humidity": humidity}

    except requests.exceptions.Timeout:
        print(f"  [risk] Weather API timeout for {label}")
        return None
    except Exception as e:
        print(f"  [risk] Weather API error for {label}: {e}")
        return None


def midpoint(lat1, lng1, lat2, lng2) -> tuple:
    """Returns the geographical midpoint between two coordinates."""
    return ((lat1 + lat2) / 2, (lng1 + lng2) / 2)


def three_point_weather(
    origin_lat, origin_lng,
    market_lat, market_lng,
    origin_label, market_label,
    w_origin_cached=None,
    dispatch_date: str | None = None,
    dispatch_hour: int = 6,             # passed through to fetch_weather
) -> dict | None:
    """
    Fetches weather at origin, midpoint, and market.
    Returns averaged temp and humidity across all three points.
    Falls back to fewer points if any fetch fails.
    dispatch_date: "YYYY-MM-DD" — used for historical fetch if not today.
    dispatch_hour: int (0-23) — actual hour of dispatch for accurate conditions.
    """
    mid_lat, mid_lng = midpoint(origin_lat, origin_lng, market_lat, market_lng)
    mid_label = f"midpoint({origin_label}→{market_label})"

    # Use cached origin weather if provided, otherwise fetch
    w_origin = w_origin_cached or fetch_weather(
        origin_lat, origin_lng, origin_label,
        dispatch_date=dispatch_date,
        dispatch_hour=dispatch_hour,
    )
    w_mid = fetch_weather(
        mid_lat, mid_lng, mid_label,
        dispatch_date=dispatch_date,
        dispatch_hour=dispatch_hour,
    )
    w_market = fetch_weather(
        market_lat, market_lng, market_label,
        dispatch_date=dispatch_date,
        dispatch_hour=dispatch_hour,
    )

    valid = [w for w in [w_origin, w_mid, w_market] if w is not None]

    if not valid:
        print(f"  [risk] All weather fetches failed — will use stub")
        return None

    avg_temp     = round(sum(w["temp_c"] for w in valid) / len(valid), 2)
    avg_humidity = round(sum(w["humidity"] for w in valid) / len(valid), 2)

    points_used = ["origin"   if w_origin else None,
                   "midpoint" if w_mid    else None,
                   "market"   if w_market else None]
    points_used = [p for p in points_used if p]

    print(f"  [risk] 3-point avg ({len(valid)} points: {', '.join(points_used)}): "
          f"{avg_temp}°C, {avg_humidity}%")

    return {"avg_temp_c": avg_temp, "avg_humidity_pct": avg_humidity}


def stub_weather(month: str, lat: float) -> dict:
    """
    Fallback weather based on month and latitude.
    Uses Maharashtra climate averages — documented assumption.
    Used when both historical and current API fetches fail.
    """
    seasonal     = SEASONAL_FACTOR.get(month, 1.0)
    base_temp    = 28.0 + (lat - 17.5) * 0.5
    avg_temp     = round(base_temp * seasonal * 0.85, 1)
    avg_humidity = round(max(20, min(85, 80 - (seasonal - 0.85) * 40)), 1)

    print(f"  [risk] Using stub weather for {month}: {avg_temp}°C, {avg_humidity}%")
    return {"avg_temp_c": avg_temp, "avg_humidity_pct": avg_humidity}


# ---------------------------------------------------------------------------
# Auto-increment risk_id
# ---------------------------------------------------------------------------
def next_risk_id_base(at: AirtableClient) -> int:
    all_recs = at.list_records(T_RISK, max_records=500)
    max_n = 0
    for rec in all_recs:
        rid = rec["fields"].get("risk_id", "RSK000")
        try:
            n     = int(rid.replace("RSK", ""))
            max_n = max(max_n, n)
        except ValueError:
            pass
    return max_n


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------
def main():
    require_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch_id", required=True)
    args = ap.parse_args()

    at = AirtableClient()

    # --- Read Farmer_Batches ---
    batch = at.get_one(T_FARMER_BATCHES, f'{{batch_id}}="{q(args.batch_id)}"')
    if not batch:
        raise RuntimeError(f"Batch not found: {args.batch_id}")

    b              = batch["fields"]
    batch_rec_id   = batch["id"]
    origin_lat     = float(b["origin_lat"])
    origin_lng     = float(b["origin_lng"])
    maturity_grade = b["maturity_grade"]

    # --- Determine dispatch date, hour, and month from harvest_time ---
    harvest_time = b.get("harvest_time")
    if harvest_time:
        try:
            dt            = datetime.fromisoformat(harvest_time.replace("Z", "+00:00"))
            # Convert to IST for local hour
            dt_ist        = dt.astimezone(IST)
            month         = dt_ist.strftime("%b")       # e.g. "May"
            dispatch_date = dt_ist.strftime("%Y-%m-%d") # e.g. "2025-05-10"
            dispatch_hour = dt_ist.hour                 # e.g. 6, 10, 11
        except Exception:
            month         = datetime.now(IST).strftime("%b")
            dispatch_date = datetime.now(IST).strftime("%Y-%m-%d")
            dispatch_hour = 6
    else:
        month         = datetime.now(IST).strftime("%b")
        dispatch_date = datetime.now(IST).strftime("%Y-%m-%d")
        dispatch_hour = 6

    today_ist    = datetime.now(IST).strftime("%Y-%m-%d")
    weather_mode = "historical" if dispatch_date != today_ist else "current"

    print(f"\n[risk] Batch: {args.batch_id} | Maturity: {maturity_grade} | "
          f"Month: {month} | Date: {dispatch_date} | "
          f"Hour: {dispatch_hour:02d}:00 IST | Weather: {weather_mode}")

    # --- Read Handling_Quality ---
    handling = at.get_one(T_HANDLING, f'{{batch_id}}="{q(args.batch_id)}"')
    if not handling:
        raise RuntimeError(f"Handling_Quality not found for {args.batch_id}")

    h        = handling["fields"]
    Q_packed = float(h["quality_packed"])
    k_mult   = float(h["k_multiplier"])

    # --- Read all markets ---
    markets        = at.list_records(T_MARKETS, max_records=500)
    market_rec_ids = {m["fields"]["market_id"]: m["id"] for m in markets}
    market_coords  = {
        m["fields"]["market_id"]: {
            "lat":  float(m["fields"]["market_lat"]),
            "lng":  float(m["fields"]["market_lng"]),
            "name": m["fields"].get("market_name", m["fields"]["market_id"]),
        }
        for m in markets
        if m["fields"].get("market_lat") and m["fields"].get("market_lng")
    }

    # --- Fetch origin weather ONCE at actual dispatch hour ---
    w_origin = fetch_weather(
        origin_lat, origin_lng,
        f"origin({args.batch_id})",
        dispatch_date=dispatch_date,
        dispatch_hour=dispatch_hour,
    )

    created   = 0
    updated   = 0
    base_id_n = None

    for market_id, mcoords in market_coords.items():
        pair_key    = make_pair_key(args.batch_id, market_id)
        market_lat  = mcoords["lat"]
        market_lng  = mcoords["lng"]
        market_name = mcoords["name"]

        print(f"\n[risk] Processing {pair_key}")

        tr = at.get_one(T_TRAFFIC, f'{{pair_key}}="{q(pair_key)}"')
        if not tr:
            print(f"  [risk] No Traffic_Estimates for {pair_key} — skipping")
            continue

        tf          = tr["fields"]
        t_actual_hr = float(tf["t_actual_hr"])

        # --- 3-point weather at actual dispatch hour ---
        weather = three_point_weather(
            origin_lat, origin_lng,
            market_lat, market_lng,
            f"origin({args.batch_id})",
            market_name,
            w_origin_cached=w_origin,
            dispatch_date=dispatch_date,
            dispatch_hour=dispatch_hour,
        )

        if weather:
            avg_temp_c   = weather["avg_temp_c"]
            avg_humidity = weather["avg_humidity_pct"]
        else:
            stub         = stub_weather(month, origin_lat)
            avg_temp_c   = stub["avg_temp_c"]
            avg_humidity = stub["avg_humidity_pct"]

        # --- Compute decay values ---
        kb = k_base(avg_temp_c, avg_humidity, month)
        ke = k_eff(kb, k_mult, maturity_grade)
        qa = quality_arrival(Q_packed, ke, t_actual_hr)

        print(f"  [risk] k_base={round(kb,6)}, k_eff={round(ke,6)}, "
              f"quality_arrival={round(qa,4)}, feasible={qa >= P.Q_min}")

        match    = f'{{pair_key}}="{q(pair_key)}"'
        existing = at.get_one(T_RISK, match)

        if existing:
            risk_id = existing["fields"].get("risk_id", "RSK000")
        else:
            if base_id_n is None:
                base_id_n = next_risk_id_base(at)
            base_id_n += 1
            risk_id = f"RSK{base_id_n:03d}"

        fields = {
            "risk_id":              risk_id,
            "pair_key":             pair_key,
            "batch_id":             [batch_rec_id],
            "market_id":            [market_rec_ids[market_id]],
            "avg_temp_c":           avg_temp_c,
            "avg_humidity_pct":     avg_humidity,
            "k_base":               round(kb, 6),
            "k_eff":                round(ke, 6),
            "quality_arrival_pred": round(qa, 4),
        }

        at.upsert_by_formula(T_RISK, match, fields)
        if existing:
            updated += 1
        else:
            created += 1

    print(json.dumps({
        "status":        "ok",
        "agent":         "risk_agent",
        "batch_id":      args.batch_id,
        "month":         month,
        "dispatch_date": dispatch_date,
        "dispatch_hour": dispatch_hour,
        "weather_mode":  weather_mode,
        "created":       created,
        "updated":       updated,
    }, indent=2))

if __name__ == "__main__":
    main()