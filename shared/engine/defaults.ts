import type { Targets } from './types';

/**
 * Standard underwriting assumptions. Each has a one-line explanation shown to the user
 * wherever the assumption is applied.
 */
export const DEFAULTS = {
  closingCostPct: { value: 0.02, note: 'Closing costs ≈ 2% of purchase price.' },
  downPaymentSingleFamily: { value: 0.15, note: '15% down on a 1-unit investment loan.' },
  downPaymentMultifamily: { value: 0.2, note: '20% down on multifamily.' },
  interestRate: { value: 0.075, note: '~7.5% investor / DSCR loan rate. Confirm with a lender.' },
  amortYears: { value: 20, note: '20-year amortization, in case the bank won’t give 25.' },
  rehabOutOfPocketPct: { value: 1, note: 'Rehab paid in cash.' },
  vacancyPct: { value: 0.1, note: '10% vacancy, the way most banks underwrite.' },
  maintenancePct: { value: 0.1, note: '10% of gross rent set aside for maintenance.' },
  managementPct: { value: 0, note: 'Self-managed (0%). Use 8–10% with a property manager.' },
  insurancePctOfCoverage: {
    value: 0.006,
    note: 'Insurance ≈ 0.6% of coverage (coverage here = purchase + rehab). Get a quote.',
  },
  waterSewerTrashPer2Units: { value: 150, note: '$150/month per 2 units for water, sewer and trash.' },
  lawnSnowMonthly: { value: 40, note: '~$40/month for lawn care and snow on multifamily.' },
  taxBumpOnPurchase: {
    value: 0.1,
    note: 'Prior tax bill raised 10% for reassessment after purchase.',
  },
  buildingValueRatio: { value: 0.8, note: 'Building ≈ 80% of value (the rest is land). Confirm with a CPA.' },
  marginalTaxRate: { value: 0.25, note: 'Assumes a 25% marginal tax rate.' },
  appreciationPct: { value: 0.04, note: '4% annual appreciation (middle of the usual 3–5%).' },
  holdYears: { value: 5, note: '5-year hold.' },
  rehabPerSqft: {
    renovated: 0,
    cosmetic: 30,
    substantial: 50,
    gut: 75,
  },
  /** Income-approach cap rate used for ARV when no sales comps are available. */
  incomeCapRate: { value: 0.07, note: 'Exit cap stressed to 7% in case rates rise.' },
} as const;

/**
 * Calibrated against closed St. Louis deals ($125k–$3.7M). Where real practice differs
 * from a general rule of thumb, these win.
 */
export const MARKET = {
  /** A deal is underwritten as "commercial" at 5+ units or $1M+. */
  commercialMinUnits: 5,
  commercialMinPrice: 1_000_000,
  smallLoan: {
    down: 0.25,
    amortYears: 30,
    note: 'Typical St. Louis investor loan under $1M: 25% down, 30-year amortization.',
  },
  commercialLoan: {
    down: 0.2,
    amortYears: 20,
    note: 'Typical commercial loan at $1M+ or 5+ units: 20% down, 20–25-year amortization (20 used).',
  },
  rentUplift: {
    value: 0.07,
    note: 'Closed St. Louis deals reached a median ~7% above in-place rent (range 4–20%).',
  },
  managementCommercial: { value: 0.05, note: 'Larger buildings typically budget 4.5–5% for management.' },
  taxRateCommercial: { value: 0.013, note: 'Larger St. Louis buildings typically pay 1.1–1.7% of price in property taxes (1.3% used)' },
} as const;

export const TARGETS: Targets = {
  minDscr: 1.2,
  minCashFlowPerUnitMonthly: 150,
  minCashOnCash: 0.1,
  minTotalRoi: 0.2,
  maxPurchasePlusRehabToArv: 0.75,
};
