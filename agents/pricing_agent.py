# pricing_agent.py
import argparse, json, random, requests
from datetime import datetime, timezone
from config import require_env, T_MARKETS, T_PRICING, DATAGOV_API_KEY, DATAGOV_RESOURCE_ID
from airtable_client import AirtableClient, q

# ---------------------------------------------------------------------------
# Market name mapping
# Exact names as they appear in the data.gov.in API (verified 06/04/2026)
# ---------------------------------------------------------------------------
MARKET_ID_TO_MANDI_NAME = {
    "MKT001": "Pune APMC",
    "MKT002": "Rahuri APMC",
    "MKT003": "Mumbai APMC",
}

# ---------------------------------------------------------------------------
# Sanity bounds for price validation (Rs per kg)
# ---------------------------------------------------------------------------
PRICE_MIN_KG = 2.0
PRICE_MAX_KG = 80.0

def per_kg(quintal_price: float) -> float:
    return round(quintal_price / 100.0, 2)
def format_date_for_airtable(api_date: str) -> str | None:
    """
    Converts API date format (dd/mm/yyyy) to Airtable date format (yyyy-mm-dd).
    Returns None if conversion fails.
    """
    try:
        return datetime.strptime(api_date, "%d/%m/%Y").strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return None
def is_valid_price(price_kg: float) -> bool:
    return PRICE_MIN_KG <= price_kg <= PRICE_MAX_KG

