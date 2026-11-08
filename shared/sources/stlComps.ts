import { readFileSync } from 'node:fs';

/**
 * ARV from comparable sales, using the City of St. Louis Assessor's sales records
 * (bundled by scripts/build-stl-data.py). Works like a broker's opinion of value:
 * similar property type, same neighborhood, recent, similar size when known.
 */

type SaleRow = [string, string, string, string, number, number, number, string, 'arms' | 'rehab' | 'asis', number | null];
type ParcelRow = [string, string, string, number, number, number | null];

export interface Comp {
  address: string;
  date: string; // YYYY-MM-DD
  price: number;
  units: number;
  area: number; // building sq ft, 0 if unknown
  kind: 'arms' | 'rehab' | 'asis' | 'appraised';
}

export interface Subject {
  parcelId: string;
  address: string;
  units: number;
  area: number;
  yearBuilt: number | null;
  /** City of St. Louis neighborhood code (1–79). */
  nbhd: string;
}

export interface ArvEstimate {
  arv: number;
  low: number;
  high: number;
  method: string;
  basis: 'rehab-median' | 'upper-quartile';
  perSqft: boolean;
  area: string; // which neighborhood ring was used
  comps: Comp[]; // the sales the estimate is built from (most recent first)
  compCount: number;
  latestSale: string;
  /** City sales records, or County appraised values. */
  source: 'city-sales' | 'county-appraisal';
  subject: Subject;
}

let cache: { sales: SaleRow[]; parcels: Record<string, ParcelRow>; byAddr: Map<string, string>; latestSale: string } | null = null;

function load() {
  if (cache) return cache;
  const read = (f: string) => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8'));
  const s = read('stl-sales.json');
  const p = read('stl-parcels.json');
  const byAddr = new Map<string, string>();
  for (const [pid, row] of Object.entries(p.rows as Record<string, ParcelRow>)) byAddr.set(row[0], pid);
  cache = { sales: s.rows, parcels: p.rows, byAddr, latestSale: s.meta.latestSale };
  return cache;
}

/** "1488-9-070.000" → "14889070000" */
export function normalizeParcelId(id: string): string {
  return `${id.replace(/[^\d]/g, '')}0`.slice(0, 11);
}

/** Typed street suffixes → the city's abbreviations. */
const SUFFIX: Record<string, string> = {
  AVE: 'AV', AVENUE: 'AV', STREET: 'ST', STR: 'ST', BOULEVARD: 'BLVD', BLV: 'BLVD', PLACE: 'PL', COURT: 'CT', DRIVE: 'DR',
  ROAD: 'RD', LANE: 'LA', LN: 'LA', TERRACE: 'TER', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
};

