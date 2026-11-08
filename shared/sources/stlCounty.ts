import type { ArvEstimate, Comp } from './stlComps';

/**
 * St. Louis County ARV from assessor appraised values (free, no key).
 * Missouri doesn't publish sale prices, so for County addresses the ARV is built from the
 * county's current appraised values of similar homes in the same assessor neighborhood.
 * Appraised values usually lag the market and don't reflect renovations, so this leans conservative.
 */

const LAYER = 'https://services2.arcgis.com/w657bnjzrjguNyOy/arcgis/rest/services/Pardata_Juris/FeatureServer/1/query';
const FIELDS = 'LOCATOR,TAXYR,PROP_ADD,PROP_ZIP,TOTAPVAL,LIVUNIT,YEARBLT,RESQFT,NBHD,MUNICIPALITY';

interface Row {
  LOCATOR: string;
  TAXYR: number | null;
  PROP_ADD: string | null;
  PROP_ZIP: string | null;
  TOTAPVAL: number | null;
  LIVUNIT: number | null;
  YEARBLT: number | null;
  RESQFT: number | null;
  NBHD: string | null;
  MUNICIPALITY: string | null;
}

export interface CountyParcel {
  locator: string;
  address: string;
  zip: string;
  units: number;
  area: number;
  yearBuilt: number | null;
  appraised: number;
  nbhd: string | null;
  municipality: string | null;
  taxYear: number | null;
}

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function query(where: string, signal?: AbortSignal, extra: Record<string, string> = {}): Promise<Row[]> {
  const url = new URL(LAYER);
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', FIELDS);
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`County parcel service returned ${res.status}`);
  const data: any = await res.json();
  if (data.error) throw new Error(`County parcel service: ${data.error.message ?? 'error'}`);
  return (data.features ?? []).map((f: any) => f.attributes as Row);
}

const toParcel = (r: Row): CountyParcel => ({
  locator: r.LOCATOR,
  address: (r.PROP_ADD ?? '').replace(/\s+/g, ' ').trim(),
  zip: r.PROP_ZIP ?? '',
  units: r.LIVUNIT ?? 0,
  area: r.RESQFT ?? 0,
  yearBuilt: r.YEARBLT || null,
  appraised: r.TOTAPVAL ?? 0,
  nbhd: r.NBHD,
  municipality: r.MUNICIPALITY,
  taxYear: r.TAXYR,
});