# ---------------------------------------------------------------------------
# fetch_live_price()
# Tries to get today's price first.
# If today has no data, falls back to the most recent available date from API.
# Returns a dict with min, max, modal prices (per kg) + date
# Returns None if API is unavailable or misconfigured.
# ---------------------------------------------------------------------------
def fetch_live_price(market_id: str) -> dict | None:
    if not DATAGOV_API_KEY or not DATAGOV_RESOURCE_ID:
        print(f"  [pricing] API credentials not set — skipping live fetch for {market_id}")
        return None

    mandi_name = MARKET_ID_TO_MANDI_NAME.get(market_id)
    if not mandi_name:
        print(f"  [pricing] No Mandi name mapped for {market_id}")
        return None

    url = f"https://api.data.gov.in/resource/{DATAGOV_RESOURCE_ID}"

    # --- Attempt 1: today's data ---
    today = datetime.now().strftime("%d/%m/%Y")
    params = {
        "api-key": DATAGOV_API_KEY,
        "format": "json",
        "filters[commodity]": "Tomato",
        "filters[market]": mandi_name,
        "limit": 1,
    }

    try:
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        records = r.json().get("records", [])
    except requests.exceptions.Timeout:
        print(f"  [pricing] API timeout for {market_id}")
        return None
    except requests.exceptions.RequestException as e:
        print(f"  [pricing] API request failed for {market_id}: {e}")
        return None

    # Filter for today's date from returned records
    today_records = [rec for rec in records if rec.get("arrival_date") == today]

    if today_records:
        rec = today_records[0]
        source = "api_today"
        print(f"  [pricing] Today's live data found for {market_id} ({mandi_name})")
    else:
        # --- Attempt 2: most recent available date from API ---
        print(f"  [pricing] No data for today ({today}) — fetching most recent available for {market_id}")
        params_recent = {
            "api-key": DATAGOV_API_KEY,
            "format": "json",
            "filters[commodity]": "Tomato",
            "filters[market]": mandi_name,
            "limit": 10,   # fetch a few to find the most recent by date
        }
        try:
            r = requests.get(url, params=params_recent, timeout=15)
            r.raise_for_status()
            recent_records = r.json().get("records", [])
        except requests.exceptions.RequestException as e:
            print(f"  [pricing] API fallback request failed for {market_id}: {e}")
            return None

        if not recent_records:
            print(f"  [pricing] No records available at all from API for {market_id}")
            return None

        # Sort by arrival_date descending to find most recent
        def parse_date(rec):
            try:
                return datetime.strptime(rec.get("arrival_date", "01/01/2000"), "%d/%m/%Y")
            except ValueError:
                return datetime.min

        recent_records.sort(key=parse_date, reverse=True)
        rec = recent_records[0]
        source = "api_recent"
        print(f"  [pricing] Most recent API data for {market_id}: date={rec.get('arrival_date')}")

    # --- Parse and validate all 3 price fields ---
    try:
        min_kg   = per_kg(float(rec.get("min_price", 0)))
        max_kg   = per_kg(float(rec.get("max_price", 0)))
        modal_kg = per_kg(float(rec.get("modal_price", 0)))
    except (TypeError, ValueError) as e:
        print(f"  [pricing] Could not parse prices for {market_id}: {e}")
        return None

    # Sanity check all three
    if not all(is_valid_price(p) for p in [min_kg, max_kg, modal_kg]):
        print(f"  [pricing] Price out of valid range for {market_id}: min={min_kg}, max={max_kg}, modal={modal_kg}")
        return None

    # Logical ordering check: min <= modal <= max
    if not (min_kg <= modal_kg <= max_kg):
        print(f"  [pricing] Price ordering violated for {market_id}: {min_kg} <= {modal_kg} <= {max_kg} is FALSE")
        return None

    print(f"  [pricing] ₹{modal_kg}/kg (modal) | ₹{min_kg}–₹{max_kg}/kg range | source={source}")

    return {
        "price_min": min_kg,
        "price_max": max_kg,
        "price_modal": modal_kg,   # modal is what agents use downstream
        "price_date":  rec.get("arrival_date"),
    }


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------
def main():
    require_env()
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--stub_mode",
        action="store_true",
        help="Generate plausible random prices if API and Airtable both have no data."
    )
    ap.add_argument("--price_timestamp", default=None)
    args = ap.parse_args()

    at = AirtableClient()
    markets = at.list_records(T_MARKETS, max_records=500)
    timestamp = args.price_timestamp or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    created = 0
    updated = 0
    skipped = 0

    for mrec in markets:
        mf = mrec["fields"]
        market_id_text = mf["market_id"]
        market_rec_id  = mrec["id"]

        print(f"\n[pricing] Processing market: {market_id_text}")

        # --- Step 1: Try live API (today first, then most recent fallback) ---
        price_data = fetch_live_price(market_id_text)

        # --- Step 2: If API returned nothing, use existing Airtable values ---
        if price_data is None:
            match = f'{{market_key}}="{q(market_id_text)}"'
            existing = at.get_one(T_PRICING, match)

            if existing:
                ef = existing["fields"]
                # Safely check for the new field first, then the legacy field
                stored_price = ef.get("price_modal", ef.get("price_per_kg"))
                
                if stored_price:
                    print(f"  [pricing] Using stored Airtable price: ₹{stored_price}/kg")
                    skipped += 1
                    continue   # keep existing record — nothing to overwrite

            # --- Step 3: No API, no stored value — use stub if allowed ---
            if args.stub_mode:
                random.seed(hash(market_id_text) & 0xffffffff)
                modal = round(random.uniform(18, 32), 1)
                price_data = {
                    "price_min": round(modal * 0.7, 2),
                    "price_max": round(modal * 1.3, 2),
                    "price_modal":     modal,
                    "price_date":       None,
                }
                print(f"  [pricing] No live or stored price — stub: ₹{modal}/kg")
            else:
                print(f"  [pricing] No data available and stub_mode off — skipping {market_id_text}")
                skipped += 1
                continue

        # --- Step 4: Write all 3 price fields to Airtable ---
        match = f'{{market_key}}="{q(market_id_text)}"'
        existing = at.get_one(T_PRICING, match)

        fields = {
            "market_key":       market_id_text,
            "market_id":        [market_rec_id],              # LINKED RECORD
            "price_min": price_data["price_min"],
            "price_max": price_data["price_max"],
            "price_modal":     price_data["price_modal"],
            "price_date":     price_data.get("price_date"),
        }

        # Only write price_date if we have one (stubs won't have it)
        if price_data.get("price_date"):
            fields["price_date"] = format_date_for_airtable(price_data["price_date"])

        at.upsert_by_formula(T_PRICING, match, fields)

        if existing:
            updated += 1
        else:
            created += 1

    print(json.dumps({
        "status":    "ok",
        "agent":     "pricing_agent",
        "timestamp": timestamp,
        "created":   created,
        "updated":   updated,
        "skipped":   skipped,
    }))

if __name__ == "__main__":
    main()