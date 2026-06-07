# math_models.py
import math
from dataclasses import dataclass, field
from typing import Dict

# ---------------------------------------------------------------------------
# 1. MATURITY MAP — quality_initial from maturity grade
# Source: USDA ripening stages
# ---------------------------------------------------------------------------
MATURITY_MAP: Dict[str, float] = {
    "Breaker":   0.80,
    "Turning":   0.85,
    "Pink":      0.90,
    "Light Red": 0.92,
    "Red Ripe":  0.95,
}

# ---------------------------------------------------------------------------
# 2. HANDLING MAPS — used to compute damage_factor and reject_rate
# Source: Opara & Pathare 2014; direction verified, magnitudes calibrated
# ---------------------------------------------------------------------------

# Damage contribution per packaging type
PACKAGING_MAP: Dict[str, float] = {
    "Plastic Crate": 0.05,
    "Wooden Crate":  0.10,
    "Gunny Bag":     0.15,
}

# Damage contribution per fill level
FILL_LEVEL_MAP: Dict[str, float] = {
    "Low":    0.05,
    "Medium": 0.07,
    "High":   0.10,
}

# Damage contribution per harvest method
HARVEST_DAMAGE_MAP: Dict[str, float] = {
    "Hand-picked": 0.03,
    "Selective":   0.05,
    "Mixed":       0.10,
}

# Reject rate contribution per packaging type
PACKAGING_REJECT: Dict[str, float] = {
    "Plastic Crate": 0.00,
    "Wooden Crate":  0.01,
    "Gunny Bag":     0.02,
}

# Reject rate contribution per maturity grade
MATURITY_REJECT: Dict[str, float] = {
    "Breaker":   0.01,
    "Turning":   0.00,
    "Pink":      0.00,
    "Light Red": 0.01,
    "Red Ripe":  0.02,
}

# Reject rate contribution per harvest method
HARVEST_REJECT: Dict[str, float] = {
    "Hand-picked": 0.01,
    "Selective":   0.02,
    "Mixed":       0.04,
}

# ---------------------------------------------------------------------------
# 3. DECAY MAPS — maturity-dependent decay multiplier
# Source: Postharvest literature (Kader 2002)
# ---------------------------------------------------------------------------
MATURITY_DECAY: Dict[str, float] = {
    "Breaker":   0.85,   # firm cell walls, longest shelf life
    "Turning":   0.90,
    "Pink":      0.95,
    "Light Red": 1.00,   # reference decay rate
    "Red Ripe":  1.10,   # softened cell walls, fastest decay
}

# ---------------------------------------------------------------------------
# 4. SEASONAL FACTOR — monthly decay scaling for Maharashtra climate
# Calibrated; direction verified against monthly temperature data
# ---------------------------------------------------------------------------
SEASONAL_FACTOR: Dict[str, float] = {
    "Jan": 0.7465, "Feb": 0.9368, "Mar": 1.2625,
    "Apr": 1.6207, "May": 1.5692, "Jun": 1.0012,
    "Jul": 0.7987, "Aug": 0.7779, "Sep": 0.7885,
    "Oct": 0.9048, "Nov": 0.8516, "Dec": 0.7416,
}

# ---------------------------------------------------------------------------
# 5. TRAFFIC DEFAULTS — fallback tau per market if ORS API unavailable
# ---------------------------------------------------------------------------
DEFAULT_TAU: Dict[str, float] = {
    "MKT001": 0.20,
    "MKT002": 0.15,
    "MKT003": 0.30,
}

# ---------------------------------------------------------------------------
# Market Equilibrium Constants — Item 34
# Price elasticity derived from log-log OLS regression
# 3,874 daily observations, Maharashtra APMC markets, Jan 2021 – Apr 2026
# ---------------------------------------------------------------------------
PRICE_ELASTICITY: Dict[str, float] = {
    "MKT001": -0.3514,   # Pune APMC   — n=1,511, R²=0.055
    "MKT002": -0.1462,   # Rahuri APMC — n=928,   R²=0.016
    "MKT003": -0.2340,   # Mumbai APMC — n=1,435, R²=0.041
}

