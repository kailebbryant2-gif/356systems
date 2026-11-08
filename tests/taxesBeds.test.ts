import { describe, expect, it } from 'vitest';
import { bedsFromArea, resolve } from '../shared/resolve';
import type { ArvEstimate } from '../shared/sources/stlComps';

const geo = {
  matchedAddress: '3520 WYOMING ST, SAINT LOUIS, MO, 63118', houseNumber: '3520', streetName: 'WYOMING', city: 'SAINT LOUIS',
  state: 'MO', zip: '63118', stateFips: '29', countyFips: '510', countyName: 'St. Louis city', lat: 38.59, lon: -90.24,
};
const parcel = { parcelId: '1488-9-070.000', units: 1, annualTax: 2297.48, taxYear: 2025, assessedTotal: 29740, appraisedTotal: 156511, abated: false, zoning: null, yearBuilt: 1906 };
const arv = (value: number): ArvEstimate => ({
  arv: value, low: value, high: value, method: 'test', basis: 'rehab-median', perSqft: false, area: 'x', comps: [], compCount: 3,
  latestSale: '2026-07-01', source: 'city-sales', subject: { parcelId: 'p', address: 'a', units: 1, area: 0, yearBuilt: null, nbhd: '25' },
});

describe('taxes after the rehab', () => {
  it('reassesses at ARV × 19% × the property’s own rate (bill ÷ assessed value)', () => {
    const a = resolve({ inputAddress: 'x', geo, allInCost: 200000, listing: null, fmr: null, fmrError: null, taxRate: null, parcel, arv: arv(300000) });
    const rate = 2297.48 / 29740; // ≈ $7.73 per $100
    expect(a.taxBasis).toBe('reassessed');
    expect(a.result.stabilized.taxes).toBeCloseTo(300000 * 0.19 * rate, 6);
    expect(a.assumptions.find((r) => r.key === 'taxes')!.label).toBe('Property taxes (after rehab)');
  });

  it('keeps today’s bill when it’s already higher than the reassessed amount', () => {
    const a = resolve({ inputAddress: 'x', geo, allInCost: 90000, listing: null, fmr: null, fmrError: null, taxRate: null, parcel, arv: arv(100000) });
    expect(a.taxBasis).toBe('bill');
    expect(a.result.stabilized.taxes).toBe(2297.48);
  });

  it('without an ARV, uses today’s bill', () => {
    const a = resolve({ inputAddress: 'x', geo, allInCost: 200000, listing: null, fmr: null, fmrError: null, taxRate: null, parcel });
    expect(a.taxBasis).toBe('bill');
  });
});

describe('bedrooms from living area', () => {
  it('maps sq ft per unit to bedrooms', () => {
    expect([550, 720, 1200, 1800].map(bedsFromArea)).toEqual([1, 2, 3, 4]);
  });

  it('a 1,400 sq ft single-family is a 3-bed; a 1,568 sq ft duplex is two 2-beds', () => {
    const sf = resolve({ inputAddress: 'x', geo, allInCost: 150000, listing: null, fmr: null, fmrError: null, taxRate: null, parcel, buildingArea: 1400 });
    expect(sf.assumptions.find((r) => r.key === 'beds')!.value).toBe('3');
    const dx = resolve({ inputAddress: 'x', geo, allInCost: 150000, listing: null, fmr: null, fmrError: null, taxRate: null, parcel: { ...parcel, units: 2 }, buildingArea: 1568 });
    expect(dx.assumptions.find((r) => r.key === 'beds')!.value).toBe('2');
  });
});
