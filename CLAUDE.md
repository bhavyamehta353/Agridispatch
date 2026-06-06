# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev Server

The `next` binary is blocked by macOS system policy on this machine. Run the dev server like this:

```bash
node node_modules/next/dist/bin/next dev --webpack
```

The `--webpack` flag is required because Turbopack also requires a native binary that is blocked. The `lightningcss-darwin-arm64` package must be installed separately if missing:

```bash
npm install lightningcss-darwin-arm64@1.32.0
```

## Architecture

This is a **Next.js 16 App Router** frontend for the AgriDispatch pre-dispatch decision support system for tomato supply chains in Maharashtra. The Python pipeline agents live in `agents/` (copied from the parent repo) and run separately via n8n — they are not invoked by the Next.js app at runtime.

### Two systems in one repo

| Layer | Location | Runtime |
|---|---|---|
| Python pipeline | `agents/` | n8n orchestration (external) |
| Next.js dashboard | `app/` | Node.js / Vercel |

### Python agent pipeline order
1. `pricing_agent.py` — Agmarknet live prices → T_PRICING
2. `handling_agent.py` — damage factor, quality_packed, k_multiplier → T_HANDLING
3. `traffic_agent.py` — HERE API congestion τ → T_TRAFFIC
4. `risk_agent.py` — WeatherAPI k_base/k_eff/quality_arrival → T_RISK
5. `evaluation_agent.py` — revenue, logistics cost, market recommendation → T_EVAL
6. `uncertainty_agent.py` — Monte Carlo (N=1000, MD5 seed) feasibility gate → T_UNCERTAINTY

`agents/math_models.py` is the **single source of truth** for all constants and formulas. Do not duplicate or deviate from the constants defined there.

### Locked constants (never change without explicit instruction)
```python
K_REF=0.015, T_REF=25.0, BETA_TEMP=0.08, DELTA_HUM=0.00351, DELTA_VPD=0.252462
COST_PER_KM=18, COST_PER_HR=160, MARKET_FEE_PCT=0.01, Q_MIN=0.60
```
Price elasticity (log-log OLS): Pune −0.3514, Rahuri −0.1462, Mumbai −0.2340.
Equilibrium price formula: power form `p_eq = p_eff × (1 + s_f)^β1` — not linear.

### Next.js app structure

```
app/
  api/                    # All API routes (Next.js route handlers)
    auth/login|logout|signup/
    batch-overview/       # Paginated batch table with stats
    batches/[recordId]/   # Detail, evaluate, recommendation, risk, audit
    farmer-intake/        # Creates Airtable records for new batches
    market-pricing/       # APMC prices (GET overview + POST new record)
    traffic-overview/     # Aggregated route + env data for /traffic page
    handling|traffic|risk|evaluation|markets|pricing|routes/
  batches/[recordId]/     # Batch detail page (RecommendationClient)
  farmer/                 # Harvest intake form
  pricing/                # Market pricing panel
  traffic/                # Route conditions map + exposure table
  lib/
    airtable.ts           # Airtable JS SDK base instance
    auth.ts               # Custom HMAC-SHA256 JWT (no third-party auth lib)
    mongodb.ts            # MongoDB Atlas connection (user accounts)
    maturity.ts           # FARMER_MATURITY_OPTIONS with swatch colours
    origins.ts            # Farm origin coords (FARM001–FARM004)
    route-conditions-health.ts  # CombinedRouteHealth type + drawer logic
    date-freshness.ts / traffic-freshness.ts / environmental-freshness.ts
  components/
    logout-button.tsx
    pricing-freshness-banner.tsx
  layout.tsx              # Root layout — suppressHydrationWarning on <html>
  globals.css             # Tailwind CSS v4 global styles
middleware.ts             # Edge JWT verification + role-based route gating
```

### Auth system

Custom JWT — no NextAuth or similar. Tokens are HMAC-SHA256 signed, stored as `auth_token` HttpOnly cookie (7-day TTL). The signing secret is `JWT_SECRET` → `AUTH_SECRET` → `MONGODB_URL` (fallback order). User accounts live in MongoDB Atlas (`fyp` database). Roles: `admin`, `farmers`, `logistics`.

Middleware (`middleware.ts`) runs on edge runtime and gates `/batches`, `/farmer`, `/pricing`, `/traffic` by role. Role→page access:
- `admin`: all four
- `farmers`: batches, farmer, pricing
- `logistics`: batches, pricing, traffic

### Airtable

All operational data (batches, handling, traffic, risk, evaluation, pricing, markets) lives in Airtable base `appMNYsLWy5pxGJFG`. The JS SDK client is at `app/lib/airtable.ts`. Table names match the Python agent config:

| Env var | Default table name |
|---|---|
| T_FARMER_BATCHES | Farmer_Batches |
| T_HANDLING | Handling_Quality |
| T_TRAFFIC | Traffic_Estimates |
| T_RISK | Environmental_Risk |
| T_MARKETS | Markets |
| T_PRICING | Market_Pricing |
| T_EVAL | Market_Evaluation |
| T_UNCERTAINTY | Uncertainty_Analysis |

### Key domain rules enforced in UI
- **Q_MIN = 0.60** — batches below this show a ⚠ warning; feasibility gate is 70% Monte Carlo pass rate
- **AGMARK maturity grades** (not USDA terminology): Breaker, Turning, Pink, Light Red, Red Ripe
- **Pricing is append-only** — each edit creates a new Market_Pricing record; history is never overwritten
- **Same-day dispatch supply** filters by `harvest_time[:10]` date match, not `status=dispatched`
- **Maturity swatches** are defined in `app/lib/maturity.ts` and must stay consistent with `agents/math_models.py` MATURITY_MAP order

### Environment variables

The Next.js app needs `.env.local`:
```
AIRTABLE_API_KEY=        # Airtable personal access token
AIRTABLE_BASE_ID=appMNYsLWy5pxGJFG
MONGODB_URL=             # MongoDB Atlas connection string
JWT_SECRET=              # Optional; falls back to MONGODB_URL if absent
HERE_API_KEY=            # HERE Routing API (used by traffic agent)
WEATHERAPI_KEY=          # WeatherAPI.com Business Plan
DATAGOV_API_KEY=         # data.gov.in Agmarknet
DATAGOV_RESOURCE_ID=9ef84268-d588-465a-a308-a864a43d0070
```

The Python agents need a `.env` file in `agents/` with `AIRTABLE_TOKEN` (same value as `AIRTABLE_API_KEY` above).
