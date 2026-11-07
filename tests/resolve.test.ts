import { describe, expect, it } from 'vitest';
import { resolve } from '../shared/resolve';
import { parseListing } from '../shared/sources/listing';
import type { GeocodedAddress } from '../shared/sources/geocode';

const geo: GeocodedAddress = {
  matchedAddress: '3520 WYOMING ST, SAINT LOUIS, MO, 63118', houseNumber: '3520', streetName: 'WYOMING',
  city: 'SAINT LOUIS', state: 'MO', zip: '63118', stateFips: '29', countyFips: '510', countyName: 'St. Louis city',
  lat: 38.59, lon: -90.24,
};
const fmr = { byBedrooms: [955, 995, 1218, 1568, 1812] as [number, number, number, number, number], areaName: 'St. Louis, MO-IL HUD Metro FMR Area', year: 'FY2026', zipLevel: false };
const html = `<html><head><meta property="og:title" content="3520 Wyoming St, St. Louis, MO 63118"></head>
<body>Fourplex. 8 beds, 4 baths, 3,600 sq ft. Total monthly rent: $3,400. Annual taxes: $2,150. Needs updating.</body></html>`;
const listing = { ok: true as const, facts: parseListing(html, 'https://example.com/3520-wyoming-st') };
const base = { inputAddress: '3520 Wyoming St', geo, purchasePrice: 300000, fmr, fmrError: null, taxRate: { rate: 0.0091, level: 'state' as const, note: 'MO' } };

describe('resolver', () => {
  const a = resolve({ ...base, listing });
  const src = Object.fromEntries(a.assumptions.map((r) => [r.key, r.source]));

  it('labels every input by source', () => {
    expect(src).toMatchObject({ units: 'listing', currentRent: 'listing', marketRent: 'estimate', taxesCurrent: 'listing', down: 'default', rehab: 'estimate' });
    expect(a.listing.status).toBe('used');
  });

  it('uses multifamily course defaults', () => {
    expect(a.result.acquisition.downPayment).toBe(60000); // 20%
    expect(a.result.stabilized.waterSewerTrash).toBe(150 * 2 * 12); // $150 per 2 units
    expect(a.result.stabilized.lawnSnow).toBe(480);
    expect(a.result.current.grossPotentialIncome).toBe(3400 * 12);
    expect(a.result.stabilized.grossPotentialIncome).toBe(1218 * 4 * 12);
    expect(a.rehab.cost).toBe(50 * 3600);
  });

  it('taxes after purchase are not the historical bill', () => {
    expect(a.result.stabilized.taxes).toBeCloseTo(Math.max(2150 * 1.1, 300000 * 0.0091), 6);
  });

  it('ignores a listing for a different property', () => {
    const other = { ok: true as const, facts: parseListing(html.replaceAll('3520', '4100'), 'https://example.com/4100') };
    const b = resolve({ ...base, listing: other });
    expect(b.listing.status).toBe('mismatch');
    expect(b.result.acquisition.pricePerUnit).toBe(300000); // falls back to 1 unit, flagged
    expect(b.warnings.join(' ')).toMatch(/Unit count not found/);
  });

  it('never silently zeroes missing costs; rent-unknown still solves the required rent', () => {
    const c = resolve({ ...base, listing: null, fmr: null, fmrError: 'HUD down', taxRate: null });
    expect(c.rentKnown).toBe(false);
    expect(c.verdict.status).toBe('rent_unknown');
    expect(c.result.stabilized.taxes).toBeGreaterThan(0);
    expect(c.result.stabilized.insurance).toBeGreaterThan(0);
    expect(c.solutions.requiredMonthlyRent).toBeGreaterThan(0);
  });
});
