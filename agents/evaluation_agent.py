# evaluation_agent.py
import argparse, json
from config import (
    require_env, T_HANDLING, T_TRAFFIC, T_RISK,
    T_MARKETS, T_PRICING, T_EVAL, T_FARMER_BATCHES
)
from airtable_client import AirtableClient, q, make_pair_key
from math_models import (
    P, quality_adjusted_price, gross_revenue, logistics_cost,
    net_profit, dispatch_window_hr, break_even_price,
    confidence_level, rejection_reason,
    equilibrium_adjusted_price,    # ADD THIS
)

# ---------------------------------------------------------------------------
# Auto-increment evaluation_id
# ---------------------------------------------------------------------------
def next_eval_id_base(at: AirtableClient) -> int:
    all_recs = at.list_records(T_EVAL, max_records=500)
    max_n = 0
    for rec in all_recs:
        eid = rec["fields"].get("evaluation_id", "EVAL000")
        try:
            n = int(eid.replace("EVAL", ""))
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

    batch_rec_id = batch["id"]

    # --- Read Handling_Quality ---
    handling = at.get_one(T_HANDLING, f'{{batch_id}}="{q(args.batch_id)}"')
    if not handling:
        raise RuntimeError(f"Handling_Quality not found for {args.batch_id}")

    h = handling["fields"]
    weight_packed_kg = float(h["weight_packed_kg"])
    Q_packed         = float(h["quality_packed"])
    k_mult           = float(h["k_multiplier"])

    # --- Read Markets ---
    markets        = at.list_records(T_MARKETS, max_records=500)
    market_rec_ids = {m["fields"]["market_id"]: m["id"] for m in markets}
    fee_map        = {m["fields"]["market_id"]: float(m["fields"].get("market_fee_pct", P.MARKET_FEE_PCT))
                      for m in markets}
    comm_map       = {m["fields"]["market_id"]: float(m["fields"].get("default_commission", P.COMMISSION_PCT))
                      for m in markets}

    # --- Read Market_Pricing ---
    pricing_rows = at.list_records(T_PRICING, max_records=500)
    price_map = {}
    for r in pricing_rows:
        f = r.get("fields", {})
        mk = f.get("market_key")
        if mk:
            price_map[mk] = {
                "price_modal": float(f.get("price_modal", f.get("price_per_kg", 0)) or 0),
                "price_min":   float(f.get("price_min", 0) or 0),
                "price_max":   float(f.get("price_max", 0) or 0),
            }

    # --- Query FPO supply per market (status=dispatched) ---
    # Step 1: Fetch all dispatched batch_ids in ONE call
    all_batches = at.list_records(T_FARMER_BATCHES, max_records=500)
    current_date = batch["fields"].get("harvest_time", "")[:10]

    dispatched_batch_ids = {
        b["fields"]["batch_id"]
        for b in all_batches
        if b["fields"].get("Status") == "dispatched"
        and b["fields"].get("batch_id") != args.batch_id  # exclude current
        and b["fields"].get("harvest_time", "")[:10] == current_date  # same day only
    }

    print(f"[eval] Dispatched batches found: {dispatched_batch_ids}")

    # Step 2: Fetch all evaluation records in ONE call
    fpo_volume_kg = {mid: 0.0 for mid in market_rec_ids}

    dispatched_evals = at.list_records(T_EVAL, max_records=500)
    for rec in dispatched_evals:
        ef       = rec.get("fields", {})
        rec_pair = ef.get("pair_key", "")
        if not rec_pair:
            continue

        parts = rec_pair.split("|")
        if len(parts) != 2:
            continue

        rec_batch  = parts[0]
        rec_market = parts[1]

        # O(1) lookup — no API call inside loop
        if rec_batch not in dispatched_batch_ids:
            continue

        if rec_market in fpo_volume_kg:
            if ef.get("recommended", False):
                weight = float(ef.get("effective_weight_kg", 0) or 0)
                fpo_volume_kg[rec_market] += weight

    print(f"[eval] FPO supply already dispatched:")
    for mid, vol in fpo_volume_kg.items():
        print(f"  {mid}: {round(vol,1)}kg")

    # --- Per-market evaluation ---
    results = {}

    base_id_n = None

    for market_id in market_rec_ids:
        pair_key = make_pair_key(args.batch_id, market_id)
        print(f"\n[eval] Processing {pair_key}")

        # Read Traffic_Estimates
        tr = at.get_one(T_TRAFFIC, f'{{pair_key}}="{q(pair_key)}"')
        if not tr:
            print(f"  [eval] No Traffic_Estimates — skipping")
            continue

        tf          = tr["fields"]
        distance_km = float(tf["distance_km"])
        t_base_hr   = float(tf["t_base_hr"])
        t_actual_hr = float(tf["t_actual_hr"])
        tau         = float(tf["tau"])

        # Read Environmental_Risk
        rk = at.get_one(T_RISK, f'{{pair_key}}="{q(pair_key)}"')
        if not rk:
            print(f"  [eval] No Environmental_Risk — skipping")
            continue

        rf = rk["fields"]
        qa = float(rf["quality_arrival_pred"])
        ke = float(rf["k_eff"])

        # Read pricing
        if market_id not in price_map:
            print(f"  [eval] No pricing for {market_id} — skipping")
            continue

        prices      = price_map[market_id]
        p_modal     = prices["price_modal"]
        p_min       = prices["price_min"] if prices["price_min"] > 0 else None
        p_max       = prices["price_max"] if prices["price_max"] > 0 else None

        # Market fees
        fee_pct  = fee_map.get(market_id, P.MARKET_FEE_PCT)
        comm_pct = comm_map.get(market_id, P.COMMISSION_PCT)

        # --- Stage 5 formula: quality-adjusted price ---
        p_effective = quality_adjusted_price(qa, p_min, p_modal, p_max)

        # --- Item 34: Market equilibrium price adjustment ---
        # Include current batch weight in FPO supply
        total_fpo_kg = fpo_volume_kg.get(market_id, 0.0) + weight_packed_kg
        p_adjusted, supply_pct = equilibrium_adjusted_price(
            p_effective, market_id, total_fpo_kg
        )

        print(f"  [eval] FPO supply to {market_id}: {round(total_fpo_kg,1)}kg "
            f"({round(supply_pct,2)}% of daily avg) → "
            f"price {round(p_effective,4)} → {round(p_adjusted,4)}")

        # --- Stage 6 formulas ---
        gross   = gross_revenue(weight_packed_kg, p_adjusted)
        log_cost = logistics_cost(distance_km, t_base_hr, tau)
        net     = net_profit(gross, log_cost, fee_pct, comm_pct)
        feasible = qa >= P.Q_min

        # Dispatch window
        dw_hr = dispatch_window_hr(Q_packed, ke) if ke > 0 else 0.0

        # Break-even price — only for infeasible markets
        bep = None
        if feasible and net < 0:
            bep = break_even_price(log_cost, fee_pct, gross,
                                   weight_packed_kg, comm_pct)

        # Confidence level
        conf = confidence_level(qa)

        print(f"  [eval] qa={round(qa,4)}, p_eff=₹{p_effective}, "
              f"gross=₹{round(gross,2)}, log=₹{round(log_cost,2)}, "
              f"net=₹{round(net,2)}, feasible={feasible}")

        results[market_id] = {
            "pair_key":          pair_key,
            "market_rec_id":     market_rec_ids[market_id],
            "distance_km":       distance_km,
            "t_base_hr":         t_base_hr,
            "tau":               tau,
            "arrival_quality":   round(qa, 4),
            "price_modal":       p_modal,
            "price_effective":   p_effective,
            "fee_pct":           fee_pct,
            "comm_pct":          comm_pct,
            "gross_revenue":     round(gross, 2),
            "logistics_cost":    round(log_cost, 2),
            "net_profit":        round(net, 2),
            "quality_feasible":  feasible,
            "dispatch_window_hr": round(dw_hr, 4),
            "break_even_price":  round(bep, 4) if bep is not None else None,
            "confidence_level":  conf,
            "fpo_supply_pct":   round(supply_pct, 4),
            "price_equilibrium_adjusted": p_adjusted,
        }

    if not results:
        raise RuntimeError(f"No market evaluations completed for {args.batch_id}")

    # --- Determine recommended market ---
    # Highest net_profit among feasible markets
    feasible_markets = {mid: r for mid, r in results.items()
                        if r["quality_feasible"]}

    recommended_market = None
    if feasible_markets:
        recommended_market = max(feasible_markets,
                                 key=lambda mid: feasible_markets[mid]["net_profit"])
        print(f"\n[eval] Recommended: {recommended_market} "
              f"(net_profit=₹{feasible_markets[recommended_market]['net_profit']})")
    else:
        print(f"\n[eval] No feasible markets for {args.batch_id}")

    # --- Write to Market_Evaluation ---
    created = 0
    updated = 0

    for market_id, r in results.items():
        pair_key = r["pair_key"]
        is_recommended = (market_id == recommended_market)

        rej_reason = rejection_reason(
            r["quality_feasible"],
            r["net_profit"],
            is_recommended,
        )

        match    = f'{{pair_key}}="{q(pair_key)}"'
        existing = at.get_one(T_EVAL, match)

        if existing:
            eval_id = existing["fields"].get("evaluation_id", "EVAL000")
        else:
            if base_id_n is None:
                base_id_n = next_eval_id_base(at)
            base_id_n += 1
            eval_id = f"EVAL{base_id_n:03d}"

        fields = {
            "evaluation_id":      eval_id,
            "pair_key":           pair_key,
            "batch_id":           [batch_rec_id],              # LINKED
            "market_id":          [r["market_rec_id"]],        # LINKED
            "arrival_quality":    r["arrival_quality"],
            "effective_weight_kg": weight_packed_kg,
            "price_effective":    r["price_effective"],
            "price_modal":        r["price_modal"],
            "market_fee_pct":     r["fee_pct"],
            "commission_pct":     r["comm_pct"],
            "gross_revenue":      r["gross_revenue"],
            "logistics_cost":     r["logistics_cost"],
            "net_profit":         r["net_profit"],
            "quality_feasible":   r["quality_feasible"],
            "recommended":        is_recommended,              # checkbox
            "dispatch_window_hr": r["dispatch_window_hr"],
            "confidence_level":   r["confidence_level"],
            "fpo_supply_adjustment_pct":  r["fpo_supply_pct"],
            "price_equilibrium_adjusted": r["price_equilibrium_adjusted"],
        }

        fields["rejection_reason"] = rej_reason if rej_reason else ""

        fields["break_even_price"] = r["break_even_price"] if r["break_even_price"] is not None else None

        at.upsert_by_formula(T_EVAL, match, fields)

        if existing:
            updated += 1
        else:
            created += 1

    # --- Update Farmer_Batches status ---
    at.update_record(T_FARMER_BATCHES, batch_rec_id, {"Status": "dispatched"})

    print(json.dumps({
        "status":             "ok",
        "agent":              "evaluation_agent",
        "batch_id":           args.batch_id,
        "recommended_market": recommended_market,
        "markets_evaluated":  len(results),
        "feasible_markets":   len(feasible_markets),
        "created":            created,
        "updated":            updated,
    }, indent=2))

if __name__ == "__main__":
    main()