/** Find the County parcel for a geocoded street line ("501 S FLORISSANT RD") and ZIP. */
export async function findCountyParcel(street: string, zip: string, signal?: AbortSignal): Promise<CountyParcel | null> {
  const s = street.toUpperCase().replace(/\s+/g, ' ').trim();
  let rows = await query(`PROP_ADD = ${sqlStr(s)} AND PROP_ZIP = ${sqlStr(zip)}`, signal);
  if (!rows.length) {
    const [num, ...rest] = s.split(' ');
    const name = rest.filter((t) => !/^(N|S|E|W|NORTH|SOUTH|EAST|WEST)$/.test(t))[0];
    if (num && name) rows = await query(`PROP_ADD LIKE ${sqlStr(`${num} %${name}%`)} AND PROP_ZIP = ${sqlStr(zip)}`, signal);
  }
  const best = rows.filter((r) => (r.TOTAPVAL ?? 0) > 0).sort((a, b) => (b.LIVUNIT ?? 0) - (a.LIVUNIT ?? 0))[0];
  return best ? toParcel(best) : null;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

export const COUNTY_MIN_COMPS = 5;

/** Pure: build an ARV from the subject and a set of neighboring parcels. */
export function countyArvFrom(subject: CountyParcel, neighbors: CountyParcel[], ring: string): ArvEstimate | null {
  if (subject.units < 1) return null; // not a residential parcel
  const type = Math.min(Math.max(subject.units, 1), 5);
  // The county layer can repeat a parcel; keep one row per parcel (and per address).
  const seen = new Set<string>();
  const pool = neighbors.filter((n) => {
    const key = `${n.locator}|${n.address}`;
    if (seen.has(n.locator) || seen.has(n.address) || n.locator === subject.locator) return false;
    seen.add(n.locator);
    seen.add(n.address);
    return n.appraised > 10000 && Math.min(Math.max(n.units, 1), 5) === type && !!key;
  });
  const perSqft = subject.area > 0 && type < 5;
  const sized = perSqft ? pool.filter((n) => n.area > 0 && Math.abs(n.area - subject.area) / subject.area <= 0.35) : pool;
  const set = sized.length >= COUNTY_MIN_COMPS ? sized : [];
  if (!set.length) return null;
  const value = (n: CountyParcel) =>
    perSqft ? (n.appraised / n.area) * subject.area : type === 5 ? (n.appraised / Math.max(n.units, 1)) * subject.units : n.appraised;
  const values = set.map(value);
  const arv = Math.round(quantile(values, 0.75) / 1000) * 1000;
  const comps: Comp[] = [...set]
    .sort((a, b) => Math.abs(a.area - subject.area) - Math.abs(b.area - subject.area))
    .slice(0, 8)
    .map((n) => ({
      address: n.address.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()),
      date: `${n.taxYear ?? new Date().getFullYear()}-01-01`,
      price: n.appraised,
      units: n.units,
      area: n.area,
      kind: 'appraised',
    }));
  const how = perSqft ? `appraised value per sq ft × ${subject.area.toLocaleString('en-US')} sq ft` : type === 5 ? `appraised value per unit × ${subject.units} units` : 'appraised value';
  const unitWord = type === 1 ? 'single-family' : type === 5 ? '5+ unit' : `${type}-unit`;
  return {
    arv,
    low: Math.round(quantile(values, 0.25) / 1000) * 1000,
    high: Math.round(quantile(values, 0.9) / 1000) * 1000,
    method: `75th percentile ${how} of ${set.length} similar ${unitWord} properties (${ring}). St. Louis County doesn’t publish sale prices, so this uses the county’s ${subject.taxYear ?? ''} appraised values, which usually run below market and don’t reflect renovations.`,
    basis: 'upper-quartile',
    perSqft,
    area: ring,
    comps,
    compCount: set.length,
    latestSale: `${subject.taxYear ?? new Date().getFullYear()}-01-01`,
    source: 'county-appraisal',
    subject: { parcelId: subject.locator, address: subject.address, units: subject.units, area: subject.area, yearBuilt: subject.yearBuilt, nbhd: subject.nbhd ?? '' },
  };
}

export async function countyArv(subject: CountyParcel, signal?: AbortSignal): Promise<ArvEstimate | null> {
  if (subject.units < 1) return null;
  const units = subject.units >= 5 ? 'LIVUNIT >= 5' : `LIVUNIT = ${Math.max(subject.units, 1)}`;
  const size =
    subject.area > 0 && subject.units < 5
      ? ` AND RESQFT BETWEEN ${Math.floor(subject.area * 0.65)} AND ${Math.ceil(subject.area * 1.35)}`
      : '';
  const rings: { label: string; where: string }[] = [];
  if (subject.nbhd) rings.push({ label: 'same assessor neighborhood', where: `NBHD = ${sqlStr(subject.nbhd)}` });
  if (subject.zip) rings.push({ label: `ZIP ${subject.zip}`, where: `PROP_ZIP = ${sqlStr(subject.zip)}` });
  for (const ring of rings) {
    const rows = await query(`${ring.where} AND ${units}${size} AND TOTAPVAL > 10000`, signal, { resultRecordCount: '2000' });
    const est = countyArvFrom(subject, rows.map(toParcel), ring.label);
    if (est) return est;
  }
  return null;
}

/** Address suggestions from the County parcel list. */
export async function suggestCountyAddresses(q: string, signal?: AbortSignal): Promise<string[]> {
  const s = q.split(',')[0].toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/^\d+ [A-Z0-9]{2,}/.test(s)) return [];
  const rows = await query(`PROP_ADD LIKE ${sqlStr(`${s}%`)}`, signal, { resultRecordCount: '8', orderByFields: 'PROP_ADD' });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const label = `${(r.PROP_ADD ?? '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())}, ${
      (r.MUNICIPALITY ?? 'St. Louis County').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase())
    }, MO ${r.PROP_ZIP ?? ''}`.trim();
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
    if (out.length >= 5) break;
  }
  return out;
}
