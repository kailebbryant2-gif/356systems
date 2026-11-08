import { DEFAULTS } from '../engine/defaults';

export type RehabScope = 'renovated' | 'cosmetic' | 'substantial' | 'gut' | 'unknown';

const RENOVATED = /\b(fully|completely|newly|totally|recently|beautifully|gut)[- ](renovated|rehabbed|remodeled|updated)\b|\bturn[- ]?key\b|\bmove[- ]in ready\b|\bupdated throughout\b|\bnew everything\b/i;
const GUT = /\b(full|complete|total|needs (a )?(full )?gut)[- ]?(gut|rehab)\b|\bshell\b|\bfire[- ]damage(d)?\b|\bcondemned\b|\bdown to the studs\b|\bneeds everything\b|\bno (mechanicals|utilities)\b/i;
const SUBSTANTIAL = /\bneeds? (work|rehab|repairs?|updating|tlc|a lot)\b|\bfixer([- ]upper)?\b|\bhandyman special\b|\binvestor special\b|\bbring your (contractor|hammer)\b|\brehab opportunity\b|\btlc\b|\bsold as[- ]is\b/i;
const COSMETIC = /\bcosmetic\b|\bdated\b|\boutdated\b|\bneeds (paint|carpet|flooring|cosmetics)\b|\blight rehab\b|\bsome updating\b/i;

export interface RehabEstimate {
  scope: RehabScope;
  perSqft: number; // $/sqft used for the base case
  low: number;
  high: number;
  cost: number;
  matched: string | null; // the phrase that drove the scope
  note: string;
}

/**
 * Keyword screen of the listing's own words, mapped onto standard rehab bands
 * ($30 cosmetic / $50 cosmetic + electrical & plumbing / $75 gut).
 * This is a screening estimate, not a bid or an inspection.
 */
export function estimateRehab(listingText: string, sqft: number, opts: { occupied?: boolean } = {}): RehabEstimate {
  const t = listingText.slice(0, 20000);
  const hit = (re: RegExp) => t.match(re)?.[0] ?? null;
  const gut = hit(GUT);
  const sub = hit(SUBSTANTIAL);
  const cos = hit(COSMETIC);
  const ren = hit(RENOVATED);
  const b = DEFAULTS.rehabPerSqft;

  let scope: RehabScope;
  let matched: string | null;
  if (gut && !/gut[- ](renovated|rehabbed)/i.test(gut)) [scope, matched] = ['gut', gut];
  else if (sub) [scope, matched] = ['substantial', sub];
  else if (ren) [scope, matched] = ['renovated', ren];
  else if (cos) [scope, matched] = ['cosmetic', cos];
  else [scope, matched] = ['unknown', null];

  const band: Record<RehabScope, [number, number, number]> = {
    renovated: [b.renovated, 0, b.cosmetic],
    cosmetic: [b.cosmetic, b.cosmetic, b.substantial],
    substantial: [b.substantial, b.cosmetic, b.gut],
    gut: [b.gut, b.substantial, b.gut],
    unknown: opts.occupied ? [0, 0, b.cosmetic] : [b.substantial, b.cosmetic, b.gut],
  };
  const [perSqft, lo, hi] = band[scope];
  const notes: Record<RehabScope, string> = {
    renovated: 'Listing describes the property as renovated, so no rehab is modeled. Verify at inspection.',
    cosmetic: 'Listing language suggests cosmetic work: $30/sq ft.',
    substantial: 'Listing language suggests substantial work: $50/sq ft (cosmetic plus electrical/plumbing; not proof of those issues).',
    gut: 'Listing language suggests a gut rehab: $75/sq ft.',
    unknown: opts.occupied
      ? 'Rent-producing building and the listing doesn’t describe any needed work, so no rehab is modeled. Range shown up to the $30/sq ft cosmetic band; confirm at inspection.'
      : 'Condition not stated in the listing: middle band ($50/sq ft) with a $30–$75 range.',
  };
  return {
    scope,
    perSqft,
    low: lo * sqft,
    high: hi * sqft,
    cost: perSqft * sqft,
    matched,
    note: notes[scope],
  };
}