# Average daily tomato arrivals (metric tonnes) — same dataset
MARKET_DAILY_AVG_MT: Dict[str, float] = {
    "MKT001": 204.7,   # Pune APMC
    "MKT002": 4.3,     # Rahuri APMC
    "MKT003": 232.7,   # Mumbai APMC
}
# ---------------------------------------------------------------------------
# 6. MODEL PARAMETERS — all locked constants
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ModelParams:
    # --- Quality thresholds ---
    Q_min: float = 0.60         # USDA Grade 2/3 boundary (USDA 1991; Kader 2002)

    # --- Handling ---
    ALPHA: float = 0.65           # quality degradation coefficient (Opara & Pathare 2014)
    k_mult_beta: float = 0.8      # k_multiplier = 1 + 0.8 * damage_factor

    # --- Decay / Environmental ---
    K_REF: float = 0.015          # hr^-1 at T_REF; transit-scale calibration; Q10=2.23
    T_REF: float = 25.0           # °C standard food science reference
    BETA_TEMP: float = 0.08       # /°C; Q10=2.23 (Van't Hoff 1884; Kader 2002)
    DELTA_HUM: float = 0.00351     # humidity effect (Barkai-Golan 2001)
    DELTA_VPD: float = 0.252462      # VPD effect (Tetens 1930; Shirazi & Cameron 1993)

    # --- Logistics ---
    COST_PER_KM: float = 18.0     # ₹/km; mid-range Maharashtra truck freight
    COST_PER_HR: float = 160.0    # ₹/hr; calibrated estimate
    DELAY_PENALTY: float = 1.5    # delay multiplier on hourly cost
    FIXED_COST: float = 500.0     # ₹; loading, toll, misc per dispatch

    # --- Market fees ---
    MARKET_FEE_PCT: float = 0.01 # 0.5% APMC market fee
    COMMISSION_PCT: float = 0.025  # 2.5% arhatiya commission

P = ModelParams()

# ---------------------------------------------------------------------------
# 7. STAGE 1 — Farmer Batches
# ---------------------------------------------------------------------------
def quality_initial(maturity_grade: str) -> float:
    """Map maturity grade to initial quality score."""
    if maturity_grade not in MATURITY_MAP:
        raise ValueError(f"Unknown maturity_grade: {maturity_grade}. Must be one of {list(MATURITY_MAP.keys())}")
    return MATURITY_MAP[maturity_grade]

# ---------------------------------------------------------------------------
# 8. STAGE 2 — Handling Agent formulas
# ---------------------------------------------------------------------------
def damage_factor(packaging_type: str, fill_level: str, harvest_method: str) -> float:
    """
    Sum of damage contributions from packaging, fill level, and harvest method.
    Clamped to [0, 1].
    """
    df = (
        PACKAGING_MAP.get(packaging_type, 0.10) +
        FILL_LEVEL_MAP.get(fill_level, 0.07) +
        HARVEST_DAMAGE_MAP.get(harvest_method, 0.05)
    )
    return max(0.0, min(1.0, df))

def reject_rate(packaging_type: str, maturity_grade: str, harvest_method: str) -> float:
    """
    Sum of reject contributions. Clamped to [0.01, 0.25].
    """
    rr = (
        PACKAGING_REJECT.get(packaging_type, 0.01) +
        MATURITY_REJECT.get(maturity_grade, 0.01) +
        HARVEST_REJECT.get(harvest_method, 0.02)
    )
    return max(0.01, min(0.25, rr))

def weight_packed(weight_harvest_kg: float, rr: float) -> float:
    """weight_packed_kg = weight_harvest_kg * (1 - reject_rate)"""
    return round(weight_harvest_kg * (1 - rr), 4)

def quality_packed(q_initial: float, df: float) -> float:
    """
    quality_packed = quality_initial * (1 - ALPHA * damage_factor)
    ALPHA = 0.65 (Opara & Pathare 2014)
    Clamped to [0, 1].
    """
    qp = q_initial * (1 - P.ALPHA * df)
    return max(0.0, min(1.0, round(qp, 6)))

