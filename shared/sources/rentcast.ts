/**
 * RentCast rent estimate (long-term rental AVM): the whole home for single-family, or one
 * unit for 2+ unit buildings (priced against nearby apartments with the same bedroom count).
 * https://developers.rentcast.io  ·  key in the RENTCAST_API_KEY environment variable.
 *
 * Each analysis costs at most one API call. Results are cached for 30 days per address, and
 * calls stop at RENTCAST_MONTHLY_LIMIT per calendar month (default 50, the free plan) so the
 * app never runs into overage charges. The counter lives in memory, so it restarts with the server.
 */

export interface RentComp {
  address: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  rent: number;
  miles: number | null;
  date: string | null; // YYYY-MM-DD listed
}

export interface RentEstimate {
  rent: number;
  low: number;
  high: number;
  /** RentCast's property record for the subject. */
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  propertyType: string | null;
  comps: RentComp[];
}

const API = 'https://api.rentcast.io/v1/avm/rent/long-term';
const TTL_MS = 30 * 24 * 3600 * 1000;
const cache = new Map<string, { at: number; value: RentEstimate | null }>();
let usage = { month: '', calls: 0 };

export function rentcastEnabled(): boolean {
  return !!process.env.RENTCAST_API_KEY;
}

export function rentcastUsage(): { month: string; calls: number; limit: number } {
  return { ...usage, limit: monthlyLimit() };
}

function monthlyLimit(): number {
  const n = Number(process.env.RENTCAST_MONTHLY_LIMIT);
  return Number.isFinite(n) && n >= 0 ? n : 50;
}

/** Parse the API response (pure, for tests). */
export function parseRentcast(d: any): RentEstimate | null {
  if (!d || !(Number(d.rent) > 0)) return null;
  const s = d.subjectProperty ?? {};
  const num = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
  return {
    rent: Math.round(Number(d.rent)),
    low: Math.round(Number(d.rentRangeLow) || Number(d.rent)),
    high: Math.round(Number(d.rentRangeHigh) || Number(d.rent)),
    beds: num(s.bedrooms),
    baths: num(s.bathrooms),
    sqft: num(s.squareFootage),
    propertyType: s.propertyType ?? null,
    comps: (Array.isArray(d.comparables) ? d.comparables : [])
      .filter((c: any) => Number(c.price) > 0)
      .map((c: any) => ({
        address: String(c.formattedAddress ?? c.addressLine1 ?? ''),
        beds: num(c.bedrooms),
        baths: num(c.bathrooms),
        sqft: num(c.squareFootage),
        rent: Math.round(Number(c.price)),
        miles: Number.isFinite(Number(c.distance)) ? Math.round(Number(c.distance) * 100) / 100 : null,
        date: typeof c.listedDate === 'string' ? c.listedDate.slice(0, 10) : null,
      }))
      .slice(0, 8),
  };
}

/** Typical unit size by bedrooms, when the record has no building area. */
const UNIT_SQFT = { 1: 650, 2: 900, 3: 1150, 4: 1400 } as const;

export async function rentEstimate(
  address: string,
  building: { units: number; bedsPerUnit: number; sqftPerUnit?: number | null },
  signal?: AbortSignal,
): Promise<RentEstimate | null> {
  const key = process.env.RENTCAST_API_KEY;
  if (!key) return null;
  const multi = building.units > 1;
  const beds = Math.min(Math.max(Math.round(building.bedsPerUnit), 1), 4) as 1 | 2 | 3 | 4;
  const k = `${address.toUpperCase().replace(/\s+/g, ' ').trim()}|${multi ? `unit-${beds}` : 'house'}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const month = new Date().toISOString().slice(0, 7);
  if (usage.month !== month) usage = { month, calls: 0 };
  if (usage.calls >= monthlyLimit()) return null;
  usage.calls++;

  const url = new URL(API);
  url.searchParams.set('address', address);
  url.searchParams.set('compCount', '10');
  if (multi) {
    url.searchParams.set('propertyType', 'Apartment');
    url.searchParams.set('bedrooms', String(beds));
    url.searchParams.set('bathrooms', '1');
    url.searchParams.set('squareFootage', String(Math.round(building.sqftPerUnit || UNIT_SQFT[beds])));
  }
  const r = await fetch(url, { headers: { 'X-Api-Key': key, Accept: 'application/json' }, signal });
  if (!r.ok) {
    // 404 = RentCast has no estimate for this address; cache that so it isn't paid for twice.
    if (r.status === 404) cache.set(k, { at: Date.now(), value: null });
    return null;
  }
  const value = parseRentcast(await r.json());
  cache.set(k, { at: Date.now(), value });
  return value;
}
