import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { geocode, suggest } from '../shared/sources/geocode';
import { getFmr } from '../shared/sources/hud';
import { fetchStlParcel } from '../shared/sources/stlCity';
import { estimateArv, findSubject, suggestStlAddresses } from '../shared/sources/stlComps';
import { effectiveTaxRate } from '../shared/sources/taxes';
import { resolve } from '../shared/resolve';
import { localRent } from '../shared/rents';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

const withTimeout = (ms: number) => AbortSignal.timeout(ms);

app.get('/api/suggest', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 4 || q.length > 200) return res.json({ suggestions: [] });
  // St. Louis City parcel addresses first: instant and independent of outside services.
  const local = suggestStlAddresses(q).map((label) => ({ label }));
  if (local.length >= 1) return res.json({ suggestions: local });
  const remote = await suggest(q, withTimeout(6000)).catch(() => []);
  const seen = new Set(local.map((s) => s.label.toUpperCase()));
  res.json({ suggestions: [...local, ...remote.filter((s) => !seen.has(s.label.toUpperCase()))].slice(0, 5) });
});

app.post('/api/analyze', async (req, res) => {
  const ref = randomUUID().slice(0, 8);
  const address = String(req.body?.address ?? '').trim();
  const allInCost = Number(req.body?.allInCost);
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
    const subject = inStlCity ? findSubject({ parcelId: parcel?.parcelId, street }) : null;
    if (inStlCity) {
      arv = subject ? estimateArv(subject) : null;
      if (!arv) arvNote = subject ? 'Not enough recent sales of similar properties nearby to estimate ARV.' : 'Property not found in the city parcel records, so no ARV.';
    } else {
      arvNote = `ARV comes from City of St. Louis sales records, so it isn’t available for ${geo.countyName || 'this area'}.`;
    }
    const rent = localRent({ inStlCity, cityNbhd: subject?.nbhd, zip: geo.zip });
    res.json(resolve({ inputAddress: address, geo, allInCost, listing: null, fmr, fmrError, taxRate, parcel, arv, arvNote, localRent: rent }));
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
