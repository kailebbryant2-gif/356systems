import type { DealInputs, DealResult } from './engine/types';

/**
 * Multifamily is valued like a business: value = NOI ÷ cap rate. This shows what
 * small operating changes are worth in property value, and the risk of rising cap rates.
 */
export interface ValueLever {
  id: 'rent25' | 'rent50' | 'billback';
  label: string;
  addedNoi: number; // annual
  addedValue: number;
  note: string;
}

export interface ValueAdd {
  capRate: number;
  value: number;
  valueIfCapUp: number; // cap rate +1 point
  perThousandNoi: number; // value of each extra $1,000/yr of NOI
  levers: ValueLever[];
  incomeValued: boolean; // 5+ units: lenders value on income; 1–4 use sales comps
}

export const CAP_STRESS = 0.01;

export function analyzeValueAdd(inputs: DealInputs, result: DealResult, capRate: number): ValueAdd | null {
  const units = inputs.units.length;
  const noi = result.stabilized.noi;
  if (units < 2 || noi <= 0) return null;
  // Share of each extra rent dollar that reaches NOI after vacancy, maintenance and management.
  const keep = 1 - inputs.vacancyPct - inputs.maintenancePct - inputs.managementPct;
  const rentLever = (id: 'rent25' | 'rent50', bump: number): ValueLever => {
    const addedNoi = bump * 12 * units * keep;
    return {
      id,
      label: `Raise rents $${bump}/unit at renewal`,
      addedNoi,
      addedValue: addedNoi / capRate,
      note: `${units} units × $${bump}/mo, after vacancy and maintenance.`,
    };
  };
  const levers = [rentLever('rent25', 25), rentLever('rent50', 50)];
  const owner = result.stabilized.waterSewerTrash;
  if (owner > 0) {
    levers.push({
      id: 'billback',
      label: 'Bill water, sewer & trash back to tenants',
      addedNoi: owner,
      addedValue: owner / capRate,
      note: 'Utility billback (RUBS) or separate meters, if tenants reimburse the full amount.',
    });
  }
  return {
    capRate,
    value: noi / capRate,
    valueIfCapUp: noi / (capRate + CAP_STRESS),
    perThousandNoi: 1000 / capRate,
    levers,
    incomeValued: units >= 5,
  };
}
