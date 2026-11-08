import { describe, expect, it } from 'vitest';
import { analyzeDeal } from '../shared/engine/engine';
import data from './fixtures/closed-deals.json';

/**
 * 11 deals James underwrote and closed (anonymized). Feeding his own inputs into the engine
 * must reproduce his spreadsheet's mortgage payment and NOI, so Dealwise and his workbook agree
 * on the math and differ only in assumptions.
 */
describe('reproduces James’s spreadsheet on his closed deals', () => {
  for (const d of data.deals) {
    it(d.id, () => {
      const owner = { lawnSnow: d.lawnMonthly, waterSewerTrash: d.ownerUtilitiesMonthly, electricGas: 0 };
      const r = analyzeDeal({
        purchasePrice: d.price,
        closingCosts: 0,
        downPaymentPct: d.downPct,
        interestRate: d.rate,
        amortYears: d.amortYears,
        rehabCost: 0,
        rehabOutOfPocketPct: 1,
        arv: d.price,
        units: [{ beds: 2, baths: 1, sqft: 1000, currentRent: d.currentRent, marketRent: d.marketRent }],
        vacancyPct: d.vacancyPct,
        taxesCurrent: d.taxesAnnual,
        taxesStabilized: d.taxesAnnual,
        insurance: d.insuranceMonthly * 12,
        managementPct: d.managementPct,
        maintenancePct: d.maintenancePct,
        current: owner,
        stabilized: owner,
        buildingValueRatio: 0.8,
        marginalTaxRate: 0.3,
        appreciationPct: 0.03,
        holdYears: 5,
      });
      expect(r.acquisition.monthlyPayment).toBeCloseTo(d.sheet.monthlyPayment, 1);
      expect(r.current.noi / 12).toBeCloseTo(d.sheet.currentNoiMonthly, 1);
      expect(r.stabilized.noi / 12).toBeCloseTo(d.sheet.stabilizedNoiMonthly, 1);
    });
  }
});
