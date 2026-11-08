import { describe, expect, it } from 'vitest';
import { amortizeByYear, analyzeDeal, monthlyPayment } from '../shared/engine/engine';
import { checks, solve, withPrice } from '../shared/engine/solver';
import { TARGETS } from '../shared/engine/defaults';
import type { DealInputs } from '../shared/engine/types';

const zero = { lawnSnow: 0, waterSewerTrash: 0, electricGas: 0 };

/** The workbook's sample inputs. */
export const workbookExample: DealInputs = {
  purchasePrice: 100000,
  closingCosts: 2000,
  downPaymentPct: 0.15,
  interestRate: 0.075,
  amortYears: 20,
  rehabCost: 25000,
  rehabOutOfPocketPct: 1,
  arv: 200000,
  units: [{ beds: 1, baths: 1, sqft: 1000, currentRent: 950, marketRent: 1500 }],
  vacancyPct: 0.1,
  taxesCurrent: 1200,
  taxesStabilized: 1400,
  insurance: 900,
  managementPct: 0,
  maintenancePct: 0.1,
  current: zero,
  stabilized: zero,
  buildingValueRatio: 0.8,
  marginalTaxRate: 0.25,
  appreciationPct: 0.04,
  holdYears: 5,
};

describe('matches the workbook where the workbook is correct', () => {
  const r = analyzeDeal(workbookExample);

  it('loan, payment and cash invested', () => {
    expect(r.acquisition.loanAmount).toBe(85000);
    expect(r.acquisition.monthlyPayment).toBeCloseTo(684.7542, 3);
    expect(r.acquisition.cashInvested).toBe(42000);
    expect(r.acquisition.goingInCapRate).toBeCloseTo(0.0702, 6);
  });

  it('current vs stabilized operating statement', () => {
    expect(r.current.grossPotentialIncome).toBe(11400);
    expect(r.current.noi).toBeCloseTo(7020, 6);
    expect(r.stabilized.noi).toBeCloseTo(12100, 6);
    expect(r.current.dscr).toBeCloseTo(0.854321, 5);
    expect(r.stabilized.dscr).toBeCloseTo(1.472548, 5);
    expect(r.current.cashFlow).toBeCloseTo(-1197.0506, 3);
    expect(r.stabilized.cashFlow).toBeCloseTo(3882.9494, 3);
    expect(r.current.expenseRatio).toBeCloseTo(0.384211, 5);
    expect(r.stabilized.expenseRatio).toBeCloseTo(0.327778, 5);
    expect(r.stabilized.cashOnCash).toBeCloseTo(0.092451, 5);
  });

  it('amortization matches CUMIPMT', () => {
    const y = amortizeByYear(85000, 0.075, 20, 5);
    expect(y[0].principal).toBeCloseTo(1906.709, 2);
    expect(y[0].interest + y[0].principal).toBeCloseTo(monthlyPayment(85000, 0.075, 20) * 12, 6);
  });
});

describe('corrects the four workbook formula errors', () => {
  const r = analyzeDeal(workbookExample);
  const y1 = r.years[0];

  it('forced appreciation subtracts rehab and closing costs', () => {
    expect(r.acquisition.forcedAppreciation).toBe(73000); // workbook showed 100,000
    expect(y1.appreciation).toBeCloseTo(73000 + 8000, 6);
  });

  it('equity = value − remaining loan balance', () => {
    expect(y1.equity).toBeCloseTo(208000 - (85000 - 1906.709), 2); // workbook showed 109,908
    const y5 = r.years[4];
    expect(y5.equity).toBeCloseTo(y5.propertyValue - y5.loanBalance, 6);
  });

  it('tax effect counts tax owed on rental profit', () => {
    const depreciation = (127000 * 0.8) / 27.5;
    expect(y1.depreciation).toBeCloseTo(depreciation, 6);
    const taxable = 12100 - y1.interest - depreciation;
    expect(taxable).toBeGreaterThan(0);
    expect(y1.taxEffect).toBeCloseTo(-taxable * 0.25, 6); // negative: tax owed, not saved
  });

  it('financed rehab is added to the loan', () => {
    const r2 = analyzeDeal({ ...workbookExample, rehabOutOfPocketPct: 0.4 });
    expect(r2.acquisition.loanAmount).toBe(85000 + 15000);
    expect(r2.acquisition.cashInvested).toBe(15000 + 2000 + 10000);
    expect(r2.acquisition.annualDebtService).toBeGreaterThan(r.acquisition.annualDebtService);
  });

  it('net wealth created subtracts the cash invested', () => {
    expect(y1.netWealthCreated).toBeCloseTo(y1.equity + y1.cashFlow - 42000, 6);
  });
});

describe('screens and solver', () => {
  const links = { closingCostPct: 0.02, stabilizedTaxRateOnPrice: null, insurancePctOfCoverage: null, taxBump: 0.1 };

  it('worked example passes DSCR and $/unit but misses 10% cash-on-cash', () => {
    const c = Object.fromEntries(checks(analyzeDeal(workbookExample), TARGETS).map((x) => [x.id, x.pass]));
    expect(c).toMatchObject({ dscr: true, cashflow: true, coc: false, rule75: true });
  });

  it('max price meets all operating targets and $1k more does not', () => {
    const s = solve(workbookExample, links, TARGETS);
    expect(s.maxPrice).not.toBeNull();
    const at = analyzeDeal(withPrice(workbookExample, s.maxPrice!, links)).stabilized;
    expect(at.dscr).toBeGreaterThanOrEqual(1.2);
    expect(at.cashOnCash).toBeGreaterThanOrEqual(0.1);
    const above = analyzeDeal(withPrice(workbookExample, s.maxPrice! + 1000, links)).stabilized;
    expect(above.cashOnCash >= 0.1 && above.dscr >= 1.2 && above.cashFlowPerUnitMonthly >= 150).toBe(false);
    expect(s.bindingConstraint).toBe('coc');
  });

  it('required rent is just enough', () => {
    const s = solve(workbookExample, links, TARGETS);
    expect(s.requiredMonthlyRent).toBeGreaterThan(1500);
    const k = s.requiredMonthlyRent! / 1500;
    const ok = analyzeDeal({
      ...workbookExample,
      units: workbookExample.units.map((u) => ({ ...u, marketRent: u.marketRent * k })),
    }).stabilized;
    expect(ok.cashOnCash).toBeGreaterThanOrEqual(0.1);
  });

  it('75% rule max offer', () => {
    expect(solve(workbookExample, links, TARGETS).seventyFiveRuleMaxOffer).toBe(125000);
  });
});
