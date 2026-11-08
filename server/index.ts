import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { geocode, suggest } from '../shared/sources/geocode';
import { getFmr } from '../shared/sources/hud';
import { fetchStlParcel } from '../shared/sources/stlCity';
import { estimateArv, findSubject } from '../shared/sources/stlComps';
import { effectiveTaxRate } from '../shared/sources/taxes';
import { ALL_IN_PCT_OF_ARV, resolve } from '../shared/resolve';

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
  if (address.length < 5 || address.length > 200) return res.status(400).json({ error: 'Enter a full property address.', ref });

  try {
    const geo = await geocode(address, withTimeout(10000));
    if (!geo) return res.status(422).json({ error: 'We couldn’t find that address. Check the street number and city.', ref });
    if (!(geo.stateFips === '29' && geo.countyFips === '510')) {
      return res.status(422).json({
        error: `Dealwise estimates ARV from City of St. Louis sales records, so it covers St. Louis City addresses only. This one is in ${geo.countyName || 'another area'}, ${geo.state}.`,
        ref,
      });
    }

    let fmrError: string | null = null;
    const street = geo.matchedAddress.split(',')[0];
    const [fmr, taxRate, parcel] = await Promise.all([
      getFmr(geo, withTimeout(10000)).catch(() => {
        fmrError = 'HUD rent data was unavailable right now.';
        return null;
      }),
      effectiveTaxRate(geo.state, geo.stateFips, geo.countyFips, geo.countyName, withTimeout(8000)).catch(() => null),
      fetchStlParcel(street, withTimeout(20000)).catch(() => null),
    ]);

    const subject = findSubject({ parcelId: parcel?.parcelId, street });
    if (!subject) return res.status(422).json({ error: 'We couldn’t find this property in the City of St. Louis parcel records.', ref });
    const arv = estimateArv(subject);
    if (!arv) {
      return res.status(422).json({ error: 'Not enough recent sales of similar properties nearby to estimate an ARV for this address.', ref });
    }
    const allInCost = Math.round((arv.arv * ALL_IN_PCT_OF_ARV) / 1000) * 1000;
    res.json(resolve({ inputAddress: address, geo, allInCost, listing: null, fmr, fmrError, taxRate, parcel, arv }));
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
