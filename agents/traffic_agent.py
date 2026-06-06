# traffic_agent.py
import argparse, json, requests
from datetime import datetime, timezone, timedelta
from config import require_env, T_MARKETS, T_TRAFFIC, T_FARMER_BATCHES, HERE_API_KEY
from airtable_client import AirtableClient, q, make_pair_key
from math_models import traffic_tau, DEFAULT_TAU

# ---------------------------------------------------------------------------
# IST timezone — all timestamps use IST since trucks operate in India
# ---------------------------------------------------------------------------
IST = timezone(timedelta(hours=5, minutes=30))

T_ROUTE_REF = "Route_Reference"
HERE_URL    = "https://router.hereapi.com/v8/routes"

# ---------------------------------------------------------------------------
# fetch_here_route()
# Returns distance_km, t_base_hr, t_actual_hr from HERE Routing API.
# Returns None if API unavailable or key not set.
# ---------------------------------------------------------------------------
def fetch_here_route(
    origin_lat: float, origin_lng: float,
    market_lat: float, market_lng: float,
    harvest_time: str | None = None
) -> dict | None:

    if not HERE_API_KEY:
        return None

    if harvest_time:
        try:
            dt_harvest  = datetime.fromisoformat(
                harvest_time.replace("Z", "+00:00")
            ).astimezone(IST)
            # Use today's date + actual dispatch hour
            # HERE doesn't support historical traffic but supports time-of-day
            now_ist     = datetime.now(IST)
            departure   = now_ist.replace(
                hour=dt_harvest.hour,
                minute=dt_harvest.minute,
                second=0,
                microsecond=0,
            )
            # If that time already passed today, use tomorrow
            if departure < now_ist:
                departure = departure + timedelta(days=1)
            departure_time = departure.strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
        except Exception:
            departure_time = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
    else:
        departure_time = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"

    params = {
        "apikey":        HERE_API_KEY,
        "transportMode": "truck",
        "origin":        f"{origin_lat},{origin_lng}",
        "destination":   f"{market_lat},{market_lng}",
        "return":        "summary",
        "departureTime": departure_time,
    }

    try:
        r = requests.get(HERE_URL, params=params, timeout=15)
        r.raise_for_status()
        summary = r.json()["routes"][0]["sections"][0]["summary"]

        distance_km = round(summary["length"] / 1000.0, 2)
        t_base_hr   = round(summary["baseDuration"] / 3600.0, 4)
        t_actual_hr = round(summary["duration"] / 3600.0, 4)

        # Sanity checks — reject obviously bad responses
        if not (20 <= distance_km <= 600):
            print(f"  [traffic] HERE distance out of range: {distance_km}km — rejecting")
            return None
        if not (0.2 <= t_base_hr <= 12):
            print(f"  [traffic] HERE t_base out of range: {t_base_hr}hr — rejecting")
            return None
        if t_actual_hr < t_base_hr:
            print(f"  [traffic] t_actual < t_base (light traffic) — clamping tau to 0")
            t_actual_hr = t_base_hr  # tau = 0, no delay penalty

        return {
            "distance_km": distance_km,
            "t_base_hr":   t_base_hr,
            "t_actual_hr": t_actual_hr,
            "source":      "here_api",
        }

    except requests.exceptions.Timeout:
        print(f"  [traffic] HERE API timeout")
        return None
    except Exception as e:
        print(f"  [traffic] HERE API error: {e}")
        return None