def k_multiplier(df: float) -> float:
    """k_multiplier = 1 + 0.8 * damage_factor"""
    return round(1 + P.k_mult_beta * df, 6)

# ---------------------------------------------------------------------------
# 9. STAGE 3 — Traffic Agent formulas
# ---------------------------------------------------------------------------
def traffic_tau(t_actual_hr: float, t_base_hr: float) -> float:
    """tau = (t_actual - t_base) / t_base"""
    return round((t_actual_hr - t_base_hr) / t_base_hr, 6)

# NOTE: t_eff_hr is DEPRECATED. Use t_actual_hr directly in decay formula.

# ---------------------------------------------------------------------------
# 10. STAGE 4 — Risk Agent formulas
# ---------------------------------------------------------------------------
def saturation_vapour_pressure(T: float) -> float:
    """
    es = 0.6108 * exp(17.27 * T / (T + 237.3))  [kPa]
    Tetens (1930)
    """
    return 0.6108 * math.exp(17.27 * T / (T + 237.3))

def vapour_pressure_deficit(T: float, H_pct: float) -> float:
    """
    VPD = es * (1 - H/100)  [kPa]
    Shirazi & Cameron 1993
    """
    es = saturation_vapour_pressure(T)
    return round(es * (1 - H_pct / 100.0), 6)

def k_base(
    T: float,
    H_pct: float,
    month: str,
    k_ref: float = P.K_REF,
    T_ref: float = P.T_REF,
    beta: float = P.BETA_TEMP,
    delta_hum: float = P.DELTA_HUM,
    delta_vpd: float = P.DELTA_VPD,
) -> float:
    """
    humidity_factor = (1 + DELTA_HUM * H) * (1 + DELTA_VPD * VPD)
    k_base = K_REF * SEASONAL_FACTOR[month] * exp(BETA_TEMP * (T - T_REF)) * humidity_factor
    """
    vpd = vapour_pressure_deficit(T, H_pct)
    humidity_factor = (1 + delta_hum * H_pct) * (1 + delta_vpd * vpd)
    seasonal = SEASONAL_FACTOR.get(month, 1.0)
    kb = k_ref * seasonal * math.exp(beta * (T - T_ref)) * humidity_factor
    return round(kb, 8)

def k_eff(kb: float, k_mult: float, maturity_grade: str) -> float:
    """
    k_eff = k_base * k_multiplier * MATURITY_DECAY[maturity_grade]
    """
    decay_factor = MATURITY_DECAY.get(maturity_grade, 1.0)
    return round(kb * k_mult * decay_factor, 8)

def quality_arrival(Q_packed: float, ke: float, t_actual_hr: float) -> float:
    """
    quality_arrival_pred = quality_packed * exp(-k_eff * t_actual_hr)
    Arrhenius (1889) first-order exponential decay.
    Clamped to [0, 1].
    """
    qa = Q_packed * math.exp(-ke * t_actual_hr)
    return max(0.0, min(1.0, round(qa, 6)))

# ---------------------------------------------------------------------------
# 11. STAGE 5 — Pricing Agent formula
# ---------------------------------------------------------------------------
def quality_adjusted_price(
    q: float,
    p_min: float,
    p_modal: float,
    p_max: float,
    q_min: float = P.Q_min,
) -> float:
    """
    Three-point linear interpolation of price based on arrival quality.
    - q >= 0.85       : premium tier, interpolate between modal and max
    - Q_MIN <= q < 0.85: standard tier, interpolate between min and modal
    - q < Q_MIN       : distress sale at 60% of min price
    """
    if p_min is None or p_max is None:
        return p_modal   # fallback if min/max unavailable

    if q >= 0.85:
        return round(p_modal + (p_max - p_modal) * (q - 0.85) / 0.15, 4)
    elif q >= q_min:
        return round(p_min + (p_modal - p_min) * (q - q_min) / (0.85 - q_min), 4)
    else:
        return round(p_min * 0.60, 4)   # distress sale

