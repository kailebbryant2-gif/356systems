import * as cheerio from 'cheerio';
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export interface ListingFacts {
  url: string;
  addressText: string | null;
  units: number | null;
  totalBeds: number | null;
  totalBaths: number | null;
  sqft: number | null;
  monthlyRent: number | null; // current whole-building scheduled rent
  rentBasis: string | null; // the phrase the rent came from
  annualTaxes: number | null;
  description: string;
  photos: string[];
  text: string; // visible text, used for keyword rehab screening
}

export type ListingStatus =
  | { ok: true; facts: ListingFacts }
  | { ok: false; reason: 'blocked' | 'unreachable' | 'not_html' | 'invalid_url'; detail: string };

const num = (s: string | undefined | null) => {
  if (!s) return null;
  const n = Number(String(s).replace(/[,$\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const UNIT_WORDS: [RegExp, number][] = [
  [/\b(single[- ]family|sfr|single family home)\b/i, 1],
  [/\b(duplex|two[- ]family|2[- ]family|2[- ]unit)\b/i, 2],
  [/\b(triplex|three[- ]family|3[- ]family|3[- ]unit)\b/i, 3],
  [/\b(fourplex|four[- ]plex|quadplex|quad[- ]plex|4[- ]plex|four[- ]family|4[- ]family|4[- ]unit)\b/i, 4],
];

function flatten(x: any, out: any[] = []): any[] {
  if (Array.isArray(x)) x.forEach((y) => flatten(y, out));
  else if (x && typeof x === 'object') {
    out.push(x);
    if (x['@graph']) flatten(x['@graph'], out);
    for (const v of Object.values(x)) if (v && typeof v === 'object') flatten(v, out);
  }
  return out;
}

/** Room counts: building totals win; "each unit 2 bed" is multiplied by the unit count when known. */
function roomCount(hay: string, re: RegExp, units: number | null): number | null {
  let perUnit: number | null = null;
  for (const m of hay.matchAll(re)) {
    const before = hay.slice(Math.max(0, (m.index ?? 0) - 25), m.index).toLowerCase();
    const n = num(m[1]);
    if (n === null) continue;
    if (/(each|per|every|all)\s+(unit|apartment|apt)s?\b[^.]*$/.test(before)) perUnit ??= n;
    else return n;
  }
  return perUnit !== null && units ? perUnit * units : null;
}

/** Pure parser: extracts only facts the page states. Never guesses. */
export function parseListing(html: string, url: string): ListingFacts {
  const $ = cheerio.load(html);
  const ld: any[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      flatten(JSON.parse($(el).contents().text()), ld);
    } catch {
      /* ignore malformed JSON-LD */
    }
  });

  const meta = (name: string) =>
    $(`meta[property="${name}"]`).attr('content') ?? $(`meta[name="${name}"]`).attr('content') ?? '';

  // Address
  let addressText: string | null = null;
  for (const o of ld) {
    const a = o.address;
    if (a && typeof a === 'object' && a.streetAddress) {
      addressText = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(', ');
      break;
    }
  }
  if (!addressText) addressText = meta('og:title') || $('title').first().text().trim() || null;

  $('script, style, noscript, svg').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 200000);
  const description = [meta('og:description'), meta('description'), ...ld.map((o) => (typeof o.description === 'string' ? o.description : ''))]
    .filter(Boolean)
    .join(' ')
    .slice(0, 5000);
  const hay = `${description} ${text}`;

  // Units
  let units: number | null = null;
  for (const o of ld) {
    const n = num(o.numberOfUnits ?? o.numberOfAccommodationUnits);
    if (n && n > 0 && n < 1000) {
      units = n;
      break;
    }
  }
  if (!units) {
    const m =
      hay.match(/\b(?:unit count|number of units|total units|# ?of units)\s*:?\s*(\d{1,3})\b/i) ??
      hay.match(/\b(\d{1,3})[- ]?units?\b(?! (?:#|no\.?|number))/i);
    if (m) units = Number(m[1]);
  }
  if (!units) for (const [re, n] of UNIT_WORDS) if (re.test(hay)) { units = n; break; }
  if (units !== null && (units < 1 || units > 500)) units = null;

  // Size and rooms
  let sqft: number | null = null;
  for (const o of ld) {
    const fs = o.floorSize;
    const v = num(typeof fs === 'object' ? fs?.value : fs);
    if (v && v > 200) { sqft = v; break; }
  }
  if (!sqft) {
    const m = hay.match(/([\d,]{3,7})\s*(?:sq\.?\s*ft\.?|sqft|square\s+feet|sf)\b/i);
    const v = num(m?.[1]);
    if (v && v > 200 && v < 2_000_000) sqft = v;
  }
  let totalBeds: number | null = null;
  let totalBaths: number | null = null;
  for (const o of ld) {
    totalBeds ??= num(o.numberOfBedrooms ?? o.numberOfRooms);
    totalBaths ??= num(o.numberOfBathroomsTotal ?? o.numberOfFullBathrooms);
  }
  totalBeds ??= roomCount(hay, /(\d{1,3})\s*(?:bd|beds?|bedrooms?)\b/gi, units);
  totalBaths ??= roomCount(hay, /(\d{1,3}(?:\.\d)?)\s*(?:ba|baths?|bathrooms?)\b/gi, units);

  // Current rent (stated only)
  let monthlyRent: number | null = null;
  let rentBasis: string | null = null;
  const annualRe = /(gross (?:scheduled|annual|potential) (?:rent|rents|income)|annual (?:gross )?(?:rent|rents|rental income|income)|gross scheduled income|gsi|yearly rent)\s*(?:is|of|:)?\s*\$\s*([\d,]{4,9})/i;
  const monthlyRe = /((?:total |current |gross )?monthly (?:rent|rents|rental income|income)|(?:total|current|gross) rents?(?: per month)?|rents? total)\s*(?:is|of|:)?\s*\$\s*([\d,]{3,7})/i;
  const a = hay.match(annualRe);
  const zest = hay.match(/(rent zestimate)\s*(?:®|\(r\))?\s*:?\s*\$\s*([\d,]{3,7})/i);
  const mo = hay.match(monthlyRe) ?? zest;
  if (a && num(a[2])) {
    monthlyRent = num(a[2])! / 12;
    rentBasis = a[0].trim();
  } else if (mo && num(mo[2])) {
    monthlyRent = num(mo[2]);
    rentBasis = mo[0].trim();
  } else {
    // "Unit 1: $850 ... Unit 2: $900" — only when every unit has a stated rent.
    const per = [...hay.matchAll(/\bunit\s*(?:#\s*)?[A-Za-z0-9]{1,3}\b[^$]{0,40}?\$\s*([\d,]{3,5})(?:\s*\/?\s*(?:mo|month))?/gi)]
      .map((m) => num(m[1]))
      .filter((n): n is number => !!n && n >= 200 && n <= 10000);
    if (units && units > 1 && per.length === units) {
      monthlyRent = per.reduce((s, n) => s + n, 0);
      rentBasis = `${units} per-unit rents listed`;
    }
  }

  // Taxes (stated only)
  let annualTaxes: number | null = null;
  const t = hay.match(/(?:annual )?(?:property )?tax(?:es)?(?: amount)?(?: \(\d{4}\))?\s*(?:is|of|:)?\s*\$\s*([\d,]{3,7})(?!\s*\/\s*mo)/i);
  if (t) annualTaxes = num(t[1]);

  // Photos
  const photos = new Set<string>();
  $('meta[property="og:image"]').each((_, el) => {
    const c = $(el).attr('content');
    if (c) photos.add(c);
  });
  for (const o of ld) {
    const img = o.image ?? o.photo;
    for (const i of Array.isArray(img) ? img : [img]) {
      const u = typeof i === 'string' ? i : i?.url ?? i?.contentUrl;
      if (typeof u === 'string' && /^https?:/.test(u)) photos.add(u);
    }
  }

  return {
    url,
    addressText,
    units,
    totalBeds,
    totalBaths,
    sqft,
    monthlyRent,
    rentBasis,
    annualTaxes,
    description,
    photos: [...photos].slice(0, 30),
    text: text.slice(0, 20000),
  };
}

/** True when the listing page plausibly describes the geocoded property. */
export function listingMatchesAddress(facts: ListingFacts, houseNumber: string, streetName: string): boolean {
  if (!houseNumber || !streetName) return false;
  const street = streetName.toLowerCase().split(/\s+/)[0];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const re = new RegExp(`\\b${houseNumber.toLowerCase()}\\s+(?:[nsew]\\.?\\s+|north\\s+|south\\s+|east\\s+|west\\s+)?${street}\\b`);
  return [facts.addressText ?? '', facts.url, facts.text.slice(0, 5000)].some((s) => re.test(norm(s)));
}

// ---------- Safe fetching (no access-control bypassing; blocks private-network targets) ----------

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:');
}

async function assertPublicUrl(u: URL) {
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http(s) links are supported.');
  if (u.username || u.password) throw new Error('Links with credentials are not supported.');
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('That link points to a private network.');
}

export async function fetchListing(rawUrl: string, timeoutMs = 12000): Promise<ListingStatus> {
  let url: URL;
  try {
    url = new URL(rawUrl);
    await assertPublicUrl(url);
  } catch (e: any) {
    return { ok: false, reason: 'invalid_url', detail: e?.message ?? 'Invalid link.' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res: Response | null = null;
    for (let hop = 0; hop < 4; hop++) {
      res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; Dealwise/2.0; +deal screening)',
          accept: 'text/html,application/xhtml+xml',
        },
      });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        url = new URL(loc, url);
        await assertPublicUrl(url);
        continue;
      }
      break;
    }
    if (!res) throw new Error('No response');
    if ([401, 403, 429].includes(res.status) || res.headers.get('x-amzn-waf-action')) {
      return { ok: false, reason: 'blocked', detail: `The listing site refused automated access (HTTP ${res.status}).` };
    }
    if (!res.ok) return { ok: false, reason: 'unreachable', detail: `The listing returned HTTP ${res.status}.` };
    if (!(res.headers.get('content-type') ?? '').includes('html')) {
      return { ok: false, reason: 'not_html', detail: 'The link is not a web page.' };
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4_000_000) break;
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString('utf8');
    if (/captcha|are you a human|access denied|press & hold/i.test(html.slice(0, 20000)) && html.length < 60000) {
      return { ok: false, reason: 'blocked', detail: 'The listing site showed a bot check instead of the listing.' };
    }
    return { ok: true, facts: parseListing(html, url.toString()) };
  } catch (e: any) {
    return { ok: false, reason: 'unreachable', detail: e?.name === 'AbortError' ? 'The listing took too long to load.' : 'Could not load the listing.' };
  } finally {
    clearTimeout(timer);
  }
}
