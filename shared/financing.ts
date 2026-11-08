import { analyzeDeal, monthlyPayment } from './engine/engine';
import type { DealInputs, DealResult } from './engine/types';

/** Standard loan programs. Rates are screening defaults; confirm with a lender. */
export const LOANS = {
  conventional: {
    downSingle: 0.15,
    downMulti: 0.2,
    amortYears: 30,
    note: 'Fannie/Freddie investor loan: 15% down (1 unit) or 20% (2–4 units), 30-year fixed. Needs W2 income and under 50% debt-to-income; counts toward the 10-loan limit.',
  },
  fha: {
    down: 0.035,
    upfrontMip: 0.0175,
    annualMip: 0.0055,
    amortYears: 30,
    note: 'Live in one unit for at least a year. 3.5% down, 30-year fixed, plus FHA mortgage insurance (1.75% upfront, 0.55%/yr). One FHA loan at a time.',
  },
  rateShock: { small: 0.01, commercial: 0.02 },
  hardMoney: {
    maxLtvArv: 0.75,
    origination: 0.03,
    rate: 0.125,
    months: 6,
    note: 'Hard money: up to 75% of ARV covering purchase and rehab, 3% origination, ~12–13% interest-only, 6–12 month term (6 months modeled).',
  },
  privateMoney: { rate: 0.08, origination: 0.01 },
  seller: {
    down: 0.05,
    amortYears: 30,
    balloonYears: 5,
    note: 'Seller acts as the bank: 5% down, 30-year amortization, typically a 5-year balloon you refinance once value is up. Rate is whatever you negotiate.',
  },
  carryback: {
    bankLtv: 0.8,
    sellerPct: 0.2,
    rate: 0.05,
    amortYears: 30,
    balloonYears: 3,
    note: 'Bank lends 80%, seller carries back 20% at ~5% amortized over 30 years with a ~3-year balloon. Many banks want the buyer to bring some cash; a transactional lender can cover that.',
  },
  /** Appraisals are opinions: stress the refinance at the low end of a typical ~10% value range. */
  appraisalHaircut: 0.1,
  refi: {
    ltv: 0.8,
    closingPct: 0.02,
    note: 'Refinance with a local bank at 80% of the after-repair value; 2% refinance closing costs.',
  },
} as const;

export interface FinancingOption {
  id: 'base' | 'conventional' | 'fha' | 'seller' | 'carryback' | 'shock';
  name: string;
  detail: string;
  downPct: number | null;
  cashToClose: number;
  monthlyPayment: number;
  monthlyCashFlow: number;
  dscr: number | null;
  note: string;
}

export interface Brrrr {
  hardMoneyLoan: number;
  cashAtPurchase: number; // down + closing + origination + rehab not covered
  holdingCosts: number; // interest during the rehab
  refiLoan: number;
  refiClosing: number;
  cashLeftInDeal: number; // negative = cash pulled out
  monthlyCashFlowAfter: number;
  dscrAfter: number;
  fullyFunded: boolean;
  /** Refinance if the appraisal comes in 10% under the estimated ARV. */
  lowAppraisal: { value: number; refiLoan: number; cashLeftInDeal: number; monthlyCashFlowAfter: number };
  /** Same deal funded by a private lender (~8%, 1 point) instead of hard money. */
  privateMoneySavings: number;
  note: string;
}

/** 50/50 partnership: partner funds the cash, you run the deal; partner's unreturned capital comes back first. */
export interface Partnership {
  partnerCash: number;
  returnedAtRefi: number;
  capitalLeft: number;
  monthlyCashFlowEach: number;
  equity: number;
  partnerEquity: number; // capital left + half the remaining equity
  yourEquity: number;
  partnerCashOnCash: number | null; // on capital still in the deal
  note: string;
}

export interface FinancingAnalysis {
  options: FinancingOption[];
  brrrr: Brrrr | null;
  partnership: Partnership;
}

