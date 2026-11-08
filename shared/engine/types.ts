/** Where a value came from. Every model input carries one of these. */
export type Source =
  | 'user' // typed by the user (address, price)
  | 'verified' // official public record
  | 'listing' // stated in the listing the user supplied
  | 'estimate' // derived by a disclosed method (HUD rents, income approach, tax rate × price…)
  | 'default'; // a standard underwriting assumption

export interface Sourced<T> {
  value: T;
  source: Source;
  /** One short sentence: what this is based on. */
  note: string;
}

export interface Unit {
  beds: number;
  baths: number;
  sqft: number;
  currentRent: number; // monthly
  marketRent: number; // monthly
}

/** Plain-number inputs for the deterministic engine. Mirrors the workbook's blue cells. */
export interface DealInputs {
  purchasePrice: number;
  closingCosts: number; // dollars
  downPaymentPct: number; // 0.15
  interestRate: number; // 0.075 annual
  amortYears: number; // 20
  rehabCost: number;
  rehabOutOfPocketPct: number; // 1 = all cash; the rest is added to the loan
  arv: number;
  units: Unit[];
  vacancyPct: number;
  taxesCurrent: number; // annual
  taxesStabilized: number; // annual
  insurance: number; // annual, both columns
  managementPct: number;
  maintenancePct: number;
  /** Monthly owner-paid amounts for the whole building. */
  current: MonthlyOwnerCosts;
  stabilized: MonthlyOwnerCosts;
  buildingValueRatio: number; // 0.8
  marginalTaxRate: number; // 0.25
  appreciationPct: number; // 0.04
  holdYears: number; // 5
}

export interface MonthlyOwnerCosts {
  lawnSnow: number;
  waterSewerTrash: number;
  electricGas: number;
}

export interface OperatingStatement {
  grossPotentialIncome: number;
  vacancy: number;
  effectiveIncome: number;
  taxes: number;
  insurance: number;
  management: number;
  maintenance: number;
  lawnSnow: number;
  waterSewerTrash: number;
  electricGas: number;
  operatingExpenses: number; // excludes vacancy
  expenseRatio: number; // (opex + vacancy) / GPI, as the workbook reports it
  noi: number;
  debtService: number;
  dscr: number;
  cashFlow: number;
  cashFlowPerUnitMonthly: number;
  cashOnCash: number;
}

export interface YearResult {
  year: number;
  cashFlow: number;
  interest: number;
  principal: number;
  loanBalance: number;
  depreciation: number;
  taxableIncome: number;
  /** Positive = tax saved, negative = tax owed on this property's income. */
  taxEffect: number;
  propertyValue: number;
  appreciation: number; // includes forced appreciation in year 1
  totalReturn: number;
  cashFlowRoi: number;
  taxRoi: number;
  principalRoi: number;
  appreciationRoi: number;
  totalRoi: number;
  equity: number;
  netWealthCreated: number;
}

export interface DealResult {
  acquisition: {
    purchasePrice: number;
    pricePerUnit: number;
    closingCosts: number;
    downPayment: number;
    rehabOutOfPocket: number;
    rehabFinanced: number;
    cashInvested: number;
    loanAmount: number;
    ltv: number;
    monthlyPayment: number;
    annualDebtService: number;
    arv: number;
    allInCost: number;
    forcedAppreciation: number;
    goingInCapRate: number;
    stabilizedCapOnArv: number;
    yieldOnCost: number;
    seventyFiveRuleRatio: number;
    seventyFiveRuleMaxOffer: number;
  };
  current: OperatingStatement;
  stabilized: OperatingStatement;
  years: YearResult[];
}

export interface Targets {
  minDscr: number;
  minCashFlowPerUnitMonthly: number;
  minCashOnCash: number;
  minTotalRoi: number;
  maxPurchasePlusRehabToArv: number;
}

export interface Check {
  id: string;
  label: string;
  target: string;
  actual: string;
  pass: boolean;
}
