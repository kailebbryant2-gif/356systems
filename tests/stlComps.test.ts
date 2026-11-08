import { describe, expect, it } from 'vitest';
import { estimateArv, findSubject, normalizeParcelId, suggestStlAddresses, MIN_COMPS } from '../shared/sources/stlComps';
import { resolve, ALL_IN_PCT_OF_ARV } from '../shared/resolve';

describe('ARV from City of St. Louis sales (bundled data)', () => {
  it('suggests City addresses as you type, whatever the suffix spelling', () => {
    expect(suggestStlAddresses('2700 Lemp Ave')).toContain('2700 Lemp Av, St. Louis, MO');
    expect(suggestStlAddresses('3520 wyoming street')).toContain('3520 Wyoming St, St. Louis, MO');
    expect(suggestStlAddresses('1209 N Market')).toContain('1209 North Market St, St. Louis, MO');
    expect(suggestStlAddresses('Lemp')).toEqual([]); // needs a house number
  });

  it('normalizes the parcel id shown on the city site', () => {
    expect(normalizeParcelId('1488-9-070.000')).toBe('14889070000');
  });

  it('finds a property by parcel id or by street address', () => {
    const byId = findSubject({ parcelId: '1488-9-070.000' });
    const byStreet = findSubject({ street: '3520 Wyoming St' });
    expect(byId?.parcelId).toBe('14889070000');
    expect(byStreet?.parcelId).toBe('14889070000');
    expect(byId?.units).toBe(1);
  });

  it('builds ARV from at least 3 comparable sales of the same type, excluding the property itself', () => {
    const s = findSubject({ street: '3520 WYOMING ST' })!;
    const e = estimateArv(s)!;
    expect(e.compCount).toBeGreaterThanOrEqual(MIN_COMPS);
    expect(e.comps.every((c) => c.units === 1)).toBe(true);
    expect(e.comps.some((c) => c.address.toUpperCase() === s.address)).toBe(false);
    expect(e.low).toBeLessThanOrEqual(e.arv);
    expect(e.arv).toBeLessThanOrEqual(e.high);
    // comps are nearest first, all within the ring's distance
    const miles = e.comps.map((c) => c.miles!);
    expect([...miles].sort((a, b) => a - b)).toEqual(miles);
    expect(e.area).toMatch(/within/);
    expect(Math.max(...miles)).toBeLessThanOrEqual(1);
  });

  it('values 5+ unit buildings per unit when nearby sales are scarce', () => {
    const s = findSubject({ street: '3646 ILLINOIS AV' })!;
    expect(s.units).toBeGreaterThanOrEqual(5);
    expect(estimateArv(s)!.method).toMatch(/per unit/);
  });

  it('all-in cost = 75% of ARV, and the loan equals it', () => {
    const s = findSubject({ street: '3520 WYOMING ST' })!;
    const arv = estimateArv(s)!;
    const allIn = Math.round((arv.arv * ALL_IN_PCT_OF_ARV) / 1000) * 1000;
    const geo = {
      matchedAddress: '3520 WYOMING ST, SAINT LOUIS, MO, 63118', houseNumber: '3520', streetName: 'WYOMING', city: 'SAINT LOUIS',
      state: 'MO', zip: '63118', stateFips: '29', countyFips: '510', countyName: 'St. Louis city', lat: 38.59, lon: -90.24,
    };
    const a = resolve({ inputAddress: 'x', geo, allInCost: allIn, listing: null, fmr: null, fmrError: null, taxRate: null, arv });
    expect(a.allInCost).toBe(allIn);
    expect(a.loan.amount).toBe(allIn);
    expect(a.arv?.arv).toBe(arv.arv);
    expect(a.assumptions.find((r) => r.key === 'arv')!.source).toBe('estimate');
  });

  it('checks the entered all-in cost against 75% of ARV', () => {
    const arv = estimateArv(findSubject({ street: '3520 WYOMING ST' })!)!;
    const geo = {
      matchedAddress: '3520 WYOMING ST, SAINT LOUIS, MO, 63118', houseNumber: '3520', streetName: 'WYOMING', city: 'SAINT LOUIS',
      state: 'MO', zip: '63118', stateFips: '29', countyFips: '510', countyName: 'St. Louis city', lat: 38.59, lon: -90.24,
    };
    const run = (allInCost: number) => resolve({ inputAddress: 'x', geo, allInCost, listing: null, fmr: null, fmrError: null, taxRate: null, arv });
    const under = run(Math.floor(arv.arv * 0.7));
    const over = run(Math.ceil(arv.arv * 0.8));
    expect(under.loan.amount).toBe(Math.floor(arv.arv * 0.7));
    expect(under.maxAllInFromArv).toBe(Math.round(arv.arv * 0.75));
    expect(under.checks.find((c) => c.id === 'rule75')!.pass).toBe(true);
    expect(over.checks.find((c) => c.id === 'rule75')!.pass).toBe(false);
    // No ARV, no 75% check
    const none = resolve({ inputAddress: 'x', geo, allInCost: 90000, listing: null, fmr: null, fmrError: null, taxRate: null, arvNote: 'n/a' });
    expect(none.checks.map((c) => c.id)).toEqual(['dscr', 'cashflow']);
    expect(none.arvNote).toBe('n/a');
  });
});
