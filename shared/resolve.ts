import { analyzeDeal } from './engine/engine';
import { DEFAULTS, TARGETS, MARKET } from './engine/defaults';
import { checks, solve, type PriceLinks, type Solutions } from './engine/solver';
import type { Check, DealInputs, DealResult, Source, Unit } from './engine/types';
import type { GeocodedAddress } from './sources/geocode';
import type { FmrResult } from './sources/hud';
import { listingMatchesAddress, type ListingFacts, type ListingStatus } from './sources/listing';
import { estimateRehab, type RehabEstimate } from './sources/rehab';
import { analyzeFinancing, type FinancingAnalysis } from './financing';
import { analyzeValueAdd, type ValueAdd } from './valueAdd';
import type { TaxRate } from './sources/taxes';

export interface AssumptionRow {
  key: string;
  label: string;
  value: string;
  source: Source;
  note: string;
}

export interface Analysis {
  address: { input: string; matched: string; county: string };
  purchasePrice: number;
  verdict: {
    status: 'meets' | 'misses' | 'rent_unknown';
    headline: string;
    confidence: 'high' | 'medium' | 'low';
    confidenceReasons: string[];
  };
  rentKnown: boolean;
  result: DealResult;
  checks: Check[];
  solutions: Solutions;
  rehab: RehabEstimate;
  assumptions: AssumptionRow[];
  listing: { status: 'used' | 'mismatch' | 'failed' | 'none'; detail: string; photos: string[] };
  /** Source of the inputs behind each operating-statement line, for row tags. */
  lineSources: Record<string, Source>;
  financing: FinancingAnalysis;
  valueAdd: ValueAdd | null;
  warnings: string[];
}

