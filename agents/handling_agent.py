# handling_agent.py
import argparse, json
from config import require_env, T_FARMER_BATCHES, T_HANDLING
from airtable_client import AirtableClient, q
from math_models import (
    P,
    quality_initial, damage_factor, reject_rate,
    weight_packed, quality_packed, k_multiplier,
    PACKAGING_MAP, FILL_LEVEL_MAP, HARVEST_DAMAGE_MAP,
    PACKAGING_REJECT, MATURITY_REJECT, HARVEST_REJECT,
)

def main():
    require_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch_id", required=True)
    args = ap.parse_args()

    at = AirtableClient()

    # --- Step 1: Read Farmer_Batches ---
    batch = at.get_one(T_FARMER_BATCHES, f'{{batch_id}}="{q(args.batch_id)}"')
    if not batch:
        raise RuntimeError(f"Batch not found: {args.batch_id}")

    b = batch["fields"]
    batch_rec_id      = batch["id"]
    weight_harvest_kg = float(b["weight_harvest_kg"])
    maturity_grade    = b["maturity_grade"]      # Breaker/Turning/Pink/Light Red/Red Ripe
    harvest_method = b.get("harvest_method", "Hand-picked")

    existing_hq = at.get_one(T_HANDLING, f'{{batch_id}}="{q(args.batch_id)}"')
    if existing_hq and existing_hq["fields"].get("packaging_type"):
        packaging_type = existing_hq["fields"]["packaging_type"]
        fill_level     = existing_hq["fields"].get("fill_level", "Medium")
        print(f"  [handling] packaging/fill from HQ: {packaging_type}, {fill_level}")
    else:
        packaging_type = b.get("packaging_type", "Plastic Crate")
        fill_level     = b.get("fill_level", "Medium")
        print(f"  [handling] packaging/fill from Farmer_Batches defaults")

    # --- Step 2: Validate inputs ---
    from math_models import MATURITY_MAP
    if maturity_grade not in MATURITY_MAP:
        raise RuntimeError(
            f"Unknown maturity_grade '{maturity_grade}'. "
            f"Must be one of: {list(MATURITY_MAP.keys())}"
        )
    if harvest_method not in HARVEST_DAMAGE_MAP:
        raise RuntimeError(
            f"Unknown harvest_method '{harvest_method}'. "
            f"Must be one of: {list(HARVEST_DAMAGE_MAP.keys())}"
        )
    if packaging_type not in PACKAGING_MAP:
        raise RuntimeError(
            f"Unknown packaging_type '{packaging_type}'. "
            f"Must be one of: {list(PACKAGING_MAP.keys())}"
        )
    if fill_level not in FILL_LEVEL_MAP:
        raise RuntimeError(
            f"Unknown fill_level '{fill_level}'. "
            f"Must be one of: {list(FILL_LEVEL_MAP.keys())}"
        )

    # --- Step 3: Compute quality_initial from maturity grade ---
    q_initial = quality_initial(maturity_grade)

    # Warn if batch is already marginal before handling
    if q_initial <= P.Q_min:
        print(
            f"  [handling] WARNING: quality_initial={q_initial} is already at or below "
            f"Q_MIN={P.Q_min}. Batch may be infeasible."
        )

    # --- Step 4: Check for duplicate run ---
    existing_handling = at.get_one(T_HANDLING, f'{{batch_id}}="{q(args.batch_id)}"')
    if existing_handling:
        print(f"  [handling] Existing Handling_Quality record found — will update, not create.")

    # --- Step 5: Run all handling formulas ---
    df    = damage_factor(packaging_type, fill_level, harvest_method)
    rr    = reject_rate(packaging_type, maturity_grade, harvest_method)
    wp    = weight_packed(weight_harvest_kg, rr)
    qp    = quality_packed(q_initial, df)
    km    = k_multiplier(df)

    print(f"  [handling] damage_factor={df}, reject_rate={rr}")
    print(f"  [handling] weight_packed={wp}kg, quality_packed={qp}, k_multiplier={km}")

    # --- Step 6: Determine next handling_id ---
    if existing_handling:
        handling_id = existing_handling["fields"].get("handling_id", "HND000")
    else:
        all_handling = at.list_records(T_HANDLING, max_records=500)
        max_n = 0
        for rec in all_handling:
            hid = rec["fields"].get("handling_id", "HND000")
            try:
                n = int(hid.replace("HND", ""))
                max_n = max(max_n, n)
            except ValueError:
                pass
        handling_id = f"HND{max_n + 1:03d}"

    # --- Step 7: Write to Handling_Quality ---
    fields = {
        "handling_id":     handling_id,
        "batch_id":        args.batch_id,          # text reference
        "packaging_type":  packaging_type,
        "fill_level":      fill_level,
        "damage_factor":   round(df, 6),
        "reject_rate":     round(rr, 6),
        "weight_packed_kg": round(wp, 4),
        "quality_packed":  round(qp, 6),
        "k_multiplier":    round(km, 6),
    }

    match = f'{{batch_id}}="{q(args.batch_id)}"'
    result = at.upsert_by_formula(T_HANDLING, match, fields)

    print(json.dumps({
        "status":           "ok",
        "agent":            "handling_agent",
        "batch_id":         args.batch_id,
        "handling_id":      handling_id,
        "quality_initial":  q_initial,
        "damage_factor":    round(df, 6),
        "reject_rate":      round(rr, 6),
        "weight_packed_kg": round(wp, 4),
        "quality_packed":   round(qp, 6),
        "k_multiplier":     round(km, 6),
        "record_id":        result.get("id"),
    }, indent=2))

if __name__ == "__main__":
    main()