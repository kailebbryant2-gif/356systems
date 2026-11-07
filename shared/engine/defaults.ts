import type { Targets } from './types';

/**
 * Course and workbook defaults (James's Multifamily Methods lessons + "Fast Calculation" sheet).
 * Each has a one-line explanation shown to the user wherever the default is applied.
 */
export const COURSE = {
  closingCostPct: { value: 0.02, note: 'Course rule: closing costs ≈ 2% of purchase price.' },
  downPaymentSingleFamily: { value: 0.15, note: 'Course rule: 15% down on a 1-unit investment loan.' },
  downPaymentMultifamily: { value: 0.2, note: 'Course rule: 20% down on multifamily.' },
  interestRate: { value: 0.075, note: 'Course example: ~7.5% commercial / DSCR loan rate. Confirm with a lender.' },
  amortYears: { value: 20, note: 'Course rule: underwrite a 20-year amortization in case the bank won’t give 25.' },
  rehabOutOfPocketPct: { value: 1, note: 'Course example: rehab paid in cash.' },
  vacancyPct: { value: 0.1, note: 'Course rule: 10% vacancy (how most banks underwrite).' },
  maintenancePct: { value: 0.1, note: 'Course rule: 10% of gross rent for maintenance.' },
  managementPct: { value: 0, note: 'Course approach: self-managed (0%). Use 8–10% with a manager.' },
  insurancePctOfCoverage: {
    value: 0.006,
    note: 'Course rule: insurance ≈ 0.6% of coverage (coverage here = purchase + rehab). Get a quote.',
  },
  waterSewerTrashPer2Units: { value: 150, note: 'Course rule: $150/month per 2 units for water, sewer and trash.' },
  lawnSnowMonthly: { value: 40, note: 'Course rule: ~$40/month for lawn care and snow on multifamily.' },
  taxBumpOnPurchase: {
    value: 0.1,
    note: 'Course rule: raise the prior tax bill 5–10% for reassessment after purchase (10% used).',
  },
  buildingValueRatio: { value: 0.8, note: 'Course rule: building ≈ 80% of value (rest is land). Confirm with a CPA.' },
  marginalTaxRate: { value: 0.25, note: 'Course example: 25% marginal tax rate.' },
  appreciationPct: { value: 0.04, note: 'Course rule: 4% annual appreciation (middle of 3–5%).' },
  holdYears: { value: 5, note: 'Workbook horizon: 5 years.' },
  rehabPerSqft: {
    renovated: 0,
    cosmetic: 30,
    substantial: 50,
    gut: 75,
  },
  /** Income-approach cap rate used for ARV when no sales comps are available (cap-rate handout's 6.5–7% exit stress). */
  incomeCapRate: { value: 0.07, note: 'Course cap-rate lesson: stress the exit cap to 6.5–7% (7% used).' },
} as const;

export const COURSE_TARGETS: Targets = {
  minDscr: 1.2,
  minCashFlowPerUnitMonthly: 150,
  minCashOnCash: 0.1,
  minTotalRoi: 0.2,
  maxPurchasePlusRehabToArv: 0.75,
};
