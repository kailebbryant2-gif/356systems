/**
 * Local St. Louis rent rules of thumb (whole-unit monthly rent by bedrooms).
 * Used before the HUD metro benchmark when the property is in a covered area.
 * Real rental comps are better; these are general screening numbers.
 */
export interface LocalRent {
  area: string;
  byBedrooms: Partial<Record<1 | 2 | 3 | 4, number>>;
  note: string;
}

const SOUTH_CITY_NORTH_COUNTY = { 1: 900, 2: 1150, 3: 1450, 4: 1700 } as const;

/** City of St. Louis neighborhood codes 1–34: the south side (Carondelet through Soulard / Lafayette Square). */
const SOUTH_CITY_NBHDS = new Set(Array.from({ length: 34 }, (_, i) => String(i + 1)));

/** North St. Louis County ZIP codes. */
const NORTH_COUNTY_ZIPS = new Set([
  '63031', '63033', '63034', '63042', '63044', '63074', '63114', '63121',
  '63133', '63134', '63135', '63136', '63137', '63138', '63140',
]);

export function localRent(opts: { inStlCity: boolean; cityNbhd?: string | null; zip: string }): LocalRent | null {
  const nb = opts.cityNbhd ? String(Number(opts.cityNbhd)) : null;
  if (opts.inStlCity && nb && SOUTH_CITY_NBHDS.has(nb)) {
    return { area: 'South City', byBedrooms: SOUTH_CITY_NORTH_COUNTY, note: 'St. Louis rule of thumb for South City' };
  }
  if (!opts.inStlCity && NORTH_COUNTY_ZIPS.has(opts.zip)) {
    return { area: 'North County', byBedrooms: SOUTH_CITY_NORTH_COUNTY, note: 'St. Louis rule of thumb for North County' };
  }
  return null;
}
