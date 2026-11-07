import type { DealInputs, DealResult, MonthlyOwnerCosts, OperatingStatement, YearResult } from './types';

/**
 * Deterministic underwriting engine.
 *
 * Follows the Multifamily Methods workbook ("Fast Calculation" sheet) section by section,
 * with four corrections to the original workbook formulas:
 *  1. Forced appreciation = ARV − price − closing − rehab (workbook used ARV − price).
 *  2. Equity = property value − remaining loan balance (workbook subtracted the LTV %).
 *  3. Tax effect = −(NOI − interest − depreciation) × tax rate, so tax owed on rental profit
 *     is counted (workbook counted every deduction as savings).
 *  4. Rehab not paid out of pocket is added to the loan (workbook dropped it).
 * Depreciation basis also includes closing costs and rehab.
 */

export function monthlyPayment(principal: number, annualRate: number, years: number): number {
  if (principal <= 0) return 0;
  const n = years * 12;
  const r = annualRate / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export function amortizeByYear(principal: number, annualRate: number, years: number, horizon: number) {
  const pmt = monthlyPayment(principal, annualRate, years);
  const r = annualRate / 12;
  let balance = principal;
  const out: { interest: number; principal: number; balance: number }[] = [];
  for (let y = 0; y < horizon; y++) {
    let i = 0;
    let p = 0;
    for (let m = 0; m < 12; m++) {
      if (balance <= 0) break;
      const interest = balance * r;
      const prin = Math.min(pmt - interest, balance);
      balance -= prin;
      i += interest;
      p += prin;
    }
    out.push({ interest: i, principal: p, balance: Math.max(balance, 0) });
  }
  return out;
}

function statement(
  inputs: DealInputs,
  monthlyRent: number,
  taxes: number,
  owner: MonthlyOwnerCosts,
  annualDebtService: number,
  cashInvested: number,
): OperatingStatement {
  const gpi = monthlyRent * 12;
  const vacancy = gpi * inputs.vacancyPct;
  const effectiveIncome = gpi - vacancy;
  const management = gpi * inputs.managementPct;
  const maintenance = gpi * inputs.maintenancePct;
  const lawnSnow = owner.lawnSnow * 12;
  const waterSewerTrash = owner.waterSewerTrash * 12;
  const electricGas = owner.electricGas * 12;
  const operatingExpenses =
    taxes + inputs.insurance + management + maintenance + lawnSnow + waterSewerTrash + electricGas;
  const noi = effectiveIncome - operatingExpenses;
  const cashFlow = noi - annualDebtService;
  const units = Math.max(inputs.units.length, 1);
  return {
    grossPotentialIncome: gpi,
    vacancy,
    effectiveIncome,
    taxes,
    insurance: inputs.insurance,
    management,
    maintenance,
    lawnSnow,
    waterSewerTrash,
    electricGas,
    operatingExpenses,
    expenseRatio: gpi > 0 ? (operatingExpenses + vacancy) / gpi : 0,
    noi,
    debtService: annualDebtService,
    dscr: annualDebtService > 0 ? noi / annualDebtService : Infinity,
    cashFlow,
    cashFlowPerUnitMonthly: cashFlow / 12 / units,
    cashOnCash: cashInvested > 0 ? cashFlow / cashInvested : 0,
  };
}

export function analyzeDeal(inputs: DealInputs): DealResult {
  const price = inputs.purchasePrice;
  const units = Math.max(inputs.units.length, 1);
  const downPayment = price * inputs.downPaymentPct;
  const rehabOutOfPocket = inputs.rehabCost * inputs.rehabOutOfPocketPct;
  const rehabFinanced = inputs.rehabCost - rehabOutOfPocket;
  const loanAmount = price - downPayment + rehabFinanced;
  const cashInvested = downPayment + inputs.closingCosts + rehabOutOfPocket;
  const pmt = monthlyPayment(loanAmount, inputs.interestRate, inputs.amortYears);
  const annualDebtService = pmt * 12;
  const allInCost = price + inputs.closingCosts + inputs.rehabCost;

  const currentRent = inputs.units.reduce((s, u) => s + u.currentRent, 0);
  const marketRent = inputs.units.reduce((s, u) => s + u.marketRent, 0);
  const current = statement(inputs, currentRent, inputs.taxesCurrent, inputs.current, annualDebtService, cashInvested);
  const stabilized = statement(
    inputs,
    marketRent,
    inputs.taxesStabilized,
    inputs.stabilized,
    annualDebtService,
    cashInvested,
  );

  const forcedAppreciation = inputs.arv - allInCost;
  const depreciation = (allInCost * inputs.buildingValueRatio) / 27.5;
  const schedule = amortizeByYear(loanAmount, inputs.interestRate, inputs.amortYears, inputs.holdYears);

  const years: YearResult[] = [];
  let value = inputs.arv;
  let cumulativeCashFlow = 0;
  for (let y = 1; y <= inputs.holdYears; y++) {
    const { interest, principal, balance } = schedule[y - 1];
    // Workbook convention: stabilized cash flow from year 1, grown at the appreciation rate.
    const cashFlow = stabilized.cashFlow * Math.pow(1 + inputs.appreciationPct, y - 1);
    const noi = cashFlow + annualDebtService;
    const taxableIncome = noi - interest - depreciation;
    const taxEffect = -taxableIncome * inputs.marginalTaxRate;
    const startValue = value;
    value = startValue * (1 + inputs.appreciationPct);
    const appreciation = value - startValue + (y === 1 ? forcedAppreciation : 0);
    cumulativeCashFlow += cashFlow;
    const totalReturn = cashFlow + taxEffect + principal + appreciation;
    const roi = (x: number) => (cashInvested > 0 ? x / cashInvested : 0);
    const equity = value - balance;
    years.push({
      year: y,
      cashFlow,
      interest,
      principal,
      loanBalance: balance,
      depreciation,
      taxableIncome,
      taxEffect,
      propertyValue: value,
      appreciation,
      totalReturn,
      cashFlowRoi: roi(cashFlow),
      taxRoi: roi(taxEffect),
      principalRoi: roi(principal),
      appreciationRoi: roi(appreciation),
      totalRoi: roi(totalReturn),
      equity,
      netWealthCreated: equity + cumulativeCashFlow - cashInvested,
    });
  }

  return {
    acquisition: {
      purchasePrice: price,
      pricePerUnit: price / units,
      closingCosts: inputs.closingCosts,
      downPayment,
      rehabOutOfPocket,
      rehabFinanced,
      cashInvested,
      loanAmount,
      ltv: price > 0 ? loanAmount / price : 0,
      monthlyPayment: pmt,
      annualDebtService,
      arv: inputs.arv,
      allInCost,
      forcedAppreciation,
      goingInCapRate: price > 0 ? current.noi / price : 0,
      stabilizedCapOnArv: inputs.arv > 0 ? stabilized.noi / inputs.arv : 0,
      yieldOnCost: allInCost > 0 ? stabilized.noi / allInCost : 0,
      seventyFiveRuleRatio: inputs.arv > 0 ? (price + inputs.rehabCost) / inputs.arv : Infinity,
      seventyFiveRuleMaxOffer: inputs.arv * 0.75 - inputs.rehabCost,
    },
    current,
    stabilized,
    years,
  };
}