export interface ResolveArgs {
  inputAddress: string;
  geo: GeocodedAddress;
  purchasePrice: number;
  listing: ListingStatus | null;
  fmr: FmrResult | null;
  fmrError: string | null;
  taxRate: TaxRate | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

/** Typical unit size when the listing doesn't state square footage. */
const SQFT_BY_BEDS = [500, 700, 900, 1200, 1500];

export function resolve(a: ResolveArgs): Analysis {
  const rows: AssumptionRow[] = [];
  const warnings: string[] = [];
  const add = (key: string, label: string, value: string, source: Source, note: string) =>
    rows.push({ key, label, value, source, note });

  // ---- Listing: only used if it matches the geocoded property ----
  let facts: ListingFacts | null = null;
  let listingStatus: Analysis['listing'] = { status: 'none', detail: 'No listing link provided.', photos: [] };
  if (a.listing) {
    if (!a.listing.ok) {
      listingStatus = { status: 'failed', detail: a.listing.detail, photos: [] };
      warnings.push(`Listing not used: ${a.listing.detail}`);
    } else if (!listingMatchesAddress(a.listing.facts, a.geo.houseNumber, a.geo.streetName)) {
      listingStatus = {
        status: 'mismatch',
        detail: 'The listing page doesn’t show this address, so its facts and photos were not used.',
        photos: [],
      };
      warnings.push(listingStatus.detail);
    } else {
      facts = a.listing.facts;
      listingStatus = { status: 'used', detail: 'Listing matched this address.', photos: facts.photos.slice(0, 6) };
    }
  }

  // ---- Unit mix ----
  const price = a.purchasePrice;
  const listedRent = facts?.monthlyRent ?? null;
  let unitCount = facts?.units ?? null;
  let unitsSource: Source = 'listing';
  let unitsNote = 'Stated in the listing.';
  if (!unitCount) {
    unitsSource = 'estimate';
    const twoBed = a.fmr?.byBedrooms[2] ?? 0;
    const maxHouse = (a.fmr?.byBedrooms[4] ?? 0) * 1.1;
    if (listedRent && twoBed && listedRent > maxHouse) {
      // More rent than a single house earns here: estimate units at the area's 2-bed rent.
      unitCount = Math.max(2, Math.round(listedRent / twoBed));
      unitsNote = `Not stated. The listing’s ${money(listedRent)}/mo is more than a house rents for here, so estimated at ${unitCount} units (rent ÷ HUD 2-bed ${money(twoBed)}).`;
      warnings.push(`Unit count not stated. Estimated ${unitCount} units from the rent. Check the listing and adjust your read of the results.`);
    } else {
      unitCount = 1;
      unitsNote = 'Not found in the listing. Assumed 1 unit.';
      warnings.push('Unit count not found. Modeled as 1 unit. Results change a lot if this is multifamily.');
    }
  }
  add('units', 'Units', String(unitCount), unitsSource, unitsNote);
  const commercial = unitCount >= MARKET.commercialMinUnits || price >= MARKET.commercialMinPrice;

  const bedsPerUnit = facts?.totalBeds && unitsSource === 'listing' ? Math.max(0, Math.min(4, Math.round(facts.totalBeds / unitCount))) : 2;
  const bedsSource: Source = facts?.totalBeds ? 'listing' : 'estimate';
  const bathsPerUnit = facts?.totalBaths ? Math.max(1, Math.round((facts.totalBaths / unitCount) * 2) / 2) : 1;
  add(
    'beds',
    'Bedrooms per unit',
    String(bedsPerUnit),
    bedsSource,
    bedsSource === 'listing' ? `Listing total (${facts!.totalBeds}) ÷ units.` : 'Not stated. Assumed 2 bedrooms (a typical rental unit).',
  );

  const sqftTotal = facts?.sqft ?? SQFT_BY_BEDS[bedsPerUnit] * unitCount;
  const sqftSource: Source = facts?.sqft ? 'listing' : 'estimate';
  add(
    'sqft',
    'Building size',
    `${Math.round(sqftTotal).toLocaleString('en-US')} sq ft`,
    sqftSource,
    sqftSource === 'listing' ? 'Stated in the listing.' : `Not stated. Typical ${bedsPerUnit}-bed unit size × units.`,
  );

  // ---- Rents ----
  const hudPerUnit = a.fmr ? a.fmr.byBedrooms[bedsPerUnit] : 0;
  const hudLabel = a.fmr
    ? `HUD Fair Market Rent ${a.fmr.year} for a ${bedsPerUnit}-bed${a.fmr.zipLevel ? ` in ZIP ${a.geo.zip}` : ` in ${a.fmr.areaName}`}`
    : '';
  let marketPerUnit = 0;
  let marketSource: Source = 'estimate';
  let marketNote = '';
  if (listedRent) {
    const uplifted = (listedRent / unitCount) * (1 + MARKET.rentUplift.value);
    marketPerUnit = Math.max(uplifted, hudPerUnit);
    marketNote =
      hudPerUnit > uplifted
        ? `${hudLabel}: ${money(hudPerUnit)}. Current rent is below it, so a renovated unit is assumed to reach it.`
        : `Current rent + 7%. ${MARKET.rentUplift.note}${hudPerUnit ? ` ${hudLabel}: ${money(hudPerUnit)}.` : ''}`;
  } else if (hudPerUnit) {
    marketPerUnit = hudPerUnit;
    marketNote = `${hudLabel}. HUD sets this at the 40th percentile, including utilities, so it runs conservative.`;
  }
  const rentKnown = marketPerUnit > 0;
  if (!rentKnown) {
    marketNote = a.fmrError ?? 'No rent source available for this address.';
    warnings.push('No rent data found. Income-based results are blank; see the rent needed to hit targets.');
  }
  add('marketRent', 'Stabilized rent per unit', rentKnown ? `${money(marketPerUnit)}/mo` : 'Unknown', marketSource, marketNote);

  const currentPerUnit = listedRent ? listedRent / unitCount : marketPerUnit;
  const currentSource: Source = listedRent ? 'listing' : 'estimate';
  add(
    'currentRent',
    'Current rent per unit',
    currentPerUnit > 0 ? `${money(currentPerUnit)}/mo` : 'Unknown',
    currentSource,
    listedRent ? `From the listing: “${facts!.rentBasis}”.` : 'No current rent in the listing. Current column assumes stabilized rent.',
  );

  const units: Unit[] = Array.from({ length: unitCount }, () => ({
    beds: bedsPerUnit,
    baths: bathsPerUnit,
    sqft: sqftTotal / unitCount,
    currentRent: currentPerUnit,
    marketRent: marketPerUnit,
  }));

  // ---- Rehab ----
  const rehab = estimateRehab(`${facts?.description ?? ''} ${facts?.text ?? ''}`, sqftTotal, { occupied: !!listedRent });
  add(
    'rehab',
    'Rehab budget',
    `${money(rehab.cost)} (range ${money(rehab.low)}–${money(rehab.high)})`,
    rehab.scope === 'unknown' ? 'default' : 'estimate',
    rehab.matched ? `${rehab.note} Listing says: “${rehab.matched}”.` : rehab.note,
  );

  // ---- Taxes ----
  const rate = commercial ? MARKET.taxRateCommercial.value : (a.taxRate?.rate ?? null);
  const rateNote = commercial ? MARKET.taxRateCommercial.note : (a.taxRate?.note ?? '');
  let taxesCurrent: number;
  let taxSource: Source;
  let taxNote: string;
  if (facts?.annualTaxes) {
    taxesCurrent = facts.annualTaxes;
    taxSource = 'listing';
    taxNote = 'Stated in the listing (not verified against the tax record).';
  } else if (rate) {
    taxesCurrent = price * rate;
    taxSource = 'estimate';
    taxNote = `${rateNote} × purchase price.`;
  } else {
    taxesCurrent = price * 0.01;
    taxSource = 'estimate';
    taxNote = 'No tax data. Assumed 1% of purchase price.';
  }
  const taxRateOnPrice = rate ?? 0.01;
  const taxesStabilized = Math.max(taxesCurrent * (1 + DEFAULTS.taxBumpOnPurchase.value), price * taxRateOnPrice);
  add('taxesCurrent', 'Property taxes (current)', `${money(taxesCurrent)}/yr`, taxSource, taxNote);
  add(
    'taxesStabilized',
    'Property taxes (after purchase)',
    `${money(taxesStabilized)}/yr`,
    'estimate',
    `Higher of current +10% or purchase price × ${pct(taxRateOnPrice, 2)}. A historical bill is not a forecast.`,
  );

  // ---- Financing and the remaining defaults ----
  const loan = commercial ? MARKET.commercialLoan : MARKET.smallLoan;
  const mgmt = commercial ? MARKET.managementCommercial : DEFAULTS.managementPct;
  const insurance = (price + rehab.cost) * DEFAULTS.insurancePctOfCoverage.value;
  const owner =
    unitCount > 1
      ? {
          lawnSnow: DEFAULTS.lawnSnowMonthly.value,
          waterSewerTrash: (DEFAULTS.waterSewerTrashPer2Units.value / 2) * unitCount,
          electricGas: 0,
        }
      : { lawnSnow: 0, waterSewerTrash: 0, electricGas: 0 };

  add('down', 'Down payment', pct(loan.down, 0), 'default', loan.note);
  add('rate', 'Interest rate', pct(DEFAULTS.interestRate.value, 1), 'default', DEFAULTS.interestRate.note);
  add('amort', 'Amortization', `${loan.amortYears} years`, 'default', loan.note);
  add('closing', 'Closing costs', money(price * DEFAULTS.closingCostPct.value), 'default', DEFAULTS.closingCostPct.note);
  add('vacancy', 'Vacancy', pct(DEFAULTS.vacancyPct.value, 0), 'default', DEFAULTS.vacancyPct.note);
  add('maintenance', 'Maintenance', pct(DEFAULTS.maintenancePct.value, 0), 'default', DEFAULTS.maintenancePct.note);
  add('management', 'Management', pct(mgmt.value, 0), 'default', mgmt.note);
  add('insurance', 'Insurance', `${money(insurance)}/yr`, 'default', DEFAULTS.insurancePctOfCoverage.note);
  add(
    'utilities',
    'Owner-paid utilities',
    unitCount > 1 ? `${money(owner.waterSewerTrash)}/mo water, sewer, trash · ${money(owner.lawnSnow)}/mo lawn & snow` : '$0 (tenant pays)',
    'default',
    unitCount > 1
      ? `${DEFAULTS.waterSewerTrashPer2Units.note} Closed St. Louis multifamily deals ran 7–10% of gross rent, which this matches. Tenants pay electric and gas.`
      : 'On a single-family, the tenant pays all utilities and lawn care.',
  );

  const base: DealInputs = {
    purchasePrice: price,
    closingCosts: price * DEFAULTS.closingCostPct.value,
    downPaymentPct: loan.down,
    interestRate: DEFAULTS.interestRate.value,
    amortYears: loan.amortYears,
    rehabCost: rehab.cost,
    rehabOutOfPocketPct: commercial ? MARKET.commercialLoan.rehabCashPct : DEFAULTS.rehabOutOfPocketPct.value,
    arv: 0,
    units,
    vacancyPct: DEFAULTS.vacancyPct.value,
    taxesCurrent,
    taxesStabilized,
    insurance,
    managementPct: mgmt.value,
    maintenancePct: DEFAULTS.maintenancePct.value,
    current: owner,
    stabilized: owner,
    buildingValueRatio: DEFAULTS.buildingValueRatio.value,
    marginalTaxRate: DEFAULTS.marginalTaxRate.value,
    appreciationPct: DEFAULTS.appreciationPct.value,
    holdYears: DEFAULTS.holdYears.value,
  };

  // ---- ARV (income approach; no free sales comps) ----
  const allIn = price + base.closingCosts + rehab.cost;
  let arv: number;
  if (rentKnown) {
    const stabNoi = analyzeDeal({ ...base, arv: allIn }).stabilized.noi;
    arv = Math.max(0, Math.round(stabNoi / DEFAULTS.incomeCapRate.value / 1000) * 1000);
    add(
      'arv',
      'After-repair value',
      money(arv),
      'estimate',
      `Income approach: stabilized NOI ÷ ${pct(DEFAULTS.incomeCapRate.value, 0)} cap rate. ${DEFAULTS.incomeCapRate.note}${
        unitCount <= 4 ? ' Lenders value 1–4 unit properties by sales comps, so treat this as a rough check.' : ''
      }`,
    );
  } else {
    arv = allIn;
    add('arv', 'After-repair value', money(arv), 'estimate', 'Rent unknown, so ARV can’t be estimated. Set to all-in cost (no forced appreciation).');
  }
  base.arv = arv;

  add('bvr', 'Building share of value', pct(DEFAULTS.buildingValueRatio.value, 0), 'default', DEFAULTS.buildingValueRatio.note);
  add('taxRate', 'Your tax bracket', pct(DEFAULTS.marginalTaxRate.value, 0), 'default', DEFAULTS.marginalTaxRate.note);
  add('appreciation', 'Appreciation', `${pct(DEFAULTS.appreciationPct.value, 0)}/yr`, 'default', DEFAULTS.appreciationPct.note);

  // ---- Run ----
  const result = analyzeDeal(base);
  const links: PriceLinks = {
    closingCostPct: DEFAULTS.closingCostPct.value,
    stabilizedTaxRateOnPrice: taxRateOnPrice,
    insurancePctOfCoverage: DEFAULTS.insurancePctOfCoverage.value,
    taxBump: DEFAULTS.taxBumpOnPurchase.value,
  };
  const solutions = solve(base, links, TARGETS);
  const c = checks(result, TARGETS);

  if (result.stabilized.expenseRatio < 0.3 && rentKnown) {
    warnings.push(`Expense ratio is ${pct(result.stabilized.expenseRatio)}. Under 30% probably isn’t conservative enough.`);
  }

  // ---- Confidence ----
  const reasons: string[] = [];
  let score = 0;
  if (unitsSource === 'listing') score++; else reasons.push('Unit count assumed');
  if (listedRent) score++; else reasons.push(rentKnown ? 'Rent is a HUD benchmark, not actual rent' : 'No rent data');
  if (sqftSource === 'listing') score++; else reasons.push('Size estimated');
  if (taxSource !== 'estimate') score++; else reasons.push('Taxes estimated');
  if (rehab.scope !== 'unknown') score++; else reasons.push('Condition unknown');
  const confidence = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  const operating = c.filter((x) => ['dscr', 'cashflow', 'coc'].includes(x.id));
  const status: Analysis['verdict']['status'] = !rentKnown ? 'rent_unknown' : operating.every((x) => x.pass) ? 'meets' : 'misses';
  const headline =
    status === 'rent_unknown'
      ? 'Rent data unavailable. Here’s the rent this deal needs.'
      : status === 'meets'
        ? 'Meets all three cash-flow targets'
        : `Below target on ${operating.filter((x) => !x.pass).length} of ${operating.length} cash-flow tests`;

  const lineSources: Record<string, Source> = {
    gpiCurrent: currentSource,
    gpiStabilized: marketSource,
    vacancy: 'default',
    taxesCurrent: taxSource,
    taxesStabilized: 'estimate',
    insurance: 'default',
    management: 'default',
    maintenance: 'default',
    utilities: 'default',
    rehab: rehab.scope === 'unknown' ? 'default' : 'estimate',
    arv: 'estimate',
    financing: 'default',
    purchasePrice: 'user',
  };

  return {
    address: { input: a.inputAddress, matched: a.geo.matchedAddress, county: a.geo.countyName },
    purchasePrice: price,
    verdict: { status, headline, confidence, confidenceReasons: reasons },
    rentKnown,
    result,
    checks: c,
    solutions,
    rehab,
    assumptions: rows,
    listing: listingStatus,
    lineSources,
    financing: analyzeFinancing(base, result, commercial),
    valueAdd: rentKnown ? analyzeValueAdd(base, result, DEFAULTS.incomeCapRate.value) : null,
    warnings,
  };
}
