/**
 * City of St. Louis Address & Property Search (official public record, no key).
 * Submits the site's own address form the way a browser does, then reads the parcel page.
 * Only facts used by the analyzer are kept; owner names are never extracted.
 */
export interface StlParcel {
  parcelId: string | null;
  units: number | null;
  annualTax: number | null; // most recent tax year total
  taxYear: number | null;
  assessedTotal: number | null;
  appraisedTotal: number | null;
  abated: boolean;
  zoning: string | null;
  yearBuilt: number | null;
}

const BASE = 'https://www.stlouis-mo.gov/data/address-search/index.cfm';
const UA = 'Mozilla/5.0 (compatible; Dealwise/2.0; property tax lookup)';

const num = (s: string | undefined) => {
  if (!s) return null;
  const n = Number(s.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Pure parser over the parcel page's visible text. */
export function parseStlParcel(text: string): StlParcel | null {
  if (!/Parcel ID/i.test(text)) return null;
  const parcelId = text.match(/Parcel ID\s+([\d.\-]+)/i)?.[1] ?? null;
  const units = num(text.match(/Number of units\s+([\d.]+)/i)?.[1]);
  // Tax summary rows: "2025 $0.00 $28.00 $0.00 $2,297.48 $2,297.48 $0.00" → total original tax is the 4th amount.
  let annualTax: number | null = null;
  let taxYear: number | null = null;
  const summary = text.slice(text.search(/Real Estate Tax Summary/i));
  const row = summary.match(/\b(20\d\d)\s+\$[\d,.]+\s+\$[\d,.]+\s+\$[\d,.]+\s+\$([\d,.]+)/);
  if (row) {
    taxYear = Number(row[1]);
    annualTax = num(row[2]);
  }
  return {
    parcelId,
    units: units && units >= 1 ? Math.round(units) : null,
    annualTax: annualTax && annualTax > 0 ? annualTax : null,
    taxYear,
    assessedTotal: num(text.match(/Assessed total\s+\$([\d,.]+)/i)?.[1]),
    appraisedTotal: num(text.match(/Appraised total\s+\$([\d,.]+)/i)?.[1]),
    abated: /Tax Abatement\s+(?!This property is not abated)/i.test(text) && !/This property is not abated/i.test(text),
    zoning: text.match(/Zoning\s+([A-Z] - [A-Za-z ]+?Residential|[A-Z] - [A-Za-z ]+?)(?:\s+Redevelopment|\s+Vacant)/)?.[1]?.trim() ?? null,
    yearBuilt: num(text.match(/Year built\s+(\d{4})/i)?.[1]),
  };
}

function cookieJar() {
  const jar = new Map<string, string>();
  return {
    take(res: Response) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
    header: () => [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
  };
}

/** Street line only, e.g. "3520 WYOMING ST". */
export async function fetchStlParcel(street: string, signal?: AbortSignal): Promise<StlParcel | null> {
  const jar = cookieJar();
  const page = await fetch(BASE, { signal, headers: { 'user-agent': UA } });
  jar.take(page);
  const html = await page.text();
  const form = html.slice(html.indexOf('name="streetForm"'));
  const token = form.match(/name="__ncforminfo" value="([^"]+)"/)?.[1];
  if (!token) return null;
  const body = new URLSearchParams({
    streetAddress: street,
    RealEstatePropertyInfor: 'RealEstatePropertyInfor',
    findByAddress: 'Find address',
    __ncforminfo: token,
  });
  const post = await fetch(BASE, {
    method: 'POST',
    redirect: 'manual',
    signal,
    headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body,
  });
  jar.take(post);
  const loc = post.headers.get('location');
  if (!loc || !/parcelId=/i.test(loc)) return null; // no exact match
  const url = new URL(loc.replace(/&amp;/g, '&'), BASE);
  const result = await fetch(url, { signal, headers: { 'user-agent': UA, cookie: jar.header() } });
  if (!result.ok) return null;
  return parseStlParcel(htmlToText(await result.text()));
}
