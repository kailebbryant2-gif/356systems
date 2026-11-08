import { describe, expect, it } from 'vitest';
import deals from './fixtures/community-deals.json';
import { estimateArv, findSubject } from '../shared/sources/stlComps';
import { countyMarketFactor } from '../shared/sources/stlCounty';
import { resolve } from '../shared/resolve';
import { localRent } from '../shared/rents';

const err = (est: number, real: number) => Math.abs(est - real) / real;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

describe('ARV benchmark: community deals with MLS-backed ARVs', () => {
  it('City: nearby renovated sales land close to the real ARV', () => {
    const errors = deals.city.map((d) => {
      const s = findSubject({ street: d.address })!;
      expect(s, d.address).toBeTruthy();
      const e = estimateArv(d.sqft ? { ...s, units: 1, area: d.sqft } : s)!;
      return err(e.arv, d.arv);
    });
    expect(median(errors)).toBeLessThanOrEqual(0.15); // was 22% when comps were picked by assessor neighborhood
    expect(Math.max(...errors)).toBeLessThanOrEqual(0.3);
  });

  it('County: appraisal estimate × the area factor lands close to the real ARV', () => {
    const errors = deals.county.map((d) => err(d.appraisalEstimate * (countyMarketFactor(d.zip)?.factor ?? 1), d.arv));
    const unadjusted = deals.county.map((d) => err(d.appraisalEstimate, d.arv));
    expect(median(unadjusted)).toBeGreaterThan(0.2);
    expect(median(errors)).toBeLessThanOrEqual(0.08);
    expect(Math.max(...errors)).toBeLessThanOrEqual(0.2);
  });

  it('area factors: inner North County > Florissant > South County; none elsewhere', () => {
    expect(countyMarketFactor('63136')!.factor).toBeGreaterThan(countyMarketFactor('63033')!.factor);
    expect(countyMarketFactor('63033')!.factor).toBeGreaterThan(countyMarketFactor('63125')!.factor);
    expect(countyMarketFactor('63105')).toBeNull(); // Clayton: no evidence, no adjustment
  });
});

describe('what the student enters overrides the records', () => {
  const geo = {
    matchedAddress: '7213 TEAL AVE, SAINT LOUIS, MO, 63133', houseNumber: '7213', streetName: 'TEAL', city: 'SAINT LOUIS',
    state: 'MO', zip: '63133', stateFips: '29', countyFips: '189', countyName: 'St. Louis County', lat: 38.68, lon: -90.3,
  };
  const parcel = { parcelId: 'X', units: 1, annualTax: null, taxYear: null, assessedTotal: null, appraisedTotal: 80600, abated: false, zoning: null, yearBuilt: 1950 };
  const base = { inputAddress: 'x', geo, allInCost: 116000, listing: null, fmr: null, fmrError: null, taxRate: null, parcel, buildingArea: 1146, localRent: localRent({ inStlCity: false, zip: '63133' }) };

  it('bedrooms: a 4/2 the records call a 3-bed rents as a 4-bed', () => {
    const rec = resolve(base);
    const mine = resolve({ ...base, overrides: { beds: 4 } });
    expect(rec.assumptions.find((r) => r.key === 'beds')!.value).toBe('3');
    const b = mine.assumptions.find((r) => r.key === 'beds')!;
    expect(b.value).toBe('4');
    expect(b.source).toBe('user');
    expect(mine.result.stabilized.grossPotentialIncome).toBeGreaterThan(rec.result.stabilized.grossPotentialIncome);
  });

  it('units: a converted duplex, with a warning to confirm the legal unit count', () => {
    const a = resolve({ ...base, overrides: { units: 2, beds: 4 } });
    expect(a.units).toBe(2);
    expect(a.assumptions.find((r) => r.key === 'beds')!.value).toBe('2');
    expect(a.assumptions.find((r) => r.key === 'units')!.source).toBe('user');
    expect(a.warnings.join(' ')).toMatch(/legal unit count/);
  });

  it('sq ft drives the bedroom estimate when bedrooms are blank', () => {
    const a = resolve({ ...base, overrides: { sqft: 1700 } });
    expect(a.assumptions.find((r) => r.key === 'beds')!.value).toBe('4');
  });
});
