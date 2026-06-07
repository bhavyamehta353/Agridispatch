# uncertainty_agent.py
# Runs Monte Carlo simulation over uncertain pipeline inputs to produce
# statistical bounds on net_profit and quality_arrival per market.
# Runs AFTER evaluation_agent.py. Overwrites existing results.
#
# Architecture:
# - All 3 markets evaluated together per simulation run
# - Weather + weight draws shared across markets (same conditions)
# - Price + tau draws independent per market
# - Fixed seed per batch for reproducibility
# - MC feasibility gate (70%) overwrites evaluation_agent recommended flag

import argparse, json, math, hashlib
from datetime import datetime, timezone, timedelta
import numpy as np

from config import (
    require_env,
    T_FARMER_BATCHES, T_HANDLING, T_TRAFFIC, T_RISK,
    T_PRICING, T_MARKETS, T_EVAL, T_UNCERTAINTY,
)
from airtable_client import AirtableClient, q, make_pair_key
from math_models import (
    P,
    quality_arrival, logistics_cost, gross_revenue,
    net_profit, quality_adjusted_price,
    k_base, k_eff, equilibrium_adjusted_price,
    MARKET_DAILY_AVG_MT,
)

IST          = timezone(timedelta(hours=5, minutes=30))
N_SIMS       = 1000

# ---------------------------------------------------------------------------
# Uncertainty parameters — standard deviations for each input
# ---------------------------------------------------------------------------
SIGMA_TEMP     = 1.5    # °C — WeatherAPI accuracy
SIGMA_HUMIDITY = 5.0    # % — WeatherAPI humidity accuracy
SIGMA_TAU      = 0.05   # dimensionless — HERE API traffic uncertainty
SIGMA_WEIGHT   = 0.02   # fraction of weight — farmer reporting error (2%)
SIGMA_PRICE    = 0.10   # fraction of price — daily Agmarknet volatility (10%)

# ---------------------------------------------------------------------------
# MC feasibility gate — markets below this threshold are excluded from
# MC-gated recommendation even if they have the highest point-estimate profit
# ---------------------------------------------------------------------------
FEASIBILITY_THRESHOLD = 0.70  # 70%

