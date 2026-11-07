/**
 * HUD Fair Market Rents (official, free with a HUD USER token).
 * FMRs are the 40th-percentile gross rent (rent + tenant utilities) for standard-quality units,
 * so they are a deliberately conservative market-rent benchmark — not a rent comp.
 * Where HUD publishes Small Area FMRs, the ZIP-level figure is used.
 */
export interface FmrResult {
  byBedrooms: [number, number, number, number, number]; // 0..4 bedrooms
  areaName: string;
  year: string;
  zipLevel: boolean;
}

const cache = new Map<string, { at: number; value: FmrResult | null }>();
const DAY = 24 * 60 * 60 * 1000;

export function parseFmr(data: any, zip: string): FmrResult | null {
  const d = data?.data;
  if (!d) return null;
  const pick = (row: any) =>
    ['Efficiency', 'One-Bedroom', 'Two-Bedroom', 'Three-Bedroom', 'Four-Bedroom'].map((k) => Number(row?.[k])) as FmrResult['byBedrooms'];
  const valid = (v: number[]) => v.every((x) => Number.isFinite(x) && x > 0);
  let row: any = null;
  let zipLevel = false;
  if (Array.isArray(d.basicdata)) {
    row = d.basicdata.find((r: any) => String(r.zip_code) === zip);
    if (row) zipLevel = true;
    else row = d.basicdata.find((r: any) => String(r.zip_code).toLowerCase() === 'msa level') ?? null;
  } else {
    row = d.basicdata;
  }
  if (!row) return null;
  const byBedrooms = pick(row);
  if (!valid(byBedrooms)) return null;
  return {
    byBedrooms,
    areaName: String(d.area_name ?? d.metro_name ?? d.county_name ?? ''),
    year: String(d.year ?? row.year ?? ''),
    zipLevel,
  };
}

/**
 * HUD's public ArcGIS Fair Market Rent layer (no token). Metro/county FMR area containing the point.
 * Dataset last updated by HUD on 2025-09-30 (FY2026 FMRs).
 */
export async function fetchFmrArcgis(lat: number, lon: number, signal?: AbortSignal): Promise<FmrResult | null> {
  const key = `arcgis:${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  const url = new URL(
    'https://services.arcgis.com/VTyQ9soqVukalItT/ArcGIS/rest/services/Fair_Market_Rents/FeatureServer/0/query',
  );
  url.searchParams.set('geometry', `${lon},${lat}`);
  url.searchParams.set('geometryType', 'esriGeometryPoint');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'FMR_AREANAME,FMR_0BDR,FMR_1BDR,FMR_2BDR,FMR_3BDR,FMR_4BDR');
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('f', 'json');
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HUD FMR map service returned ${res.status}`);
  const value = parseFmrArcgis(await res.json());
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function parseFmrArcgis(data: any): FmrResult | null {
  const a = data?.features?.[0]?.attributes;
  if (!a) return null;
  const byBedrooms = [a.FMR_0BDR, a.FMR_1BDR, a.FMR_2BDR, a.FMR_3BDR, a.FMR_4BDR].map(Number) as FmrResult['byBedrooms'];
  if (!byBedrooms.every((x) => Number.isFinite(x) && x > 0)) return null;
  return { byBedrooms, areaName: String(a.FMR_AREANAME ?? ''), year: 'FY2026', zipLevel: false };
}

/** Best available: ZIP-level HUD API when a token is configured, otherwise HUD's public map service. */
export async function getFmr(geo: { stateFips: string; countyFips: string; zip: string; lat: number; lon: number }, signal?: AbortSignal) {
  if (process.env.HUD_API_TOKEN) {
    try {
      const v = await fetchFmr(geo.stateFips, geo.countyFips, geo.zip, signal);
      if (v) return v;
    } catch {
      /* fall back to the public layer */
    }
  }
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) return null;
  return fetchFmrArcgis(geo.lat, geo.lon, signal);
}

export async function fetchFmr(stateFips: string, countyFips: string, zip: string, signal?: AbortSignal) {
  const entity = `${stateFips}${countyFips}99999`;
  const key = `${entity}:${zip}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < DAY) return hit.value;
  const token = process.env.HUD_API_TOKEN ?? 'unset';
  const res = await fetch(`https://www.huduser.gov/hudapi/public/fmr/data/${entity}`, {
    signal,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (res.status === 401 || res.status === 403) throw new HudAuthError();
  if (!res.ok) throw new Error(`HUD FMR returned ${res.status}`);
  const value = parseFmr(await res.json(), zip);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export class HudAuthError extends Error {
  constructor() {
    super('HUD rent data needs a HUD USER API token (HUD_API_TOKEN).');
  }
}
