# Dealwise v2 — Multifamily Methods deal analyzer

Three inputs (address, purchase price, listing link) → the full Multifamily Methods underwriting:
purchase & financing, current vs. stabilized income and expenses, NOI, DSCR, cash flow, cash-on-cash,
5-year returns (cash flow, tax effect, principal paydown, appreciation, equity), and what price / rent /
down payment would make the deal hit the course targets. Every input is tagged **Listing**, **Estimate**,
**Course rule**, **Verified** or **You**.

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

- `shared/engine/` — deterministic underwriting (workbook formulas, with 4 corrections), course defaults, solver
- `shared/sources/` — geocoder, HUD rents, tax rates, listing reader (SSRF-safe), rehab screen
- `shared/resolve.ts` — fills every input from the best available source and labels it
- `server/` — Express API (`/api/suggest`, `/api/analyze`)
- `web/` — React quick screen
- `tests/` — engine checked against the course's worked example
