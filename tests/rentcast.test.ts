import { describe, expect, it } from 'vitest';
import house from './fixtures/rentcast-house.json';
import duplexUnit from './fixtures/rentcast-duplex-unit.json';
import { parseRentcast } from '../shared/sources/rentcast';
import { resolve } from '../shared/resolve';
import { localRent } from '../shared/rents';

const geo = (zip: string, countyFips: string) => ({
  matchedAddress: `1 TEST ST, SAINT LOUIS, MO, ${zip}`, houseNumber: '1', streetName: 'TEST', city: 'SAINT LOUIS',
  state: 'MO', zip, stateFips: '29', countyFips, countyName: 'x', lat: 38.6, lon: -90.3,
});
const parcel = (units: number) => ({ parcelId: 'P', units, annualTax: 1500, taxYear: 2025, assessedTotal: 20000, appraisedTotal: 105000, abated: false, zoning: null, yearBuilt: 1914 });

describe('RentCast rent estimates', () => {
  it('parses the rent, range, property record and rental comps', () => {
    const e = parseRentcast(house)!;
    expect(e.rent).toBe(1140);
    expect([e.low, e.high]).toEqual([980, 1300]);
    expect(e.beds).toBe(2);
    expect(e.comps.length).toBeGreaterThan(3);
    expect(e.comps[0].miles).toBeGreaterThan(0);
    expect(parseRentcast({})).toBeNull();
  });

  it('single-family: uses the record bedrooms and the estimate, with the local rule for comparison', () => {
    const a = resolve({
      inputAddress: 'x', geo: geo('63133', '189'), allInCost: 100000, listing: null, fmr: null, fmrError: null, taxRate: null,
      parcel: parcel(1), buildingArea: 1146, localRent: localRent({ inStlCity: false, zip: '63133' }), marketRent: parseRentcast(house),
    });
    expect(a.assumptions.find((r) => r.key === 'beds')!.value).toBe('2');
    const rent = a.assumptions.find((r) => r.key === 'rent')!;
    expect(rent.value).toBe('$1,140/mo');
    expect(rent.note).toMatch(/RentCast/);
    expect(rent.note).toMatch(/Rule of thumb for a 2-bed here: \$1,150/);
    expect(a.marketRent!.comps.length).toBeGreaterThan(3);
  });

  it('multifamily: prices each unit from nearby apartments', () => {
    const a = resolve({
      inputAddress: 'x', geo: geo('63118', '510'), allInCost: 180000, listing: null, fmr: null, fmrError: null, taxRate: null,
      parcel: parcel(2), localRent: null, marketRent: parseRentcast(duplexUnit),
    });
    expect(a.units).toBe(2);
    expect(a.assumptions.find((r) => r.key === 'rent')!.value).toBe('$1,270/mo');
    expect(a.assumptions.find((r) => r.key === 'rent')!.note).toMatch(/per 2-bed unit/);
    expect(a.result.stabilized.grossPotentialIncome).toBe(1270 * 2 * 12);
  });

  it('ignores an estimate made for a different bedroom count', () => {
    const a = resolve({
      inputAddress: 'x', geo: geo('63118', '510'), allInCost: 180000, listing: null, fmr: null, fmrError: null, taxRate: null,
      parcel: parcel(2), buildingArea: 3000, localRent: null, marketRent: parseRentcast(duplexUnit), // 1,500 sf/unit → 3-bed
    });
    expect(a.marketRent).toBeNull();
  });
});
