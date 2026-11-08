import { analyzeDeal, monthlyPayment } from './engine/engine';
import { DEFAULTS, TARGETS, MARKET } from './engine/defaults';
import { checks, solve, type PriceLinks } from './engine/solver';
import type { Check, DealInputs, DealResult, Source, Targets, Unit } from './engine/types';
import type { GeocodedAddress } from './sources/geocode';
import type { FmrResult } from './sources/hud';
import { listingMatchesAddress, type ListingFacts, type ListingStatus } from './sources/listing';
import { analyzeValueAdd, type ValueAdd } from './valueAdd';
import type { TaxRate } from './sources/taxes';
import type { StlParcel } from './sources/stlCity';
import type { ArvEstimate } from './sources/stlComps';
import type { LocalRent } from './rents';
import type { RentEstimate } from './sources/rentcast';

/**
 * All-in model: the student brings an all-in cost (purchase + rehab + closing, from the
 * underwriting spreadsheet). The loan equals the all-in cost, on a 30-year mortgage at prime.
 * Cash flow = rent − (taxes + insurance + utilities + maintenance + vacancy) − mortgage.
 * The listing link is used only for rent (and the unit count / beds needed to apply it).
 */

export interface AssumptionRow {
  key: string;
  label: string;
  value: string;
  source: Source;
  note: string;
}

export interface LoanOption {
  id: 'base' | 'amort25' | 'amort20' | 'shock';
  name: string;
  detail: string;
  monthlyPayment: number;
  monthlyCashFlow: number;
  dscr: number;
}

export interface Analysis {
  address: { input: string; matched: string; county: string };
  allInCost: number;
  verdict: {
    status: 'meets' | 'misses' | 'rent_unknown';
    headline: string;
    confidence: 'high' | 'medium' | 'low';
    confidenceReasons: string[];
  };
  rentKnown: boolean;
  units: number;
  result: DealResult;
  checks: Check[];
  solutions: {
    /** Highest all-in cost (= loan) that meets DSCR 1.20 and $150/unit/month. */
    maxAllIn: number | null;
    /** Total monthly rent needed at this all-in cost. */
    requiredMonthlyRent: number | null;
    /** Cash you would need to put in (reducing the loan) to meet the targets. 0 = none needed. */
    cashNeeded: number | null;
  };
  loan: { amount: number; rate: number; years: number; monthlyPayment: number };
  loanOptions: LoanOption[];
  assumptions: AssumptionRow[];
  listing: { status: 'used' | 'mismatch' | 'failed' | 'none'; detail: string };
  lineSources: Record<string, Source>;
  valueAdd: ValueAdd | null;
  arv: ArvEstimate | null;
  /** Most to spend all-in: 75% of ARV. */
  maxAllInFromArv: number | null;
  arvNote: string | null;
  /** Market rent estimate from nearby rentals, when used. */
  marketRent: { rent: number; low: number; high: number; beds: number | null; comps: RentEstimate['comps'] } | null;
  /** Which tax figure the cash flow uses. */
  taxBasis: 'reassessed' | 'bill' | 'estimate';
  warnings: string[];
}