# ---------------------------------------------------------------------------
# Auto-increment uncertainty_id
# ---------------------------------------------------------------------------
def next_unc_id_base(at: AirtableClient) -> int:
    all_recs = at.list_records(T_UNCERTAINTY, max_records=500)
    max_n    = 0
    for rec in all_recs:
        uid = rec["fields"].get("uncertainty_id", "UNC000")
        try:
            n     = int(uid.replace("UNC", ""))
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

    bf             = batch["fields"]
    batch_rec_id   = batch["id"]
    maturity_grade = bf.get("maturity_grade", "Turning")

    # Determine month
    dispatched_at = bf.get("dispatched_at") or bf.get("harvest_time")
    if dispatched_at:
        try:
            month = datetime.fromisoformat(
                dispatched_at.replace("Z", "+00:00")).strftime("%b")
        except Exception:
            month = datetime.now(IST).strftime("%b")
    else:
        month = datetime.now(IST).strftime("%b")

    # --- Read Handling_Quality ---
    handling = at.get_one(T_HANDLING, f'{{batch_id}}="{q(args.batch_id)}"')
    if not handling:
        raise RuntimeError(f"Handling_Quality not found for {args.batch_id}")

    hf           = handling["fields"]
    q_packed     = float(hf["quality_packed"])
    k_mult_base  = float(hf["k_multiplier"])
    weight_base  = float(hf["weight_packed_kg"])

    # --- Read Markets ---
    markets        = at.list_records(T_MARKETS, max_records=500)
    market_rec_ids = {m["fields"]["market_id"]: m["id"] for m in markets}

    # --- Read stored pipeline values per market ---
    market_data = {}
    pricing_rows = at.list_records(T_PRICING, max_records=500)
    price_map    = {
            r["fields"]["market_key"]: {
                "price_modal": float(r["fields"].get("price_modal", 0) or 0),
                "price_min":   float(r["fields"].get("price_min", 0) or 0),
                "price_max":   float(r["fields"].get("price_max", 0) or 0),
            }
            for r in pricing_rows
            if r.get("fields", {}).get("market_key")
        }

    for market in markets:
        mf        = market["fields"]
        market_id = mf["market_id"]
        pair_key  = make_pair_key(args.batch_id, market_id)

        # Traffic
        tr = at.get_one(T_TRAFFIC, f'{{pair_key}}="{q(pair_key)}"')
        if not tr:
            print(f"  [unc] No Traffic_Estimates for {pair_key} — skipping")
            continue

        tf = tr["fields"]

        # Risk
        rk = at.get_one(T_RISK, f'{{pair_key}}="{q(pair_key)}"')
        if not rk:
            print(f"  [unc] No Environmental_Risk for {pair_key} — skipping")
            continue

        rf = rk["fields"]

        if market_id not in price_map:
            print(f"  [unc] No pricing for {market_id} — skipping")
            continue

        # Market fees
        fee_pct  = float(mf.get("market_fee_pct",   P.MARKET_FEE_PCT))
        comm_pct = float(mf.get("default_commission", P.COMMISSION_PCT))

        market_data[market_id] = {
            "pair_key":      pair_key,
            "market_rec_id": market_rec_ids[market_id],
            "distance_km":   float(tf["distance_km"]),
            "t_base_hr":     float(tf["t_base_hr"]),
            "tau_base":      float(tf["tau"]),
            "avg_temp_c":    float(rf["avg_temp_c"]),
            "avg_humidity":  float(rf["avg_humidity_pct"]),
            "price_modal":   price_map[market_id]["price_modal"],
            "price_min":     price_map[market_id]["price_min"] or None,
            "price_max":     price_map[market_id]["price_max"] or None,
            "fee_pct":       fee_pct,
            "comm_pct":      comm_pct,
            "total_fpo_kg":  0.0,
        }

    # Populate total_fpo_kg from stored Market_Evaluation fpo_supply_adjustment_pct
    for market_id in list(market_data.keys()):
        pair_key = market_data[market_id]["pair_key"]
        ev = at.get_one(T_EVAL, f'{{pair_key}}="{q(pair_key)}"')
        if ev:
            supply_pct   = float(ev["fields"].get("fpo_supply_adjustment_pct", 0) or 0)
            daily_avg_kg = MARKET_DAILY_AVG_MT.get(market_id, 200.0) * 1000
            market_data[market_id]["total_fpo_kg"] = (supply_pct / 100.0) * daily_avg_kg

    if not market_data:
        raise RuntimeError(f"No market data available for {args.batch_id}")

    # ---------------------------------------------------------------------------
    # Monte Carlo simulation
    # ---------------------------------------------------------------------------
    # Fixed seed per batch for reproducibility
    seed = int(hashlib.md5(args.batch_id.encode()).hexdigest()[:8], 16)
    rng  = np.random.default_rng(seed)

    print(f"\n[unc] Running {N_SIMS} simulations for {args.batch_id} "
          f"(seed={seed}, month={month}, maturity={maturity_grade})")

    # Shared draws — same weather and weight for all markets per run
    temp_draws     = rng.normal(0, SIGMA_TEMP,     N_SIMS)  # offsets
    humidity_draws = rng.normal(0, SIGMA_HUMIDITY, N_SIMS)  # offsets
    weight_draws   = rng.normal(1, SIGMA_WEIGHT,   N_SIMS)  # multipliers

    # Per-market independent draws — price and tau
    market_draws = {}
    for market_id in market_data:
        market_draws[market_id] = {
            "price": rng.normal(1, SIGMA_PRICE, N_SIMS),  # multipliers
            "tau":   rng.normal(0, SIGMA_TAU,   N_SIMS),  # offsets
        }

    # Collect per-market results across all runs
    market_results = {mid: {
        "net_profits": [],
        "qas":         [],
        "feasible":    [],
        "recommended": 0,
    } for mid in market_data}

    for i in range(N_SIMS):
        # Shared inputs this run
        weight_sim = max(1.0, weight_base * weight_draws[i])

        # Per-market computation
        run_nets     = {}
        run_feasible = {}

        for market_id, md in market_data.items():
            # Simulate temperature and humidity with shared weather draw
            temp_sim     = md["avg_temp_c"]   + temp_draws[i]
            humidity_sim = md["avg_humidity"] + humidity_draws[i]
            humidity_sim = max(5.0, min(99.0, humidity_sim))  # clamp [5,99]

            # Simulate tau with independent draw, clamped >= 0
            tau_sim = max(0.0, md["tau_base"] + market_draws[market_id]["tau"][i])

            # Simulate price with independent draw
            price_ratio     = market_draws[market_id]["price"][i]
            price_modal_sim = md["price_modal"] * price_ratio
            price_min_sim   = md["price_min"]   * price_ratio if md["price_min"]   is not None else None
            price_max_sim   = md["price_max"]   * price_ratio if md["price_max"]   is not None else None

            # Recompute t_actual from tau_sim
            t_actual_sim = md["t_base_hr"] * (1 + tau_sim)

            # Recompute decay
            kb_sim  = k_base(temp_sim, humidity_sim, month)
            ke_sim  = k_eff(kb_sim, k_mult_base, maturity_grade)
            qa_sim  = quality_arrival(q_packed, ke_sim, t_actual_sim)

            # Quality-adjusted price
            p_eff_sim = quality_adjusted_price(
                qa_sim, price_min_sim, price_modal_sim, price_max_sim
            )

            # Equilibrium correction — FPO volume is deterministic (not simulated)
            p_adj_sim, _ = equilibrium_adjusted_price(
                p_eff_sim, market_id, md["total_fpo_kg"]
            )

            gross_sim = gross_revenue(weight_sim, p_adj_sim)
            log_sim   = logistics_cost(md["distance_km"], md["t_base_hr"], tau_sim)
            net_sim   = net_profit(gross_sim, log_sim, md["fee_pct"], md["comm_pct"])

            feasible_sim = qa_sim >= P.Q_min

            market_results[market_id]["net_profits"].append(net_sim)
            market_results[market_id]["qas"].append(qa_sim)
            market_results[market_id]["feasible"].append(feasible_sim)

            run_nets[market_id]     = net_sim
            run_feasible[market_id] = feasible_sim

        # Determine recommended market this run (for stability tracking)
        feasible_this_run = {
            mid: run_nets[mid]
            for mid in run_nets
            if run_feasible[mid]
        }
        if feasible_this_run:
            winner = max(feasible_this_run, key=lambda m: feasible_this_run[m])
            market_results[winner]["recommended"] += 1

    # ---------------------------------------------------------------------------
    # Compute statistics
    # ---------------------------------------------------------------------------
    print(f"\n  {'Market':<8} {'p10':>10} {'p50':>10} {'p90':>10} "
          f"{'std':>8} {'qa_p50':>8} {'feasib%':>8} {'rec%':>6}")
    print("  " + "-" * 72)

    mc_stats  = {}
    base_id_n = None
    written   = 0

    for market_id, res in market_results.items():
        md = market_data[market_id]

        nets = np.array(res["net_profits"])
        qas  = np.array(res["qas"])

        p10  = round(float(np.percentile(nets, 10)), 2)
        p50  = round(float(np.percentile(nets, 50)), 2)
        p90  = round(float(np.percentile(nets, 90)), 2)
        std  = round(float(np.std(nets)), 2)

        qa_p10 = round(float(np.percentile(qas, 10)), 4)
        qa_p50 = round(float(np.percentile(qas, 50)), 4)
        qa_p90 = round(float(np.percentile(qas, 90)), 4)

        feasibility_prob         = round(float(np.mean(res["feasible"])), 4)
        recommendation_stability = round(res["recommended"] / N_SIMS, 4)

        mc_stats[market_id] = {
            "p10": p10, "p50": p50, "p90": p90, "std": std,
            "qa_p10": qa_p10, "qa_p50": qa_p50, "qa_p90": qa_p90,
            "feasibility_prob":          feasibility_prob,
            "recommendation_stability":  recommendation_stability,
            "md": md,
        }

        print(f"  {market_id:<8} ₹{p10:>8.2f} ₹{p50:>8.2f} ₹{p90:>8.2f} "
              f"₹{std:>6.2f} {qa_p50:>8.4f} "
              f"{feasibility_prob*100:>7.1f}% "
              f"{recommendation_stability*100:>5.1f}%")

    # ---------------------------------------------------------------------------
    # MC feasibility gate — overwrites evaluation_agent's point-estimate flag
    # Markets below FEASIBILITY_THRESHOLD are excluded from MC recommendation
    # even if they have the highest point-estimate net profit.
    # ---------------------------------------------------------------------------
    eligible = {
        mid: s
        for mid, s in mc_stats.items()
        if s["feasibility_prob"] >= FEASIBILITY_THRESHOLD
    }

    fallback_used = False

    if eligible:
        mc_recommended_market = max(eligible, key=lambda mid: eligible[mid]["p50"])
        print(f"\n[unc] MC-gated recommendation: {mc_recommended_market} "
              f"(feasibility={eligible[mc_recommended_market]['feasibility_prob']*100:.1f}%, "
              f"p50=₹{eligible[mc_recommended_market]['p50']:.2f})")
    else:
        # No market clears threshold — fall back to highest feasibility, issue warning
        fallback_used = True
        mc_recommended_market = max(
            mc_stats, key=lambda mid: mc_stats[mid]["feasibility_prob"]
        )
        print(f"\n[unc] WARNING: No market passes {FEASIBILITY_THRESHOLD*100:.0f}% "
              f"feasibility threshold. Falling back to highest feasibility: "
              f"{mc_recommended_market} "
              f"({mc_stats[mc_recommended_market]['feasibility_prob']*100:.1f}%)")

    # Overwrite recommended flag in T_EVAL
    print(f"[unc] Updating T_EVAL recommended flags...")
    for market_id in market_data:
        pair_key = market_data[market_id]["pair_key"]
        match    = f'{{pair_key}}="{q(pair_key)}"'
        existing = at.get_one(T_EVAL, match)
        if existing:
            at.update_record(
                T_EVAL,
                existing["id"],
                {"recommended": (market_id == mc_recommended_market)}
            )
            print(f"  [unc] {market_id}: recommended="
                  f"{market_id == mc_recommended_market}")

    # ---------------------------------------------------------------------------
    # Write to Uncertainty_Analysis
    # ---------------------------------------------------------------------------
    for market_id, stats in mc_stats.items():
        md       = stats["md"]
        pair_key = md["pair_key"]
        match    = f'{{pair_key}}="{q(pair_key)}"'
        existing = at.get_one(T_UNCERTAINTY, match)

        if existing:
            unc_id = existing["fields"].get("uncertainty_id", "UNC000")
        else:
            if base_id_n is None:
                base_id_n = next_unc_id_base(at)
            base_id_n += 1
            unc_id = f"UNC{base_id_n:03d}"

        fields = {
            "uncertainty_id":            unc_id,
            "pair_key":                  pair_key,
            "batch_id":                  [batch_rec_id],
            "market_id":                 [md["market_rec_id"]],
            "n_simulations":             N_SIMS,
            "net_profit_p10":            stats["p10"],
            "net_profit_p50":            stats["p50"],
            "net_profit_p90":            stats["p90"],
            "net_profit_std":            stats["std"],
            "qa_p10":                    stats["qa_p10"],
            "qa_p50":                    stats["qa_p50"],
            "qa_p90":                    stats["qa_p90"],
            "feasibility_prob":          stats["feasibility_prob"],
            "recommendation_stability":  stats["recommendation_stability"],
        }

        at.upsert_by_formula(T_UNCERTAINTY, match, fields)
        written += 1

    print(json.dumps({
        "status":                 "ok",
        "agent":                  "uncertainty_agent",
        "batch_id":               args.batch_id,
        "n_simulations":          N_SIMS,
        "markets":                written,
        "seed":                   seed,
        "mc_recommended_market":  mc_recommended_market,
        "feasibility_threshold":  FEASIBILITY_THRESHOLD,
        "fallback_used":          fallback_used,
    }, indent=2))

if __name__ == "__main__":
    main()