export function analyzeFinancing(inputs: DealInputs, base: DealResult, commercial: boolean): FinancingAnalysis {
  const units = inputs.units.length;
  const price = inputs.purchasePrice;
  const noi = base.stabilized.noi;
  const rehabCash = inputs.rehabCost * inputs.rehabOutOfPocketPct;
  const options: FinancingOption[] = [];
  const opt = (o: Omit<FinancingOption, 'monthlyCashFlow' | 'dscr'> & { noi?: number }) => {
    const n = o.noi ?? noi;
    const annualDebt = o.monthlyPayment * 12;
    const { noi: _ignored, ...rest } = o;
    options.push({ ...rest, monthlyCashFlow: (n - annualDebt) / 12, dscr: annualDebt > 0 ? n / annualDebt : null });
  };

  opt({
    id: 'base',
    name: commercial ? 'Commercial loan' : 'Investor (DSCR) loan',
    detail: `${Math.round(inputs.downPaymentPct * 100)}% down · ${inputs.amortYears}-yr`,
    downPct: inputs.downPaymentPct,
    cashToClose: base.acquisition.cashInvested,
    monthlyPayment: base.acquisition.monthlyPayment,
    note: commercial
      ? 'Used above. Commercial loans are usually 5–10 year ARMs or balloons, not 30-year fixed.'
      : 'Used above. Qualifies on the property’s DSCR, not your income; doesn’t count toward the 10-loan limit.',
  });

  if (units <= 4 && !commercial) {
    const down = units === 1 ? LOANS.conventional.downSingle : LOANS.conventional.downMulti;
    const loan = price * (1 - down) + (inputs.rehabCost - rehabCash);
    opt({
      id: 'conventional',
      name: 'Conventional loan',
      detail: `${Math.round(down * 100)}% down · 30-yr fixed`,
      downPct: down,
      cashToClose: price * down + inputs.closingCosts + rehabCash,
      monthlyPayment: monthlyPayment(loan, inputs.interestRate, LOANS.conventional.amortYears),
      note: LOANS.conventional.note,
    });
  }

  if (units >= 2 && units <= 4) {
    // House hack: owner lives in one unit, so that unit's rent drops out.
    const rented = analyzeDeal({ ...inputs, units: inputs.units.slice(1) }).stabilized.noi;
    const loan = price * (1 - LOANS.fha.down) * (1 + LOANS.fha.upfrontMip);
    const pmt = monthlyPayment(loan, inputs.interestRate, LOANS.fha.amortYears) + (loan * LOANS.fha.annualMip) / 12;
    opt({
      id: 'fha',
      name: 'House hack (FHA)',
      detail: `3.5% down · live in 1 unit`,
      downPct: LOANS.fha.down,
      cashToClose: price * LOANS.fha.down + inputs.closingCosts + rehabCash,
      monthlyPayment: pmt,
      noi: rented,
      note: LOANS.fha.note,
    });
  }

  // Seller financing: solve the highest seller rate that still meets DSCR 1.20 and $150/unit/month.
  {
    const sf = LOANS.seller;
    const loan = price * (1 - sf.down) + (inputs.rehabCost - rehabCash);
    const works = (r: number) => {
      const debt = monthlyPayment(loan, r, sf.amortYears) * 12;
      return noi / debt >= 1.2 && (noi - debt) / 12 / units >= 150;
    };
    let rate: number | null = null;
    if (works(0)) {
      let lo = 0;
      let hi = 0.15;
      if (works(hi)) lo = hi;
      else for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (works(m)) lo = m; else hi = m; }
      rate = Math.floor(lo * 1000) / 1000;
    }
    const r = rate ?? 0;
    opt({
      id: 'seller',
      name: 'Seller financing',
      detail: rate === null ? 'doesn’t work even at 0%' : `5% down · works up to ${(r * 100).toFixed(1)}%${r >= 0.15 ? '+' : ''}`,
      downPct: sf.down,
      cashToClose: price * sf.down + inputs.closingCosts + rehabCash,
      monthlyPayment: monthlyPayment(loan, r, sf.amortYears),
      note: rate === null
        ? `${sf.note} At this price the rent can’t carry 95% financing, even interest-free.`
        : `${sf.note} Shown at the highest rate that still meets DSCR 1.20 and $150/unit cash flow.`,
    });
  }

  if (commercial || units >= 5) {
    const cb = LOANS.carryback;
    const bankLoan = price * cb.bankLtv + (inputs.rehabCost - rehabCash);
    const sellerLoan = price * cb.sellerPct;
    opt({
      id: 'carryback',
      name: 'Bank + seller carryback',
      detail: `80% bank · 20% seller at ${(cb.rate * 100).toFixed(0)}%`,
      downPct: 0,
      cashToClose: inputs.closingCosts + rehabCash,
      monthlyPayment: monthlyPayment(bankLoan, inputs.interestRate, inputs.amortYears) + monthlyPayment(sellerLoan, cb.rate, cb.amortYears),
      note: cb.note,
    });
  }

  const shock = commercial ? LOANS.rateShock.commercial : LOANS.rateShock.small;
  opt({
    id: 'shock',
    name: commercial ? 'If the ARM resets +2%' : 'If rates are 1% higher',
    detail: `${((inputs.interestRate + shock) * 100).toFixed(1)}% rate`,
    downPct: inputs.downPaymentPct,
    cashToClose: base.acquisition.cashInvested,
    monthlyPayment: monthlyPayment(base.acquisition.loanAmount, inputs.interestRate + shock, inputs.amortYears),
    note: commercial
      ? 'Stress test: what the deal looks like when a 5-year ARM adjusts 2 points higher. Take the longest fixed period you can.'
      : 'Stress test: same loan at a rate 1 point higher.',
  });

  let brrrr: Brrrr | null = null;
  if (inputs.rehabCost > 0 && inputs.arv > 0) {
    const hm = LOANS.hardMoney;
    const need = price + inputs.rehabCost;
    const hardMoneyLoan = Math.min(need, hm.maxLtvArv * inputs.arv);
    const origination = hardMoneyLoan * hm.origination;
    // Interest-only; rehab draws assumed to average half the term.
    const avgBalance = Math.min(price, hardMoneyLoan) + Math.max(hardMoneyLoan - price, 0) / 2;
    const holdingCosts = avgBalance * hm.rate * (hm.months / 12);
    const cashAtPurchase = need - hardMoneyLoan + inputs.closingCosts + origination;
    const refiLoan = LOANS.refi.ltv * inputs.arv;
    const refiClosing = refiLoan * LOANS.refi.closingPct;
    const cashLeftInDeal = cashAtPurchase + holdingCosts + refiClosing + hardMoneyLoan - refiLoan;
    const debt = monthlyPayment(refiLoan, inputs.interestRate, inputs.amortYears) * 12;
    brrrr = {
      hardMoneyLoan,
      cashAtPurchase,
      holdingCosts,
      refiLoan,
      refiClosing,
      cashLeftInDeal,
      monthlyCashFlowAfter: (noi - debt) / 12,
      dscrAfter: debt > 0 ? noi / debt : Infinity,
      fullyFunded: hardMoneyLoan >= need,
      lowAppraisal: (() => {
        const value = inputs.arv * (1 - LOANS.appraisalHaircut);
        const loan = LOANS.refi.ltv * value;
        const left = cashAtPurchase + holdingCosts + loan * LOANS.refi.closingPct + hardMoneyLoan - loan;
        return { value, refiLoan: loan, cashLeftInDeal: left, monthlyCashFlowAfter: (noi - monthlyPayment(loan, inputs.interestRate, inputs.amortYears) * 12) / 12 };
      })(),
      privateMoneySavings:
        origination + holdingCosts -
        (hardMoneyLoan * LOANS.privateMoney.origination + avgBalance * LOANS.privateMoney.rate * (hm.months / 12)),
      note: `${hm.note} ${LOANS.refi.note}`,
    };
  }

  const partnerCash = brrrr ? brrrr.cashAtPurchase + brrrr.holdingCosts : base.acquisition.cashInvested;
  const capitalLeft = brrrr ? Math.max(brrrr.cashLeftInDeal, 0) : base.acquisition.cashInvested;
  const monthlyCf = brrrr ? brrrr.monthlyCashFlowAfter : base.stabilized.cashFlow / 12;
  const value = inputs.arv > 0 ? inputs.arv : price;
  const debt = brrrr ? brrrr.refiLoan : base.acquisition.loanAmount;
  const equity = value - debt;
  const shared = Math.max(equity - capitalLeft, 0);
  const partnership: Partnership = {
    partnerCash,
    returnedAtRefi: partnerCash - capitalLeft,
    capitalLeft,
    monthlyCashFlowEach: monthlyCf / 2,
    equity,
    partnerEquity: Math.min(capitalLeft, equity) + shared / 2,
    yourEquity: shared / 2,
    partnerCashOnCash: capitalLeft > 0 ? (monthlyCf * 12) / 2 / capitalLeft : null,
    note: 'Partner brings the cash, you find, finance, renovate and manage. Any partner money still in the deal comes back to them first on a sale or refinance; cash flow and remaining equity split 50/50.',
  };

  return { options, brrrr, partnership };
}
