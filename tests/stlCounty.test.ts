import { describe, expect, it } from 'vitest';
import { countyArvFrom, type CountyParcel } from '../shared/sources/stlCounty';

const p = (over: Partial<CountyParcel>): CountyParcel => ({
  locator: Math.random().toString(36).slice(2), address: '1 TEST DR', zip: '63135', units: 1, area: 1000,
  yearBuilt: 1955, appraised: 100000, nbhd: 'N1', municipality: 'FERGUSON', taxYear: 2026, ...over,
});

describe('St. Louis County ARV from appraised values', () => {
  const subject = p({ locator: 'SUBJ', area: 1000, appraised: 90000 });
  // $/sq ft of 80, 90, 100, 110, 120, 130 on similar-size single-family homes
  const neighbors = [80, 90, 100, 110, 120, 130].map((psf, i) => p({ locator: `N${i}`, address: `${10 + i} TEST DR`, area: 950 + i * 20, appraised: psf * (950 + i * 20) }));

  it('uses the 75th percentile appraised $/sq ft × the subject size', () => {
    const e = countyArvFrom(subject, neighbors, 'same assessor neighborhood')!;
    expect(e.source).toBe('county-appraisal');
    expect(e.perSqft).toBe(true);
    expect(e.arv).toBe(118000); // 75th pct of 80..130 = 117.5 → $117,500 → rounds to $118,000
    expect(e.compCount).toBe(6);
    expect(e.method).toMatch(/appraised values/);
  });

  it('ignores the subject itself, other property types and very different sizes', () => {
    const mixed = [...neighbors, p({ locator: 'SUBJ', address: 'S', appraised: 9_000_000 }), p({ locator: 'X1', address: 'X1', units: 2, appraised: 9_000_000 }), p({ locator: 'X2', address: 'X2', area: 3000, appraised: 9_000_000 })];
    expect(countyArvFrom(subject, mixed, 'x')!.arv).toBe(118000);
  });

  it('counts a parcel that appears more than once only once', () => {
    const dupes = [...neighbors, ...neighbors.map((n) => ({ ...n })), ...neighbors.map((n) => ({ ...n }))];
    const e = countyArvFrom(subject, dupes, 'x')!;
    expect(e.compCount).toBe(6);
    expect(new Set(e.comps.map((c) => c.address + c.price)).size).toBe(e.comps.length);
  });

  it('needs at least 5 similar properties', () => {
    expect(countyArvFrom(subject, neighbors.slice(0, 4), 'x')).toBeNull();
  });

  it('values 5+ unit buildings per unit', () => {
    const apt = p({ locator: 'APT', units: 24, area: 0 });
    const others = [10, 12, 20, 30, 40].map((u, i) => p({ locator: `A${i}`, address: `${i} APT ST`, units: u, area: 0, appraised: u * (80000 + i * 10000) }));
    const e = countyArvFrom(apt, others, 'x')!;
    expect(e.method).toMatch(/per unit × 24 units/);
    expect(e.arv).toBe(Math.round((110000 * 24) / 1000) * 1000);
  });

  it('skips non-residential parcels', () => {
    expect(countyArvFrom(p({ units: 0 }), neighbors, 'x')).toBeNull();
  });
});
