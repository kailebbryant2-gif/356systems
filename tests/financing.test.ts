import { describe, expect, it } from 'vitest';
import { analyzeDeal, monthlyPayment } from '../shared/engine/engine';
import { analyzeFinancing, LOANS } from '../shared/financing';
import type { DealInputs } from '../shared/engine/types';

const zero = { lawnSnow: 0, waterSewerTrash: 0, electricGas: 0 };
const unit = (rent: number) => ({ beds: 2, baths: 1, sqft: 900, currentRent: rent, marketRent: rent });

/** $75k purchase, $50k rehab, $200k ARV — the BRRRR / partnership example. */
const brrrrDeal: DealInputs = {
  purchasePrice: 75000, closingCosts: 1500, downPaymentPct: 0.25, interestRate: 0.075, amortYears: 30,
  rehabCost: 50000, rehabOutOfPocketPct: 1, arv: 200000, units: [unit(1800)], vacancyPct: 0.1,
  taxesCurrent: 1800, taxesStabilized: 1800, insurance: 750, managementPct: 0, maintenancePct: 0.1,
  current: zero, stabilized: zero, buildingValueRatio: 0.8, marginalTaxRate: 0.25, appreciationPct: 0.04, holdYears: 5,
};

describe('BRRRR', () => {
  const f = analyzeFinancing(brrrrDeal, analyzeDeal(brrrrDeal), false);
  const b = f.brrrr!;

  it('hard money funds price + rehab when the deal is at or under 75% of ARV', () => {
    expect(b.fullyFunded).toBe(true);
    expect(b.hardMoneyLoan).toBe(125000);
    expect(b.cashAtPurchase).toBeCloseTo(1500 + 125000 * 0.03, 6); // closing + 3 points
  });

  it('refinances at 80% of ARV and pulls cash out on a 62.5%-of-ARV deal', () => {
    expect(b.refiLoan).toBe(160000);
    expect(b.cashLeftInDeal).toBeLessThan(0);
    const debt = monthlyPayment(160000, 0.075, 30) * 12;
    expect(b.dscrAfter).toBeCloseTo(analyzeDeal(brrrrDeal).stabilized.noi / debt, 6);
  });

  it('caps hard money at 75% of ARV and the buyer covers the gap', () => {
    const rich = { ...brrrrDeal, purchasePrice: 140000 };
    const r = analyzeFinancing(rich, analyzeDeal(rich), false).brrrr!;
    expect(r.fullyFunded).toBe(false);
    expect(r.hardMoneyLoan).toBe(150000);
    expect(r.cashAtPurchase).toBeGreaterThan(190000 - 150000);
  });

  it('private money (8%, 1 point) is cheaper than hard money (12.5%, 3 points)', () => {
    expect(b.privateMoneySavings).toBeCloseTo(125000 * 0.02 + 100000 * 0.045 * 0.5, 6);
  });

  it('no rehab, no BRRRR panel', () => {
    const turnkey = { ...brrrrDeal, rehabCost: 0 };
    expect(analyzeFinancing(turnkey, analyzeDeal(turnkey), false).brrrr).toBeNull();
  });
});

describe('50/50 partnership', () => {
  it('partner capital comes back first; a cash-out refi leaves nothing to return', () => {
    const p = analyzeFinancing(brrrrDeal, analyzeDeal(brrrrDeal), false).partnership;
    expect(p.capitalLeft).toBe(0);
    expect(p.returnedAtRefi).toBeCloseTo(p.partnerCash, 6);
    expect(p.partnerEquity).toBeCloseTo(p.yourEquity, 6);
    expect(p.partnerEquity + p.yourEquity).toBeCloseTo(200000 - 160000, 6);
  });

  it('without a refinance, partner money stays in and is credited before the split', () => {
    const turnkey = { ...brrrrDeal, rehabCost: 0, arv: 120000 };
    const base = analyzeDeal(turnkey);
    const p = analyzeFinancing(turnkey, base, false).partnership;
    expect(p.capitalLeft).toBe(base.acquisition.cashInvested);
    expect(p.partnerEquity - p.yourEquity).toBeCloseTo(Math.min(p.capitalLeft, p.equity), 6);
  });
});

describe('loan options', () => {
  const duplex: DealInputs = { ...brrrrDeal, rehabCost: 0, purchasePrice: 220000, closingCosts: 4400, units: [unit(1250), unit(1250)] };
  const f = analyzeFinancing(duplex, analyzeDeal(duplex), false);
  const by = Object.fromEntries(f.options.map((o) => [o.id, o]));

  it('shows conventional, FHA house hack, seller financing and a rate shock for a duplex', () => {
    expect(Object.keys(by).sort()).toEqual(['base', 'conventional', 'fha', 'seller', 'shock']);
    expect(by.conventional.downPct).toBe(0.2);
    expect(by.fha.cashToClose).toBeCloseTo(220000 * 0.035 + 4400, 6);
  });

  it('FHA house hack drops the owner’s unit from income and adds mortgage insurance', () => {
    const loan = 220000 * 0.965 * (1 + LOANS.fha.upfrontMip);
    expect(by.fha.monthlyPayment).toBeCloseTo(monthlyPayment(loan, 0.075, 30) + (loan * 0.0055) / 12, 6);
    const oneUnitNoi = analyzeDeal({ ...duplex, units: duplex.units.slice(1) }).stabilized.noi;
    expect(by.fha.monthlyCashFlow).toBeCloseTo((oneUnitNoi - by.fha.monthlyPayment * 12) / 12, 6);
  });

  it('seller financing rate is the highest that still meets DSCR 1.20 and $150/unit', () => {
    const s = by.seller;
    expect(s.dscr! >= 1.2 || s.detail.includes('0%')).toBe(true);
    if (!s.detail.includes('even at 0%')) expect(s.monthlyCashFlow / 2).toBeGreaterThanOrEqual(149.99);
  });

  it('commercial deals get a seller carryback and a +2% ARM reset instead of conventional/FHA', () => {
    const big = { ...duplex, purchasePrice: 1500000, closingCosts: 30000, units: Array.from({ length: 20 }, () => unit(1100)) };
    const ids = analyzeFinancing(big, analyzeDeal(big), true).options.map((o) => o.id);
    expect(ids).toEqual(['base', 'seller', 'carryback', 'shock']);
  });
});