# ---------------------------------------------------------------------------
# 12. STAGE 6 — Evaluation Agent formulas
# ---------------------------------------------------------------------------
def gross_revenue(weight_packed_kg: float, price_effective: float) -> float:
    """gross_revenue = weight_packed_kg * price_effective"""
    return round(weight_packed_kg * price_effective, 4)

def logistics_cost(
    distance_km: float,
    t_base_hr: float,
    tau: float,
    cost_per_km: float = P.COST_PER_KM,
    cost_per_hr: float = P.COST_PER_HR,
    delay_penalty: float = P.DELAY_PENALTY,
    fixed_cost: float = P.FIXED_COST,
) -> float:
    """
    logistics_cost = (COST_PER_KM * distance_km)
                   + (COST_PER_HR * t_base_hr * (1 + DELAY_PENALTY * tau))
                   + FIXED_COST
    """
    return round(
        (cost_per_km * distance_km)
        + (cost_per_hr * t_base_hr * (1 + delay_penalty * tau))
        + fixed_cost,
        4
    )

def net_profit(gross: float, log_cost: float, fee_pct: float, comm_pct: float) -> float:
    """
    net_profit = gross_revenue * (1 - MARKET_FEE_PCT - COMMISSION_PCT) - logistics_cost
    """
    return round(gross * (1 - fee_pct - comm_pct) - log_cost, 4)

def dispatch_window_hr(Q_packed: float, ke: float, q_min: float = P.Q_min) -> float:
    """
    How many hours until quality drops to Q_MIN.
    dispatch_window_hr = -ln(Q_MIN / quality_packed) / k_eff
    """
    if ke <= 0 or Q_packed <= 0 or Q_packed <= q_min:
        return 0.0
    return round(-math.log(q_min / Q_packed) / ke, 4)

def break_even_price(log_cost, fee_pct, gross, weight_packed_kg, comm_pct):
    """
    Minimum price per kg to break even.
    Quality affects price not mass — qa removed from denominator.
    """
    denom = weight_packed_kg * (1 - comm_pct)
    if denom <= 0:
        return 0.0
    return round((log_cost + fee_pct * gross) / denom, 4)

def confidence_level(qa: float, q_min: float = P.Q_min) -> str:
    margin = round(qa - q_min, 6)   # add round() here
    if margin >= 0.10:
        return "HIGH"
    elif margin >= 0.05:
        return "MEDIUM"
    else:
        return "LOW"

def rejection_reason(
    quality_feasible: bool,
    net_profit_val: float,
    is_recommended: bool,
) -> str | None:
    """Returns a reason code string or None if recommended."""
    if not quality_feasible:
        return "QUALITY_BELOW_THRESHOLD"
    elif net_profit_val < 0:
        return "UNPROFITABLE"
    elif not is_recommended:
        return "HIGHER_PROFIT_ALTERNATIVE_EXISTS"
    return None

def equilibrium_adjusted_price(
    price_effective: float,
    market_id: str,
    fpo_volume_kg: float,
) -> tuple[float, float]:
    """
    Adjusts quality-adjusted price downward based on FPO collective
    supply impact using empirically derived price elasticity.

    Args:
        price_effective : quality-adjusted price before adjustment (₹/kg)
        market_id       : MKT001, MKT002, or MKT003
        fpo_volume_kg   : total kg already dispatched to this market today
                          including current batch

    Returns:
        (adjusted_price, supply_adjustment_pct)
    """
    daily_avg_kg    = MARKET_DAILY_AVG_MT.get(market_id, 200.0) * 1000
    elasticity      = PRICE_ELASTICITY.get(market_id, -0.20)

    supply_pct      = fpo_volume_kg / daily_avg_kg  # fraction not percentage
    adjusted_price  = round(price_effective * ((1 + supply_pct) ** elasticity), 4)

    # Floor at 60% of original — prevent extreme adjustments
    adjusted_price  = max(adjusted_price, price_effective * 0.60)

    return adjusted_price, round(supply_pct * 100, 4)  # price, supply%