# Dealwise v2 — rental deal analyzer

Three inputs: **address**, **all-in cost** (purchase + rehab + closing, from the underwriting spreadsheet) and a
**Zillow link** (used only for rent). The loan equals the all-in cost on a 30-year mortgage at prime (7%).

Cash flow = rent − vacancy (7.5%) − taxes − insurance (0.6% of all-in) − utilities ($75/unit multifamily,
$0 single-family) − maintenance (7.5%) − mortgage. Taxes and unit count come from the official City of
St. Louis parcel record when the address is in the City; otherwise taxes are estimated from the all-in cost.
Rent comes from the listing, else the HUD Fair Market Rent. Targets: DSCR ≥ 1.20 and ≥ $150/unit/month.
Results also show the highest all-in cost that works, the rent needed, cash needed to hit targets, loan
options (30/25/20-year, +1% rate) and, for multifamily, what raises the value (NOI ÷ cap rate).

## Run it

```bash
npm install
npm run build
npm start            # http://localhost:3001
```

Development (hot reload): `npm run dev` → http://localhost:5173. Tests: `npm test`.

Behind an HTTP proxy, Node's fetch needs `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21).

## Free data sources (no keys required)

| Need | Source |
|---|---|
| Address suggestions | Photon (OpenStreetMap) |
| Canonical address, county | US Census Geocoder |
| Market rent | HUD Fair Market Rents (FY2026), via HUD's public ArcGIS service |
| Taxes (fallback) | Approximate statewide effective rate × price |
| Units, size, rent, taxes, condition | The listing page itself, only if it shows the same address |

Optional free keys improve accuracy: `HUD_API_TOKEN` (ZIP-level Small Area FMRs) and `CENSUS_API_KEY`
(county-level tax rates).

## Layout

- `shared/engine/` — deterministic underwriting (workbook formulas, with 4 corrections), defaults, solver
- `shared/sources/` — geocoder, HUD rents, tax rates, listing reader (SSRF-safe), rehab screen
- `shared/resolve.ts` — fills every input from the best available source and labels it
- `shared/financing.ts` — loan options (investor, conventional, FHA house hack, seller financing, seller carryback, rate shock), BRRRR refinance, 50/50 partnership
- `server/` — Express API (`/api/suggest`, `/api/analyze`)
- `web/` — React quick screen
- `tests/` — engine checked against the worked example
