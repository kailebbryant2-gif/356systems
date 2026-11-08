export interface GeocodedAddress {
  matchedAddress: string; // "3520 WYOMING ST, SAINT LOUIS, MO, 63118"
  houseNumber: string;
  streetName: string; // "WYOMING"
  city: string;
  state: string; // "MO"
  zip: string;
  stateFips: string; // "29"
  countyFips: string; // "510"
  countyName: string;
  lat: number;
  lon: number;
}

export interface Suggestion {
  label: string;
}

const UA = 'Dealwise/2.0 (deal screening tool)';

/** US Census geocoder: official, free, no key. Gives the canonical address and county FIPS. */
export async function geocode(address: string, signal?: AbortSignal): Promise<GeocodedAddress | null> {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress');
  url.searchParams.set('address', address);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('vintage', 'Current_Current');
  url.searchParams.set('layers', 'Counties');
  url.searchParams.set('format', 'json');
  const res = await fetch(url, { signal, headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Census geocoder returned ${res.status}`);
  const data: any = await res.json();
  const m = data?.result?.addressMatches?.[0];
  if (!m) return null;
  const c = m.addressComponents ?? {};
  const county = m.geographies?.Counties?.[0] ?? {};
  const houseNumber = String(m.matchedAddress ?? '').match(/^\s*(\d+[A-Z]?)/i)?.[1] ?? '';
  return {
    matchedAddress: m.matchedAddress,
    houseNumber,
    streetName: String(c.streetName ?? ''),
    city: String(c.city ?? ''),
    state: String(c.state ?? ''),
    zip: String(c.zip ?? ''),
    stateFips: String(county.STATE ?? ''),
    countyFips: String(county.COUNTY ?? ''),
    countyName: String(county.NAME ?? ''),
    lat: Number(m.coordinates?.y),
    lon: Number(m.coordinates?.x),
  };
}

/** Photon (OpenStreetMap) address suggestions: free, no key. US results only. */
async function photon(q: string, signal?: AbortSignal): Promise<any[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '10');
  url.searchParams.set('lang', 'en');
  // Bias toward the continental US.
  url.searchParams.set('lat', '38.6');
  url.searchParams.set('lon', '-90.2');
  const res = await fetch(url, { signal, headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Address suggestions returned ${res.status}`);
  const data: any = await res.json();
  return data?.features ?? [];
}

/** Photon (OpenStreetMap) address suggestions: free, no key. US results only. */
export async function suggest(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  return suggestPhoton(q, signal);
}

async function suggestPhoton(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const typed = q.match(/^\s*(\d+[A-Za-z]?)\s+(.+)$/);
  // Sequential on purpose: Photon is a shared free service.
  const full = await photon(q, signal);
  const streetOnly = typed ? await photon(typed[2], signal).catch(() => []) : [];
  const data = { features: [...full, ...streetOnly] };
  const typedNumber = typed?.[1] ?? null;
  const seen = new Set<string>();
  const exact: Suggestion[] = [];
  const streets: Suggestion[] = [];
  for (const f of data?.features ?? []) {
    const p = f.properties ?? {};
    if (p.countrycode !== 'US') continue;
    const state = STATE_ABBR[p.state] ?? p.state ?? '';
    const tail = [p.city ?? p.locality ?? p.county ?? '', `${state} ${p.postcode ?? ''}`.trim()].filter(Boolean).join(', ');
    let line: string | null = null;
    let bucket = exact;
    if (p.housenumber && p.street) line = `${p.housenumber} ${p.street}`;
    else if (typedNumber && p.type === 'street' && p.name) {
      // OpenStreetMap often lacks house numbers in the US: offer the typed number on the matching street.
      line = `${typedNumber} ${p.name}`;
      bucket = streets;
    }
    if (!line) continue;
    const label = `${line}, ${tail}`;
    if (seen.has(label)) continue;
    seen.add(label);
    bucket.push({ label });
  }
  // Prefer results in the city the user typed ("St Louis" ≈ "Saint Louis").
  const norm = (x: string) => ` ${x.toLowerCase().replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ')} `;
  const nq = norm(q);
  const score = (s: Suggestion) => {
    const city = norm(s.label.split(', ')[1] ?? '').trim();
    return city && nq.includes(` ${city} `) ? 1 : 0;
  };
  const out = [...exact, ...streets]
    .map((s, i) => ({ s, i, k: score(s) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((x) => x.s)
    .slice(0, 5);
  return out;
}

export const STATE_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT',
  Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL',
  Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT',
  Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA',
  'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