# ---------------------------------------------------------------------------
# fetch_route_reference()
# Looks up static distance and base time from Route_Reference table.
# pair_key format: FARM001|MKT001
# ---------------------------------------------------------------------------
def fetch_route_reference(at: AirtableClient, origin_id: str, market_id: str) -> dict | None:
    pair_key = f"{origin_id}|{market_id}"
    rec = at.get_one(T_ROUTE_REF, f'{{pair_key}}="{q(pair_key)}"')
    if not rec:
        return None
    f = rec["fields"]
    return {
        "distance_km": float(f["distance_km"]),
        "t_base_hr":   float(f["t_base_hr"]),
        "source":      "route_reference",
    }


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

    b            = batch["fields"]
    batch_rec_id = batch["id"]
    origin_id    = b.get("origin_id")
    origin_lat   = b.get("origin_lat")
    origin_lng   = b.get("origin_lng")

    if not origin_id:
        raise RuntimeError(f"origin_id missing in Farmer_Batches for {args.batch_id}")

    # --- Read all markets ---
    markets        = at.list_records(T_MARKETS, max_records=500)
    market_rec_ids = {m["fields"]["market_id"]: m["id"] for m in markets}

    fetched_at     = datetime.now(IST).strftime("%Y-%m-%dT%H:%M:%S") + "+05:30"
    created        = 0
    updated        = 0
    base_id_n      = None   # lazy-loaded traffic_id counter

    for mrec in markets:
        mf         = mrec["fields"]
        market_id  = mf["market_id"]
        market_lat = mf.get("market_lat")
        market_lng = mf.get("market_lng")

        pair_key = make_pair_key(args.batch_id, market_id)
        print(f"\n[traffic] Processing {pair_key}")

        # ---------------------------------------------------------------
        # Step 1: HERE API — primary source for all three values
        # ---------------------------------------------------------------
        route = None
        if HERE_API_KEY and origin_lat and origin_lng and market_lat and market_lng:
            route = fetch_here_route(
                float(origin_lat), float(origin_lng),
                float(market_lat), float(market_lng),
                harvest_time=b.get("harvest_time")  # FIXED: Passed harvest_time directly in the call
            )
            if route:
                print(f"  [traffic] HERE API: dist={route['distance_km']}km, "
                      f"t_base={route['t_base_hr']}hr, t_actual={route['t_actual_hr']}hr")

        # ---------------------------------------------------------------
        # Step 2: Route_Reference — fallback for distance + t_base
        # If HERE failed, use Route_Reference for distance and t_base,
        # then apply DEFAULT_TAU to compute t_actual
        # ---------------------------------------------------------------
        if route is None:
            ref = fetch_route_reference(at, origin_id, market_id)
            if not ref:
                print(f"  [traffic] No Route_Reference for {origin_id}|{market_id} — skipping")
                continue

            tau_fallback = DEFAULT_TAU.get(market_id, 0.20)
            t_actual_hr  = round(ref["t_base_hr"] * (1 + tau_fallback), 4)

            route = {
                "distance_km": ref["distance_km"],
                "t_base_hr":   ref["t_base_hr"],
                "t_actual_hr": t_actual_hr,
                "source":      f"route_reference+default_tau({tau_fallback})",
            }
            print(f"  [traffic] Route_Reference fallback: dist={route['distance_km']}km, "
                  f"t_base={route['t_base_hr']}hr, "
                  f"t_actual={route['t_actual_hr']}hr (DEFAULT_TAU={tau_fallback})")

        # ---------------------------------------------------------------
        # Step 3: Compute tau from final t_base and t_actual
        # ---------------------------------------------------------------
        tau = traffic_tau(route["t_actual_hr"], route["t_base_hr"])
        print(f"  [traffic] tau={tau}, source={route['source']}")

        # ---------------------------------------------------------------
        # Step 4: Get or assign traffic_id
        # ---------------------------------------------------------------
        match    = f'{{pair_key}}="{q(pair_key)}"'
        existing = at.get_one(T_TRAFFIC, match)

        if existing:
            traffic_id = existing["fields"].get("traffic_id", "TRF000")
        else:
            if base_id_n is None:
                all_recs = at.list_records(T_TRAFFIC, max_records=500)
                max_n = 0
                for rec in all_recs:
                    tid = rec["fields"].get("traffic_id", "TRF000")
                    try:
                        n = int(tid.replace("TRF", ""))
                        max_n = max(max_n, n)
                    except ValueError:
                        pass
                base_id_n = max_n
            base_id_n += 1
            traffic_id = f"TRF{base_id_n:03d}"

        # ---------------------------------------------------------------
        # Step 5: Write to Traffic_Estimates
        # NOTE: t_eff_hr is DEPRECATED — not written
        # ---------------------------------------------------------------
        fields = {
            "traffic_id":         traffic_id,
            "pair_key":           pair_key,
            "batch_id":           [batch_rec_id],                # LINKED
            "market_id":          [market_rec_ids[market_id]],   # LINKED
            "distance_km":        route["distance_km"],
            "t_base_hr":          route["t_base_hr"],
            "t_actual_hr":        route["t_actual_hr"],
            "tau":                round(tau, 6),
            "traffic_fetched_at": fetched_at,
        }

        at.upsert_by_formula(T_TRAFFIC, match, fields)
        if existing:
            updated += 1
        else:
            created += 1

    print(json.dumps({
        "status":    "ok",
        "agent":     "traffic_agent",
        "batch_id":  args.batch_id,
        "origin_id": origin_id,
        "created":   created,
        "updated":   updated,
    }, indent=2))

if __name__ == "__main__":
    main()