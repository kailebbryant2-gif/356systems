import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { geocode, suggest } from '../shared/sources/geocode';
import { getFmr } from '../shared/sources/hud';
import { fetchStlParcel } from '../shared/sources/stlCity';
import { fetchListing } from '../shared/sources/listing';
import { effectiveTaxRate } from '../shared/sources/taxes';
import { resolve } from '../shared/resolve';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

const withTimeout = (ms: number) => AbortSignal.timeout(ms);

app.get('/api/suggest', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 4 || q.length > 200) return res.json({ suggestions: [] });
  try {
    res.json({ suggestions: await suggest(q, withTimeout(9000)) });
  } catch {
    res.json({ suggestions: [] });
  }
});

app.post('/api/analyze', async (req, res) => {
  const ref = randomUUID().slice(0, 8);
  const address = String(req.body?.address ?? '').trim();
  const allInCost = Number(req.body?.allInCost);
  const listingUrl = String(req.body?.listingUrl ?? '').trim();

  if (address.length < 5 || address.length > 200) return res.status(400).json({ error: 'Enter a full property address.', ref });
  if (!Number.isFinite(allInCost) || allInCost < 1000 || allInCost > 100_000_000) {
    return res.status(400).json({ error: 'Enter an all-in cost between $1,000 and $100,000,000.', ref });
  }
  if (listingUrl && (listingUrl.length > 2000 || !/^https?:\/\//i.test(listingUrl))) {
    return res.status(400).json({ error: 'The listing link should start with http:// or https://.', ref });
  }

  try {
    const geo = await geocode(address, withTimeout(10000));
    if (!geo) return res.status(422).json({ error: 'We couldn’t find that address. Check the street number and city.', ref });

    let fmrError: string | null = null;
    const inStlCity = geo.stateFips === '29' && geo.countyFips === '510';
    const [listing, fmr, taxRate, parcel] = await Promise.all([
      listingUrl ? fetchListing(listingUrl) : Promise.resolve(null),
      getFmr(geo, withTimeout(10000)).catch(() => {
        fmrError = 'HUD rent data was unavailable right now.';
        return null;
      }),
      effectiveTaxRate(geo.state, geo.stateFips, geo.countyFips, geo.countyName, withTimeout(8000)).catch(() => null),
      inStlCity ? fetchStlParcel(geo.matchedAddress.split(',')[0], withTimeout(20000)).catch(() => null) : Promise.resolve(null),
    ]);

    res.json(resolve({ inputAddress: address, geo, allInCost, listing, fmr, fmrError, taxRate, parcel }));
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

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`Dealwise API on http://localhost:${port}`));
