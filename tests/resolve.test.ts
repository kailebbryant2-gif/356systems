import { describe, expect, it } from 'vitest';
import { resolve } from '../shared/resolve';
import { monthlyPayment } from '../shared/engine/engine';
import { parseListing } from '../shared/sources/listing';
import type { GeocodedAddress } from '../shared/sources/geocode';

const geo: GeocodedAddress = {
  matchedAddress: '3520 WYOMING ST, SAINT LOUIS, MO, 63118', houseNumber: '3520', streetName: 'WYOMING',
  city: 'SAINT LOUIS', state: 'MO', zip: '63118', stateFips: '29', countyFips: '510', countyName: 'St. Louis city',
  lat: 38.59, lon: -90.24,
};
const fmr = { byBedrooms: [955, 995, 1218, 1568, 1812] as [number, number, number, number, number], areaName: 'St. Louis, MO-IL HUD Metro FMR Area', year: 'FY2026', zipLevel: false };
const taxRate = { rate: 0.0091, level: 'state' as const, note: 'MO' };
const page = (body: string) =>
  parseListing(`<html><head><meta property="og:title" content="3520 Wyoming St, St. Louis, MO 63118"></head><body>${body}</body></html>`, 'https://www.zillow.com/homedetails/3520-Wyoming-St');
const base = { inputAddress: '3520 Wyoming St', geo, fmr, fmrError: null, taxRate };

describe('all-in model', () => {
  it('$90,000 all-in: loan = $90,000 on a 30-year mortgage at prime, cash flow after the five expenses', () => {
    const a = resolve({ ...base, allInCost: 90000, listing: { ok: true, facts: page('Single family home. 3 beds, 1 bath. Rent Zestimate®: $1,300/mo') } });
    const pmt = monthlyPayment(90000, 0.07, 30);
    expect(a.loan.amount).toBe(90000);
    expect(a.loan.years).toBe(30);
    expect(a.result.acquisition.monthlyPayment).toBeCloseTo(pmt, 6);
    expect(a.result.acquisition.cashInvested).toBe(0);

    const s = a.result.stabilized;
    const rent = 1300 * 12;
    const expenses = 90000 * 0.0091 + 90000 * 0.006 + 0 + rent * 0.075; // taxes + insurance + utilities + maintenance
    expect(s.insurance).toBe(540); // 0.6% of $90,000
    expect(s.grossPotentialIncome).toBe(rent);
    expect(s.vacancy).toBeCloseTo(rent * 0.075, 6);
    expect(s.maintenance).toBeCloseTo(rent * 0.075, 6);
    expect(s.operatingExpenses).toBeCloseTo(expenses, 6);
    expect(s.management + s.lawnSnow).toBe(0);
    expect(s.cashFlow).toBeCloseTo(rent - rent * 0.075 - expenses - pmt * 12, 6);
  });

  it('shows the loan options at that amount', () => {
    const a = resolve({ ...base, allInCost: 90000, listing: null });
    expect(a.loanOptions.map((o) => o.id)).toEqual(['base', 'amort25', 'amort20', 'shock']);
    expect(a.loanOptions[0].monthlyPayment).toBeCloseTo(monthlyPayment(90000, 0.07, 30), 6);
    expect(a.loanOptions[3].monthlyPayment).toBeCloseTo(monthlyPayment(90000, 0.08, 30), 6);
  });

  it('only tests DSCR and $/unit cash flow (no cash-on-cash with 100% financing)', () => {
    const a = resolve({ ...base, allInCost: 90000, listing: null });
    expect(a.checks.map((c) => c.id)).toEqual(['dscr', 'cashflow']);
  });

  it('multifamily: $75/unit utilities; single-family: none', () => {
    const mf = resolve({ ...base, allInCost: 300000, listing: { ok: true, facts: page('Fourplex. 8 beds. Total monthly rent: $4,400.') } });
    expect(mf.units).toBe(4);
    expect(mf.result.stabilized.waterSewerTrash).toBe(75 * 4 * 12);
    const sf = resolve({ ...base, allInCost: 150000, listing: { ok: true, facts: page('Single family home. 3 beds. Rent Zestimate: $1,500') } });
    expect(sf.result.stabilized.waterSewerTrash).toBe(0);
    expect(sf.valueAdd).toBeNull();
  });

  it('uses the listing only for rent: taxes come from the all-in cost, not the listing', () => {
    const a = resolve({ ...base, allInCost: 200000, listing: { ok: true, facts: page('Single family. Rent Zestimate: $1,600. Annual taxes: $9,999.') } });
    expect(a.result.stabilized.taxes).toBeCloseTo(200000 * 0.0091, 6);
  });

  it('falls back to the HUD benchmark when the listing has no rent', () => {
    const a = resolve({ ...base, allInCost: 120000, listing: null });
    expect(a.result.stabilized.grossPotentialIncome).toBe(1218 * 12);
    expect(a.assumptions.find((r) => r.key === 'rent')!.source).toBe('estimate');
  });

  it('solves the highest all-in cost that works and the cash needed at this one', () => {
    const a = resolve({ ...base, allInCost: 160000, listing: { ok: true, facts: page('Single family. 3 beds. Rent Zestimate: $1,500') } });
    expect(a.verdict.status).toBe('misses');
    expect(a.solutions.maxAllIn!).toBeLessThan(160000);
    expect(a.solutions.cashNeeded!).toBeGreaterThan(0);
    const ok = resolve({ ...base, allInCost: a.solutions.maxAllIn!, listing: { ok: true, facts: page('Single family. 3 beds. Rent Zestimate: $1,500') } });
    expect(ok.verdict.status).toBe('meets');
  });

  it('St. Louis City: taxes and units come from the official parcel record', () => {
    const parcel = { parcelId: '1488-9-070.000', units: 2, annualTax: 2297.48, taxYear: 2025, assessedTotal: 29740, appraisedTotal: 156511, abated: false, zoning: 'B - Two Family Residential', yearBuilt: 1906 };
    const a = resolve({ ...base, allInCost: 200000, parcel, listing: { ok: true, facts: page('Rent Zestimate: $2,400') } });
    expect(a.result.stabilized.taxes).toBe(2297.48);
    expect(a.assumptions.find((r) => r.key === 'taxes')!.source).toBe('verified');
    expect(a.units).toBe(2);
    expect(a.assumptions.find((r) => r.key === 'units')!.source).toBe('verified');
    // A real tax bill doesn't change with the all-in cost in the solver.
    expect(a.solutions.maxAllIn).not.toBeNull();
  });

  it('warns when the parcel is tax-abated', () => {
    const parcel = { parcelId: 'x', units: 1, annualTax: 300, taxYear: 2025, assessedTotal: 1, appraisedTotal: 1, abated: true, zoning: null, yearBuilt: null };
    expect(resolve({ ...base, allInCost: 90000, parcel, listing: null }).warnings.join(' ')).toMatch(/abatement/);
  });

  it('ignores a listing for a different address', () => {
    const other = parseListing('<html><head><meta property="og:title" content="4100 Wyoming St"></head><body>Rent Zestimate: $5,000</body></html>', 'https://www.zillow.com/homedetails/4100');
    const a = resolve({ ...base, allInCost: 90000, listing: { ok: true, facts: other } });
    expect(a.listing.status).toBe('mismatch');
  });
});