function normalizeStreet(q: string): string {
  return q
    .split(',')[0]
    .toUpperCase()
    .replace(/[.#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => SUFFIX[t] ?? t)
    .join(' ');
}

const title = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(\d+)(St|Nd|Rd|Th)\b/g, (_, n, x) => n + x.toLowerCase());

let normIndex: [string, string][] | null = null;
function normalizedIndex() {
  normIndex ??= [...load().byAddr.keys()].map((a) => [normalizeStreet(a), a] as [string, string]);
  return normIndex;
}

/** Instant suggestions from the City of St. Louis parcel address list (no outside service). */
export function suggestStlAddresses(q: string, limit = 5): string[] {
  const key = normalizeStreet(q);
  if (!/^\d+\s+\S/.test(key)) return [];
  const out: string[] = [];
  for (const [norm, addr] of normalizedIndex()) {
    if (norm.startsWith(key)) {
      out.push(`${title(addr)}, St. Louis, MO`);
      if (out.length >= limit) break;
    }
  }
  return out.sort((a, b) => a.length - b.length);
}

export function findSubject(opts: { parcelId?: string | null; street?: string }): Subject | null {
  const d = load();
  let pid = opts.parcelId ? normalizeParcelId(opts.parcelId) : null;
  if (!pid || !d.parcels[pid]) {
    const key = (opts.street ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    pid = d.byAddr.get(key) ?? null;
  }
  if (!pid || !d.parcels[pid]) return null;
  const [address, , nbhd, units, area, yearBuilt] = d.parcels[pid];
  return { parcelId: pid, address, units, area, yearBuilt, nbhd };
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

const monthsBefore = (iso: string, months: number) => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
};

export const MIN_COMPS = 3;

export function estimateArv(subject: Subject): ArvEstimate | null {
  const d = load();
  const [, asr, nbhd] = d.parcels[subject.parcelId];
  const type = Math.min(subject.units, 5);
  const unitsOf = (pid: string, fallback: number) => d.parcels[pid]?.[3] || fallback;
  const pool = d.sales.filter((r) => r[4] === type && r[0] !== subject.parcelId);

  const rings: { label: string; pick: (r: SaleRow) => boolean; months: number }[] = [
    { label: 'same assessor neighborhood, last 18 months', pick: (r) => r[2] === asr, months: 18 },
    { label: 'same assessor neighborhood, last 3 years', pick: (r) => r[2] === asr, months: 36 },
    { label: 'same city neighborhood, last 3 years', pick: (r) => r[3] === nbhd, months: 36 },
  ];
  // Apartment buildings trade rarely; value them on city-wide price per unit as a last resort.
  if (type === 5) rings.push({ label: 'all of St. Louis City, last 3 years, per unit', pick: () => true, months: 36 });

  for (const ring of rings) {
    const since = monthsBefore(d.latestSale, ring.months);
    let set = pool.filter((r) => ring.pick(r) && r[7] >= since);
    // Size match within ±35% when the subject's building area is known.
    const sized = subject.area > 0 ? set.filter((r) => r[5] > 0 && Math.abs(r[5] - subject.area) / subject.area <= 0.35) : [];
    const perSqft = sized.length >= MIN_COMPS;
    if (perSqft) set = sized;
    if (set.length < MIN_COMPS) continue;

    // Value each comp as $/sq ft (size known), $/unit (5+ units) or price.
    const value = (r: SaleRow) =>
      perSqft ? (r[6] / r[5]) * subject.area : type === 5 ? (r[6] / unitsOf(r[0], 5)) * subject.units : r[6];
    const rehab = set.filter((r) => r[8] === 'rehab');
    const useRehab = rehab.length >= MIN_COMPS;
    const basisSet = useRehab ? rehab : set;
    const values = basisSet.map(value);
    const arv = Math.round((useRehab ? quantile(values, 0.5) : quantile(values, 0.75)) / 1000) * 1000;
    const comps = [...basisSet]
      .sort((a, b) => b[7].localeCompare(a[7]))
      .map((r): Comp => ({ address: r[1], date: r[7], price: r[6], units: unitsOf(r[0], r[4]), area: r[5], kind: r[8] }));

    const unitWord = type === 1 ? 'single-family' : type === 5 ? '5+ unit' : `${type}-unit`;
    const how = perSqft ? `price per sq ft × ${subject.area.toLocaleString('en-US')} sq ft` : type === 5 ? `price per unit × ${subject.units} units` : 'sale price';
    const method = useRehab
      ? `Median ${how} of ${basisSet.length} renovated ${unitWord} sales (${ring.label}).`
      : `75th percentile ${how} of ${basisSet.length} ${unitWord} sales (${ring.label}). Few renovated sales, so the upper quartile stands in for renovated condition.`;
    return {
      arv,
      low: Math.round(quantile(values, 0.25) / 1000) * 1000,
      high: Math.round(quantile(values, 0.9) / 1000) * 1000,
      method,
      basis: useRehab ? 'rehab-median' : 'upper-quartile',
      perSqft,
      area: ring.label,
      comps: comps.slice(0, 8),
      compCount: basisSet.length,
      latestSale: d.latestSale,
      source: 'city-sales',
      subject,
    };
  }
  return null;
}
