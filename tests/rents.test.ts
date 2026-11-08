import { describe, expect, it } from 'vitest';
import { localRent } from '../shared/rents';
import { resolve } from '../shared/resolve';
import { findSubject } from '../shared/sources/stlComps';

describe('local St. Louis rent rules of thumb', () => {
  it('covers South City neighborhoods (1–34) and North County ZIPs only', () => {
    expect(localRent({ inStlCity: true, cityNbhd: '25', zip: '63118' })?.area).toBe('South City'); // Tower Grove East
    expect(localRent({ inStlCity: true, cityNbhd: '01', zip: '63111' })?.area).toBe('South City'); // Carondelet
    expect(localRent({ inStlCity: true, cityNbhd: '38', zip: '63108' })).toBeNull(); // Central West End
    expect(localRent({ inStlCity: false, zip: '63135' })?.area).toBe('North County'); // Ferguson
    expect(localRent({ inStlCity: false, zip: '63105' })).toBeNull(); // Clayton
  });

  it('a South City address uses $1,150 for a 2-bed instead of the HUD benchmark', () => {
    const s = findSubject({ street: '2700 LEMP AV' })!;
    const rent = localRent({ inStlCity: true, cityNbhd: s.nbhd, zip: '63118' });
    expect(rent?.area).toBe('South City');
    const geo = {
      matchedAddress: '2700 LEMP AVE, SAINT LOUIS, MO, 63118', houseNumber: '2700', streetName: 'LEMP', city: 'SAINT LOUIS',
      state: 'MO', zip: '63118', stateFips: '29', countyFips: '510', countyName: 'St. Louis city', lat: 38.6, lon: -90.2,
    };
    const fmr = { byBedrooms: [955, 995, 1218, 1568, 1812] as [number, number, number, number, number], areaName: 'St. Louis', year: 'FY2026', zipLevel: false };
    const parcel = { parcelId: null, units: 2, annualTax: 3000, taxYear: 2025, assessedTotal: 1, appraisedTotal: 1, abated: false, zoning: null, yearBuilt: null };
    const a = resolve({ inputAddress: 'x', geo, allInCost: 180000, listing: null, fmr, fmrError: null, taxRate: null, parcel, localRent: rent });
    expect(a.result.stabilized.grossPotentialIncome).toBe(1150 * 2 * 12);
    expect(a.assumptions.find((r) => r.key === 'rent')!.note).toMatch(/South City/);
  });
});
