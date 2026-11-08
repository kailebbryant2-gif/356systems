import { rentEstimate, rentcastEnabled, rentcastUsage } from '../shared/sources/rentcast';
import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { geocode, suggest } from '../shared/sources/geocode';
import { getFmr } from '../shared/sources/hud';
import { fetchStlParcel } from '../shared/sources/stlCity';
import { estimateArv, findSubject, suggestStlAddresses } from '../shared/sources/stlComps';
import { effectiveTaxRate } from '../shared/sources/taxes';
import { bedsFromArea, resolve } from '../shared/resolve';
import { localRent } from '../shared/rents';
import { countyArv, findCountyParcel, suggestCountyAddresses } from '../shared/sources/stlCounty';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

const withTimeout = (ms: number) => AbortSignal.timeout(ms);

// How many RentCast calls this server has used this month (resets on restart).
app.get('/api/status', (_req, res) => {
  res.json({ rentcast: rentcastEnabled() ? rentcastUsage() : 'off (set RENTCAST_API_KEY)' });
});

app.get('/api/suggest', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 4 || q.length > 200) return res.json({ suggestions: [] });
  // St. Louis City parcel addresses first: instant and independent of outside services.
  const local = suggestStlAddresses(q).map((label) => ({ label }));
  if (local.length >= 1) return res.json({ suggestions: local });
  // St. Louis County parcel addresses next (public county parcel service).
  const county = await suggestCountyAddresses(q, withTimeout(4000)).catch(() => []);
  if (county.length >= 1) return res.json({ suggestions: county.map((label) => ({ label })) });
  const remote = await suggest(q, withTimeout(6000)).catch(() => []);
  const seen = new Set(local.map((s) => s.label.toUpperCase()));
  res.json({ suggestions: [...local, ...remote.filter((s) => !seen.has(s.label.toUpperCase()))].slice(0, 5) });
});

app.post('/api/analyze', async (req, res) => {
  const ref = randomUUID().slice(0, 8);
  const address = String(req.body?.address ?? '').trim();
  const allInCost = Number(req.body?.allInCost);
  // Optional: what the student knows about the property, overriding public records.
  const opt = (v: unknown, max: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= max ? n : null;
  };
  const overrides = { units: opt(req.body?.units, 500), beds: opt(req.body?.beds, 2000), sqft: opt(req.body?.sqft, 1_000_000) };
  if (address.length < 5 || address.length > 200) return res.status(400).json({ error: 'Enter a full property address.', ref });
  if (!Number.isFinite(allInCost) || allInCost < 1000 || allInCost > 100_000_000) {
    return res.status(400).json({ error: 'Enter your all-in cost (purchase + rehab + closing) between $1,000 and $100,000,000.', ref });
  }

  try {
    const geo = await geocode(address, withTimeout(10000));
    if (!geo) return res.status(422).json({ error: 'We couldn’t find that address. Check the street number and city.', ref });
    const inStlCity = geo.stateFips === '29' && geo.countyFips === '510';

    let fmrError: string | null = null;
    const street = geo.matchedAddress.split(',')[0];
    const [fmr, taxRate, parcel] = await Promise.all([
      getFmr(geo, withTimeout(10000)).catch(() => {
        fmrError = 'HUD rent data was unavailable right now.';
        return null;
      }),
      effectiveTaxRate(geo.state, geo.stateFips, geo.countyFips, geo.countyName, withTimeout(8000)).catch(() => null),
      inStlCity ? fetchStlParcel(street, withTimeout(20000)).catch(() => null) : Promise.resolve(null),
    ]);

    // ARV from City sales records (St. Louis City only).
    let arvNote: string | null = null;
    let arv = null;
    let countyUnits: typeof parcel = null;
    let buildingArea: number | null = null;
    const found = inStlCity ? findSubject({ parcelId: parcel?.parcelId, street }) : null;
    const subject = found && {
      ...found,
      units: overrides.units ?? found.units,
      area: overrides.sqft ?? (overrides.units && overrides.units !== found.units ? 0 : found.area),
    };
    if (inStlCity) {
      arv = subject ? estimateArv(subject) : null;
      if (!arv) arvNote = subject ? 'Not enough recent sales of similar properties nearby to estimate ARV.' : 'Property not found in the city parcel records, so no ARV.';
    } else if (geo.stateFips === '29' && geo.countyFips === '189') {
      // St. Louis County: appraised values of similar nearby homes (no public sale prices in Missouri).
      const rec = await findCountyParcel(street, geo.zip, withTimeout(12000)).catch(() => null);
      const cp = rec && { ...rec, units: overrides.units ?? rec.units, area: overrides.sqft ?? rec.area };
      buildingArea = cp?.area || null;
      arv = cp ? await countyArv(cp, withTimeout(15000)).catch(() => null) : null;
      if (cp && cp.units >= 1) {
        countyUnits = { parcelId: cp.locator, units: cp.units, annualTax: null, taxYear: null, assessedTotal: null, appraisedTotal: cp.appraised, abated: false, zoning: null, yearBuilt: cp.yearBuilt };
      }
      if (!arv) arvNote = cp ? (cp.units < 1 ? 'This isn’t a residential parcel in the county records, so no ARV.' : 'Not enough similar properties nearby to estimate ARV.') : 'Property not found in the St. Louis County parcel records, so no ARV.';
    } else {
      arvNote = `ARV is available for St. Louis City and St. Louis County addresses only.`;
    }
    if (subject?.area) buildingArea = subject.area;
    const rent = localRent({ inStlCity, cityNbhd: subject?.nbhd, zip: geo.zip });
    // Market rent from nearby rentals (RentCast): one paid call per address, cached.
    const recordUnits = Math.max(overrides.units ?? (parcel ?? countyUnits)?.units ?? 1, 1);
    const area = overrides.sqft ?? buildingArea;
    const bedsPerUnit = overrides.beds ? overrides.beds / recordUnits : area ? bedsFromArea(area / recordUnits) : 2;
    const marketRent = await rentEstimate(
      geo.matchedAddress,
      { units: recordUnits, bedsPerUnit, sqftPerUnit: area ? area / recordUnits : null },
      withTimeout(10000),
    ).catch(() => null);
    res.json(resolve({ inputAddress: address, geo, allInCost, listing: null, fmr, fmrError, taxRate, parcel: parcel ?? countyUnits, arv, arvNote, localRent: rent, buildingArea, overrides, marketRent }));
  } catch (e) {
    console.error(`[${ref}]`, e);
    res.status(502).json({ error: 'A data source didn’t respond. Please try again in a minute.', ref });
  }
});

if (process.env.NODE_ENV === 'production') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// Load the bundled St. Louis data up front so the first request is fast.
suggestStlAddresses('1 A');

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Dealwise API on http://localhost:${port}`));
