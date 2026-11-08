import type { DealInputs, DealResult } from './engine/types';

/**
 * Multifamily is valued like a business: value = NOI ÷ cap rate. This shows what
 * small operating changes are worth in property value, the most worth spending on each
 * (3-year payback rule), and the risk of rising cap rates.
 */
export interface ValueLever {
  id: 'rent25' | 'rent50' | 'rubs' | 'pet' | 'parking';
  label: string;
  addedNoi: number; // annual
  addedValue: number;
  /** Most worth spending to get it: pays back within 3 years. */
  maxSpend: number;
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
export const PAYBACK_YEARS = 3;
export const RUBS = { oneBed: 45, twoPlus: 65 } as const;
export const PET_RENT = 45;
export const PARKING_RENT = 100;

export function analyzeValueAdd(inputs: DealInputs, result: DealResult, capRate: number): ValueAdd | null {
  const units = inputs.units.length;
  const noi = result.stabilized.noi;
  if (units < 2 || noi <= 0) return null;
  const occupied = 1 - inputs.vacancyPct;
  const lever = (id: ValueLever['id'], label: string, addedNoi: number, note: string): ValueLever => ({
    id,
    label,
    addedNoi,
    addedValue: addedNoi / capRate,
    maxSpend: addedNoi * PAYBACK_YEARS,
    note,
  });
  // Share of each extra rent dollar that reaches NOI after vacancy, maintenance and management.
  const keep = 1 - inputs.vacancyPct - inputs.maintenancePct - inputs.managementPct;
  const levers = [25, 50].map((bump) =>
    lever(
      bump === 25 ? 'rent25' : 'rent50',
      `Raise rents $${bump}/unit at renewal`,
      bump * 12 * units * keep,
      `${units} units × $${bump}/mo, after vacancy and maintenance.`,
    ),
  );
  if (result.stabilized.waterSewerTrash > 0) {
    const monthly = inputs.units.reduce((s, u) => s + (u.beds <= 1 ? RUBS.oneBed : RUBS.twoPlus), 0);
    levers.push(
      lever(
        'rubs',
        'Bill water, sewer & trash back (RUBS)',
        monthly * 12 * occupied,
        `$${RUBS.oneBed}/mo per 1-bed, $${RUBS.twoPlus}/mo per 2+ bed, on occupied units.`,
      ),
    );
  }
  levers.push(
    lever('pet', `Each pet at $${PET_RENT}/mo pet rent`, PET_RENT * 12, 'A fenced dog park helps attract pet owners.'),
    lever('parking', `Each parking spot at $${PARKING_RENT}/mo`, PARKING_RENT * 12, 'Charge for spaces or garage stalls that are free today.'),
  );
  return {
    capRate,
    value: noi / capRate,
    valueIfCapUp: noi / (capRate + CAP_STRESS),
    perThousandNoi: 1000 / capRate,
    levers,
    incomeValued: units >= 5,
  };
}