export interface ResolveArgs {
  inputAddress: string;
  geo: GeocodedAddress;
  allInCost: number;
  listing: ListingStatus | null;
  fmr: FmrResult | null;
  fmrError: string | null;
  taxRate: TaxRate | null;
  /** Official City of St. Louis parcel record, when the address is in the City. */
  parcel?: StlParcel | null;
  /** ARV from comparable sales; the all-in cost is 75% of it. */
  arv?: ArvEstimate | null;
  /** Why there is no ARV, when there isn't one. */
  arvNote?: string | null;
  /** Local St. Louis rent rule of thumb for this area, if covered. */
  localRent?: LocalRent | null;
  /** Building living area (sq ft) from the property record, used to estimate bedrooms. */
  buildingArea?: number | null;
  /** What the student knows about the property, overriding public records when entered. */
  overrides?: { units?: number | null; beds?: number | null; sqft?: number | null };
  /** RentCast rent estimate and property record (single-family only). */
  marketRent?: RentEstimate | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;

export const LOAN_YEARS = 30;
/** All-in cost (purchase + rehab + closing) target: 75% of ARV. */
export const ALL_IN_PCT_OF_ARV = 0.75;
/** Missouri assesses residential property at 19% of market value. */
export const MO_RESIDENTIAL_ASSESSMENT = 0.19;

/** Bedrooms from living area per unit when the record has no bedroom count. */
export function bedsFromArea(sqftPerUnit: number): 1 | 2 | 3 | 4 {
  return sqftPerUnit < 600 ? 1 : sqftPerUnit < 1000 ? 2 : sqftPerUnit < 1500 ? 3 : 4;
}
/** Cash-on-cash has no meaning with 100% financing, so only DSCR and $/unit cash flow are tested. */
const ALL_IN_TARGETS: Targets = { ...TARGETS, minCashOnCash: -Infinity };

export function resolve(a: ResolveArgs): Analysis {
  const rows: AssumptionRow[] = [];
  const warnings: string[] = [];
  const add = (key: string, label: string, value: string, source: Source, note: string) =>
    rows.push({ key, label, value, source, note });
  const allIn = a.allInCost;

  // ---- Listing (rent only): used only if it shows this address ----
  let facts: ListingFacts | null = null;
  let listingStatus: Analysis['listing'] = { status: 'none', detail: 'No listing link provided.' };
  if (a.listing) {
    if (!a.listing.ok) {
      listingStatus = { status: 'failed', detail: a.listing.detail };
      warnings.push(`Listing not used: ${a.listing.detail}`);
    } else if (!listingMatchesAddress(a.listing.facts, a.geo.houseNumber, a.geo.streetName)) {
      listingStatus = { status: 'mismatch', detail: 'The listing page doesn’t show this address, so it wasn’t used.' };
      warnings.push(listingStatus.detail);
    } else {
      facts = a.listing.facts;
      listingStatus = { status: 'used', detail: 'Listing matched this address; used for rent and unit count only.' };
    }
  }

  // ---- Units and beds (needed to apply rent and utilities) ----
  const listedRent = facts?.monthlyRent ?? null;
  const parcel = a.parcel ?? null;
  const ov = a.overrides ?? {};
  let unitCount = ov.units || (parcel?.units ?? facts?.units ?? null);
  let unitsSource: Source = ov.units ? 'user' : parcel?.units ? 'verified' : 'listing';
  let unitsNote = ov.units
    ? parcel?.units && parcel.units !== ov.units
      ? `Entered by you. The property record says ${parcel.units}; confirm with the zoning and occupancy permit.`
      : 'Entered by you.'
    : parcel?.units
      ? `Official property record (parcel ${parcel.parcelId}).`
      : 'Stated in the listing.';
  if (ov.units && parcel?.units && parcel.units !== ov.units) {
    warnings.push(`You entered ${ov.units} unit${ov.units > 1 ? 's' : ''}; the property record says ${parcel.units}. Lenders and appraisers go by the legal unit count, so confirm it.`);
  }
  if (!ov.units && parcel?.units && facts?.units && facts.units !== parcel.units) {
    warnings.push(`The listing says ${facts.units} units but the city record says ${parcel.units}. Using the city record.`);
  }
  if (!unitCount) {
    unitsSource = 'estimate';
    const twoBed = a.fmr?.byBedrooms[2] ?? 0;
    const maxHouse = (a.fmr?.byBedrooms[4] ?? 0) * 1.1;
    if (listedRent && twoBed && listedRent > maxHouse) {
      unitCount = Math.max(2, Math.round(listedRent / twoBed));
      unitsNote = `Not stated. ${money(listedRent)}/mo is more than a house rents for here, so estimated at ${unitCount} units (rent ÷ HUD 2-bed ${money(twoBed)}).`;
      warnings.push(`Unit count not stated. Estimated ${unitCount} units from the rent.`);
    } else {
      unitCount = 1;
      unitsNote = 'Not found in the listing. Assumed single-family (1 unit).';
      warnings.push('Unit count not found. Modeled as single-family. Results change a lot if this is multifamily.');
    }
  }
  add('units', 'Units', String(unitCount), unitsSource, unitsNote);
  const commercial = unitCount >= MARKET.commercialMinUnits || allIn >= MARKET.commercialMinPrice;
  const bedsFromListing = !!facts?.totalBeds && unitsSource === 'listing';
  const area = ov.sqft || a.buildingArea || 0;
  const areaPerUnit = area > 0 ? area / unitCount : 0;
  // RentCast's property record beats a guess from the size (houses; for 2+ units it prices one unit).
  const mr = a.marketRent ?? null;
  const bedsFromMarket = unitCount === 1 && !ov.beds && !bedsFromListing && !!mr?.beds;
  const bedsPerUnit = ov.beds
    ? Math.max(1, Math.min(4, Math.round(ov.beds / unitCount)))
    : bedsFromMarket
    ? Math.min(4, mr!.beds!)
    : bedsFromListing
    ? Math.max(0, Math.min(4, Math.round(facts!.totalBeds! / unitCount)))
    : areaPerUnit
      ? bedsFromArea(areaPerUnit)
      : 2;
  add(
    'beds',
    'Bedrooms per unit',
    String(bedsPerUnit),
    ov.beds ? 'user' : bedsFromListing ? 'listing' : 'estimate',
    bedsFromMarket
      ? `Property record (via RentCast): ${mr!.beds} bed${mr!.baths ? ` / ${mr!.baths} bath` : ''}${mr!.sqft ? `, ${mr!.sqft.toLocaleString('en-US')} sq ft` : ''}.`
      : ov.beds
      ? unitCount > 1
        ? `You entered ${ov.beds} bedrooms ÷ ${unitCount} units.`
        : 'Entered by you.'
      : bedsFromListing
      ? `Listing total (${facts!.totalBeds}) ÷ units.`
      : areaPerUnit
        ? `Estimated from ${Math.round(areaPerUnit).toLocaleString('en-US')} sq ft per unit (${ov.sqft ? 'size you entered' : 'property record'}): under 600 = 1 bed, 600–1,000 = 2, 1,000–1,500 = 3, over 1,500 = 4.`
        : 'No size on record. Assumed 2 bedrooms.',
  );

  // ---- Rent: listing first, then the local St. Louis rule of thumb, then the HUD benchmark ----
  const hudPerUnit = a.fmr ? a.fmr.byBedrooms[bedsPerUnit] : 0;
  const localBeds = Math.min(Math.max(bedsPerUnit, 1), 4) as 1 | 2 | 3 | 4;
  const localPerUnit = a.localRent?.byBedrooms[localBeds] ?? 0;
  let rentPerUnit = 0;
  let rentSource: Source = 'estimate';
  let rentNote = '';
  // Rent estimated from nearby rentals, for the bedroom count it was estimated on.
  const useMarket = !listedRent && !!mr && (!mr.beds || Math.min(4, mr.beds) === bedsPerUnit);
  if (listedRent) {
    rentPerUnit = listedRent / unitCount;
    rentSource = 'listing';
    rentNote = `From the listing: “${facts!.rentBasis}”.${hudPerUnit ? ` HUD benchmark for comparison: ${money(hudPerUnit)}/unit.` : ''}`;
  } else if (useMarket) {
    rentPerUnit = mr!.rent;
    rentSource = 'estimate';
    rentNote = `RentCast estimate${unitCount > 1 ? ` per ${bedsPerUnit}-bed unit` : ''} from ${mr!.comps.length} nearby ${unitCount > 1 ? 'apartment ' : ''}rentals (likely range ${money(mr!.low)}–${money(mr!.high)}).${
      localPerUnit ? ` Rule of thumb for a ${localBeds}-bed here: ${money(localPerUnit)}.` : ''
    }${hudPerUnit ? ` HUD benchmark: ${money(hudPerUnit)}.` : ''}`;
    if (localPerUnit && mr!.rent > localPerUnit * 1.15) {
      warnings.push(`The rent estimate (${money(mr!.rent)}) is well above the local rule of thumb (${money(localPerUnit)}). Check the rental comps before relying on it.`);
    }
  } else if (localPerUnit) {
    rentPerUnit = localPerUnit;
    rentSource = 'default';
    const b = a.localRent!.byBedrooms;
    rentNote = `${mr?.beds ? `The rent estimate on file for this address is for a ${mr.beds}-bed, so it isn’t used for ${bedsPerUnit} bedrooms. ` : ''}${a.localRent!.note}: 1-bed $${b[1]}, 2-bed $${b[2]}, 3-bed $${b[3]}, 4-bed $${b[4]}. General guide; real rental comps are better.${hudPerUnit ? ` HUD benchmark: ${money(hudPerUnit)}.` : ''}`;
  } else if (hudPerUnit) {
    rentPerUnit = hudPerUnit;
    rentNote = `HUD Fair Market Rent ${a.fmr!.year} for a ${bedsPerUnit}-bed${a.fmr!.zipLevel ? ` in ZIP ${a.geo.zip}` : ` in ${a.fmr!.areaName}`}. Conservative (40th percentile); check against rental comps.`;
  }
  const rentKnown = rentPerUnit > 0;
  if (!rentKnown) {
    rentNote = a.fmrError ?? 'No rent source available for this address.';
    warnings.push('No rent data found. See the rent this deal needs below.');
  }
  add('rent', 'Rent per unit', rentKnown ? `${money(rentPerUnit)}/mo` : 'Unknown', rentSource, rentNote);
  const units: Unit[] = Array.from({ length: unitCount }, () => ({
    beds: bedsPerUnit,
    baths: 1,
    sqft: 0,
    currentRent: rentPerUnit,
    marketRent: rentPerUnit,
  }));

  // ---- Expenses: taxes, insurance, utilities, maintenance, vacancy ----
  const taxRate = commercial ? MARKET.taxRateCommercial.value : (a.taxRate?.rate ?? 0.01);
  const taxNote = commercial
    ? MARKET.taxRateCommercial.note
    : a.taxRate
      ? a.taxRate.note
      : 'No local rate available; 1% assumed';
  // After the rehab the property is reassessed: ARV × 19% × this property's own rate (bill ÷ assessed value).
  const billRate = parcel?.annualTax && parcel.assessedTotal ? parcel.annualTax / parcel.assessedTotal : null;
  const reassessed = a.arv && billRate ? a.arv.arv * MO_RESIDENTIAL_ASSESSMENT * billRate : null;
  const useReassessed = !!reassessed && reassessed > (parcel?.annualTax ?? 0);
  const taxBasis: Analysis['taxBasis'] = useReassessed ? 'reassessed' : parcel?.annualTax ? 'bill' : 'estimate';
  const taxes = useReassessed ? reassessed! : (parcel?.annualTax ?? allIn * taxRate);
  const insurance = allIn * DEFAULTS.insurancePctOfCoverage.value;
  const water = unitCount > 1 ? (DEFAULTS.waterSewerTrashPer2Units.value / 2) * unitCount : 0;
  if (useReassessed) {
    add(
      'taxes',
      'Property taxes (after rehab)',
      `${money(taxes)}/yr`,
      'estimate',
      `Reassessed at ARV: ${money(a.arv!.arv)} × 19% × this property’s rate of $${(billRate! * 100).toFixed(2)} per $100 assessed (its ${parcel!.taxYear} bill of ${money(parcel!.annualTax!)} ÷ assessed value ${money(parcel!.assessedTotal!)}). Today’s bill is lower because the house hasn’t been revalued yet.`,
    );
    if (parcel!.abated) warnings.push('This parcel has a tax abatement. Taxes will rise when it ends; check the end date.');
  } else if (parcel?.annualTax) {
    add('taxes', 'Property taxes', `${money(taxes)}/yr`, 'verified', `${parcel.taxYear} tax bill from the City of St. Louis Collector of Revenue (parcel ${parcel.parcelId}).`);
    if (parcel.abated) warnings.push('This parcel has a tax abatement. Taxes will rise when it ends; check the end date.');
  } else {
    add('taxes', 'Property taxes', `${money(taxes)}/yr`, 'estimate', `${taxNote}, applied to the all-in cost.`);
  }
  add('insurance', 'Insurance', `${money(insurance)}/yr`, 'default', 'Insurance ≈ 0.6% of the all-in cost. Get a quote.');
  add(
    'utilities',
    'Utilities',
    unitCount > 1 ? `${money(water)}/mo water, sewer, trash` : '$0 (tenant pays)',
    'default',
    unitCount > 1
      ? '$75/unit/month for water, sewer and trash. Tenants pay electric and gas (separate meters).'
      : 'Single-family: the tenant pays all utilities.',
  );
  add('maintenance', 'Maintenance', pct(DEFAULTS.maintenancePct.value, 1), 'default', DEFAULTS.maintenancePct.note);
  add('vacancy', 'Vacancy', pct(DEFAULTS.vacancyPct.value, 1), 'default', DEFAULTS.vacancyPct.note);

  // ---- Loan: all-in cost, 30 years at prime ----
  const rate = DEFAULTS.interestRate.value;
  const maxAllInFromArv = a.arv ? Math.round(a.arv.arv * ALL_IN_PCT_OF_ARV) : null;
  add('allin', 'All-in cost', money(allIn), 'user', 'Your purchase + rehab + closing, from the underwriting spreadsheet.');
  if (a.arv) {
    add('arv', 'After-repair value (ARV)', money(a.arv.arv), 'estimate', a.arv.method);
    add('maxallin', 'Max all-in (75% of ARV)', money(maxAllInFromArv!), 'estimate', 'All-in cost should be at or under 75% of ARV.');
  }
  add('loan', 'Loan amount', money(allIn), 'user', 'Equal to your all-in cost (100% financed).');
  add('rate', 'Interest rate', pct(rate, 1), 'default', DEFAULTS.interestRate.note);
  add('term', 'Loan term', `${LOAN_YEARS} years`, 'default', '30-year mortgage.');

  const owner = { lawnSnow: 0, waterSewerTrash: water, electricGas: 0 };
  const base: DealInputs = {
    purchasePrice: allIn,
    closingCosts: 0,
    downPaymentPct: 0,
    interestRate: rate,
    amortYears: LOAN_YEARS,
    rehabCost: 0,
    rehabOutOfPocketPct: 1,
    arv: a.arv?.arv ?? allIn,
    units,
    vacancyPct: DEFAULTS.vacancyPct.value,
    taxesCurrent: taxes,
    taxesStabilized: taxes,
    insurance,
    managementPct: 0,
    maintenancePct: DEFAULTS.maintenancePct.value,
    current: owner,
    stabilized: owner,
    buildingValueRatio: DEFAULTS.buildingValueRatio.value,
    marginalTaxRate: DEFAULTS.marginalTaxRate.value,
    appreciationPct: DEFAULTS.appreciationPct.value,
    holdYears: 1,
  };

  const result = analyzeDeal(base);
  const s = result.stabilized;
  const links: PriceLinks = {
    closingCostPct: 0,
    stabilizedTaxRateOnPrice: parcel?.annualTax ? null : taxRate,
    insurancePctOfCoverage: DEFAULTS.insurancePctOfCoverage.value,
    taxBump: parcel?.annualTax ? 0 : -1, // a real tax bill stays fixed; an estimate scales with the all-in cost
  };
  const sol = solve(base, links, ALL_IN_TARGETS);
  const c = checks(result, ALL_IN_TARGETS)
    .filter((x) => x.id === 'dscr' || x.id === 'cashflow' || (x.id === 'rule75' && !!a.arv))
    .map((x) => (x.id === 'rule75' ? { ...x, label: 'All-in ÷ ARV (75% rule)' } : x));

  // ---- Loan options at this amount ----
  const opt = (id: LoanOption['id'], name: string, years: number, r: number): LoanOption => {
    const pmt = monthlyPayment(allIn, r, years);
    return { id, name, detail: `${(r * 100).toFixed(1)}% · ${years} years`, monthlyPayment: pmt, monthlyCashFlow: s.noi / 12 - pmt, dscr: s.noi / (pmt * 12) };
  };
  const loanOptions = [
    opt('base', '30-year mortgage', 30, rate),
    opt('amort25', '25-year amortization', 25, rate),
    opt('amort20', '20-year amortization', 20, rate),
    opt('shock', 'If rates are 1% higher', 30, rate + 0.01),
  ];

  // ---- Verdict ----
  const reasons: string[] = [];
  let score = 0;
  if (unitsSource !== 'estimate') score++; else reasons.push('Unit count assumed');
  if (listedRent) score++; else reasons.push(!rentKnown ? 'No rent data' : localPerUnit ? 'Rent is a local rule of thumb, not a rental comp' : 'Rent is a HUD benchmark, not a rental comp');
  if (bedsFromListing) score++; else reasons.push('Bedrooms assumed');
  const confidence = score === 3 ? 'high' : score === 2 ? 'medium' : 'low';
  const status: Analysis['verdict']['status'] = !rentKnown ? 'rent_unknown' : c.every((x) => x.pass) ? 'meets' : 'misses';
  const headline =
    status === 'rent_unknown'
      ? 'Rent data unavailable. Here’s the rent this deal needs.'
      : status === 'meets'
        ? `Cash flows ${money(s.cashFlow / 12)}/mo after expenses and the mortgage`
        : s.cashFlow < 0
          ? `Loses ${money(-s.cashFlow / 12)}/mo after expenses and the mortgage`
          : `Cash flows ${money(s.cashFlow / 12)}/mo, below target`;

  const cashNeeded =
    sol.requiredDownPct === null ? null : Math.max(0, (sol.requiredDownCash ?? 0));

  return {
    address: { input: a.inputAddress, matched: a.geo.matchedAddress, county: a.geo.countyName },
    allInCost: allIn,
    verdict: { status, headline, confidence, confidenceReasons: reasons },
    rentKnown,
    units: unitCount,
    result,
    checks: c,
    solutions: { maxAllIn: sol.maxPrice, requiredMonthlyRent: sol.requiredMonthlyRent, cashNeeded },
    loan: { amount: allIn, rate, years: LOAN_YEARS, monthlyPayment: result.acquisition.monthlyPayment },
    loanOptions,
    assumptions: rows,
    listing: listingStatus,
    lineSources: { rent: rentSource, taxes: taxBasis === 'bill' ? 'verified' : 'estimate', insurance: 'default', utilities: 'default', maintenance: 'default', vacancy: 'default', loan: 'default' },
    valueAdd: rentKnown ? analyzeValueAdd(base, result, DEFAULTS.incomeCapRate.value) : null,
    arv: a.arv ?? null,
    maxAllInFromArv,
    arvNote: a.arv ? null : (a.arvNote ?? null),
    marketRent: useMarket ? { rent: mr!.rent, low: mr!.low, high: mr!.high, beds: mr!.beds, comps: mr!.comps } : null,
    taxBasis,
    warnings,
  };
}
