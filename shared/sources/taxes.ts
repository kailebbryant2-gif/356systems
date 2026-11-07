/**
 * Property-tax rate estimates, used only when no tax bill is available or to estimate
 * post-purchase reassessment.
 *
 * Fallback: approximate statewide effective rate on owner-occupied homes (median taxes paid ÷
 * median home value, Census ACS, rounded). Rental and multifamily property can be assessed
 * differently, and rates vary a lot by county and city — this is a screening estimate only.
 *
 * Better: if CENSUS_API_KEY is set, the county-level ACS ratio is used instead.
 */
export const STATE_EFFECTIVE_RATE: Record<string, number> = {
  AL: 0.0038, AK: 0.0101, AZ: 0.0052, AR: 0.0057, CA: 0.0071, CO: 0.0049, CT: 0.017, DE: 0.0051, DC: 0.0057,
  FL: 0.008, GA: 0.0081, HI: 0.0027, ID: 0.0056, IL: 0.0195, IN: 0.0077, IA: 0.0143, KS: 0.0129, KY: 0.0075,
  LA: 0.0051, ME: 0.0104, MD: 0.0097, MA: 0.0108, MI: 0.0124, MN: 0.0102, MS: 0.007, MO: 0.0091, MT: 0.0067,
  NE: 0.015, NV: 0.0048, NH: 0.0161, NJ: 0.0208, NM: 0.0067, NY: 0.0136, NC: 0.007, ND: 0.0092, OH: 0.0136,
  OK: 0.0081, OR: 0.0086, PA: 0.0135, RI: 0.0126, SC: 0.0051, SD: 0.0107, TN: 0.0056, TX: 0.0147, UT: 0.0052,
  VT: 0.0171, VA: 0.008, WA: 0.008, WV: 0.0053, WI: 0.0138, WY: 0.0055,
};

export interface TaxRate {
  rate: number;
  level: 'county' | 'state';
  note: string;
}

export async function effectiveTaxRate(
  state: string,
  stateFips: string,
  countyFips: string,
  countyName: string,
  signal?: AbortSignal,
): Promise<TaxRate | null> {
  const key = process.env.CENSUS_API_KEY;
  if (key && stateFips && countyFips) {
    try {
      const url = new URL('https://api.census.gov/data/2023/acs/acs5');
      url.searchParams.set('get', 'B25103_001E,B25077_001E');
      url.searchParams.set('for', `county:${countyFips}`);
      url.searchParams.set('in', `state:${stateFips}`);
      url.searchParams.set('key', key);
      const res = await fetch(url, { signal, redirect: 'manual' });
      if (res.ok) {
        const rows: string[][] = await res.json();
        const taxes = Number(rows?.[1]?.[0]);
        const value = Number(rows?.[1]?.[1]);
        if (taxes > 0 && value > 0) {
          return {
            rate: taxes / value,
            level: 'county',
            note: `${countyName} median taxes ÷ median home value (Census ACS 2019–2023).`,
          };
        }
      }
    } catch {
      /* fall through to the state rate */
    }
  }
  const rate = STATE_EFFECTIVE_RATE[state];
  if (!rate) return null;
  return { rate, level: 'state', note: `Approximate ${state} statewide effective tax rate (owner-occupied homes).` };
}
