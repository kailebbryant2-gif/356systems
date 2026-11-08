import { analyzeDeal } from './engine';
import type { Check, DealInputs, DealResult, Targets } from './types';

/** How price-dependent inputs move when the purchase price changes. */
export interface PriceLinks {
  closingCostPct: number;
  /** If taxes were estimated from the price, the rate used; null when taxes come from a fixed bill. */
  stabilizedTaxRateOnPrice: number | null;
  /** Reassessment bump applied to the current tax bill (0.10). */
  taxBump: number;
  /** If insurance = pct × (price + rehab); null when insurance is a fixed figure. */
  insurancePctOfCoverage: number | null;
}

export function withPrice(inputs: DealInputs, price: number, links: PriceLinks): DealInputs {
  const next: DealInputs = { ...inputs, purchasePrice: price, closingCosts: price * links.closingCostPct };
  if (links.stabilizedTaxRateOnPrice !== null) {
    next.taxesStabilized = Math.max(inputs.taxesCurrent * (1 + links.taxBump), price * links.stabilizedTaxRateOnPrice);
  }
  if (links.insurancePctOfCoverage !== null) {
    next.insurance = (price + inputs.rehabCost) * links.insurancePctOfCoverage;
  }
  return next;
}

/** Steady-state year used for the total-ROI test: year 2 (year 1 is dominated by one-time forced appreciation). */
export const ROI_TEST_YEAR = 2;

export function checks(result: DealResult, targets: Targets): Check[] {
  const s = result.stabilized;
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const money = (x: number) => `${x < 0 ? '−' : ''}$${Math.round(Math.abs(x)).toLocaleString('en-US')}`;
  const roiYear = result.years[Math.min(ROI_TEST_YEAR, result.years.length) - 1];
  const r75 = result.acquisition.seventyFiveRuleRatio;
  return [
    {
      id: 'dscr',
      label: 'Debt coverage (DSCR)',
      target: `≥ ${targets.minDscr.toFixed(2)}`,
      // Truncate so a value just under the target never displays as the target.
      actual: Number.isFinite(s.dscr) ? (Math.floor(s.dscr * 100) / 100).toFixed(2) : 'No loan',
      pass: s.dscr >= targets.minDscr,
    },
    {
      id: 'cashflow',
      label: 'Cash flow per unit',
      target: `≥ $${targets.minCashFlowPerUnitMonthly}/mo`,
      actual: `${money(s.cashFlowPerUnitMonthly)}/mo`,
      pass: s.cashFlowPerUnitMonthly >= targets.minCashFlowPerUnitMonthly,
    },
    {
      id: 'coc',
      label: 'Cash-on-cash return',
      target: `≥ ${pct(targets.minCashOnCash)}`,
      actual: pct(s.cashOnCash),
      pass: s.cashOnCash >= targets.minCashOnCash,
    },
    {
      id: 'roi',
      label: `Total ROI (year ${roiYear.year})`,
      target: `≥ ${pct(targets.minTotalRoi)}`,
      actual: pct(roiYear.totalRoi),
      pass: roiYear.totalRoi >= targets.minTotalRoi,
    },
    {
      id: 'rule75',
      label: '75% rule (price + rehab ÷ ARV)',
      target: `≤ ${pct(targets.maxPurchasePlusRehabToArv)}`,
      actual: Number.isFinite(r75) ? pct(r75) : 'No ARV',
      pass: r75 <= targets.maxPurchasePlusRehabToArv,
    },
  ];
}

/** The three cash-flow screens the solver targets (stabilized). */
function meetsOperatingTargets(r: DealResult, t: Targets): boolean {
  const s = r.stabilized;
  return s.dscr >= t.minDscr && s.cashFlowPerUnitMonthly >= t.minCashFlowPerUnitMonthly && s.cashOnCash >= t.minCashOnCash;
}

function bisect(lo: number, hi: number, ok: (x: number) => boolean, wantMax: boolean, iters = 60): number | null {
  // ok() is monotone: for wantMax, true below the threshold; otherwise true above it.
  if (wantMax) {
    if (!ok(lo)) return null;
    if (ok(hi)) return hi;
  } else {
    if (!ok(hi)) return null;
    if (ok(lo)) return lo;
  }
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid) === wantMax) lo = mid;
    else hi = mid;
  }
  return wantMax ? lo : hi;
}

export interface Solutions {
  /** Highest purchase price meeting DSCR, $/unit cash flow and cash-on-cash at stabilized rents. */
  maxPrice: number | null;
  /** Total monthly rent (whole building) needed at the entered price. */
  requiredMonthlyRent: number | null;
  /** Down payment % needed for DSCR and $/unit cash flow at the entered price (cash-on-cash shown separately). */
  requiredDownPct: number | null;
  requiredDownCash: number | null;
  /** 75% rule: 75% × ARV − rehab. */
  seventyFiveRuleMaxOffer: number;
  /** Which screen limits the price the most at the entered price. */
  bindingConstraint: 'dscr' | 'cashflow' | 'coc' | null;
}

export function solve(inputs: DealInputs, links: PriceLinks, targets: Targets): Solutions {
  const base = analyzeDeal(inputs);
  const ok = (i: DealInputs) => meetsOperatingTargets(analyzeDeal(i), targets);

  const maxPriceRaw = bisect(1000, Math.max(inputs.purchasePrice * 4, 100000), (p) => ok(withPrice(inputs, p, links)), true);
  const maxPrice = maxPriceRaw === null ? null : Math.floor(maxPriceRaw / 1000) * 1000;

  // With no rent estimate at all, solve for an equal rent per unit.
  const known = inputs.units.reduce((s, u) => s + u.marketRent, 0) > 0;
  const seed = known ? inputs.units : inputs.units.map((u) => ({ ...u, marketRent: 1 }));
  const baseRent = seed.reduce((s, u) => s + u.marketRent, 0);
  const scaled = (k: number): DealInputs => ({ ...inputs, units: seed.map((u) => ({ ...u, marketRent: u.marketRent * k })) });
  const kRent = bisect(0, known ? 20 : 50000, (x) => ok(scaled(x)), false);
  const requiredMonthlyRent = kRent === null ? null : Math.ceil((baseRent * kRent) / 5) * 5;

  const meetsDebtAndCash = (d: number) => {
    const s = analyzeDeal({ ...inputs, downPaymentPct: d }).stabilized;
    return s.dscr >= targets.minDscr && s.cashFlowPerUnitMonthly >= targets.minCashFlowPerUnitMonthly;
  };
  const d = bisect(0, 1, meetsDebtAndCash, false);
  const requiredDownPct = d === null ? null : Math.ceil(d * 100) / 100;

  const s = base.stabilized;
  const gaps: [Solutions['bindingConstraint'], number][] = [
    ['dscr', s.dscr / targets.minDscr],
    ['cashflow', (s.cashFlowPerUnitMonthly + 1e-9) / targets.minCashFlowPerUnitMonthly],
    ['coc', s.cashOnCash / targets.minCashOnCash],
  ];
  gaps.sort((a, b) => a[1] - b[1]);
  const bindingConstraint = gaps[0][1] < 1 ? gaps[0][0] : null;

  return {
    maxPrice,
    requiredMonthlyRent,
    requiredDownPct,
    requiredDownCash: requiredDownPct === null ? null : requiredDownPct * inputs.purchasePrice,
    seventyFiveRuleMaxOffer: base.acquisition.seventyFiveRuleMaxOffer,
    bindingConstraint,
  };
}
