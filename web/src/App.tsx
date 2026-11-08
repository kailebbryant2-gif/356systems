import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Analysis } from '../../shared/resolve';
import type { Source } from '../../shared/engine/types';
import { money, pct, ratio } from './format';

const SOURCE_LABEL: Record<Source, string> = {
  user: 'You',
  verified: 'Verified',
  listing: 'Listing',
  estimate: 'Estimate',
  default: 'Assumption',
};

function Tag({ source }: { source: Source }) {
  return <span className={`tag tag-${source}`}>{SOURCE_LABEL[source]}</span>;
}

// ---------------- Icons ----------------

const Icon = ({ d, size = 18 }: { d: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {d}
  </svg>
);
const IconPin = () => <Icon d={<><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>} />;
const IconDollar = () => <Icon d={<><path d="M12 3v18" /><path d="M16.5 7.5c-.8-1.3-2.4-2-4.5-2-2.6 0-4 1.3-4 3s1.6 2.5 4 3 4 1.4 4 3.2-1.5 3.3-4.2 3.3c-2 0-3.7-.8-4.6-2.2" /></>} />;
const IconArrow = () => <Icon d={<><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>} />;
const IconCheck = () => <Icon size={16} d={<path d="M5 12.5l4.5 4.5L19 7.5" />} />;
const IconTag = () => <Icon d={<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.3" /></>} />;
const IconHome = () => <Icon d={<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>} />;
const IconBank = () => <Icon d={<><path d="M3 9l9-5 9 5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></>} />;

const ARROW_LOGO = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 17l6-6 4 4 6-7" />
    <path d="M15 8h5v5" />
  </svg>
);

// ---------------- Form ----------------

function AddressInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [items, setItems] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<number | undefined>(undefined);
  const lastPicked = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (value.trim().length < 4 || value === lastPicked.current) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    timer.current = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/suggest?q=${encodeURIComponent(value)}`, { signal: ctrl.signal });
        const d = await r.json();
        setItems((d.suggestions ?? []).map((s: { label: string }) => s.label));
        // Only open if the user is still in the field (a late response mustn't cover the results).
        setOpen(document.activeElement === inputRef.current);
        setActive(-1);
      } catch {
        /* suggestions are optional */
      }
    }, 250);
    return () => ctrl.abort();
  }, [value]);

  const pick = (s: string) => {
    lastPicked.current = s;
    onChange(s);
    setOpen(false);
    setItems([]);
  };

  return (
    <div className="combo field">
      <span className="field-icon"><IconPin /></span>
      <input
        ref={inputRef}
        id="address"
        className="input"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="next"
        placeholder="4321 Arsenal St, St. Louis, MO"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(items[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={open}
        aria-controls="address-list"
      />
      {open && items.length > 0 && (
        <ul id="address-list" className="combo-list" role="listbox">
          {items.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onPointerDown={(e) => { e.preventDefault(); pick(s); }}
            >
              <IconPin /> <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------- Results ----------------

const reveal = (i: number) => ({ '--d': i } as CSSProperties);

function ScoreRing({ passed, total, good }: { passed: number; total: number; good: boolean }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <div className={`ring ${good ? 'ring-good' : 'ring-bad'}`} role="img" aria-label={`${passed} of ${total} tests passed`}>
      <svg viewBox="0 0 96 96" width="96" height="96">
        <circle cx="48" cy="48" r={r} className="ring-track" />
        <circle
          cx="48"
          cy="48"
          r={r}
          className="ring-value"
          strokeDasharray={c}
          style={{ '--off': c * (1 - passed / total), '--full': c } as CSSProperties}
          transform="rotate(-90 48 48)"
        />
      </svg>
      <div className="ring-label">
        <strong>{passed}/{total}</strong>
        <span>tests</span>
      </div>
    </div>
  );
}

function Verdict({ a }: { a: Analysis }) {
  const s = a.verdict.status;
  const passed = a.checks.filter((c) => c.pass).length;
  return (
    <section className={`card verdict verdict-${s} reveal`} style={reveal(0)}>
      <div className="verdict-head">
        <ScoreRing passed={passed} total={a.checks.length} good={s === 'meets'} />
        <div className="verdict-text">
          <div className="verdict-top">
            <span className={`badge badge-${s}`}>{s === 'meets' ? 'Meets targets' : s === 'misses' ? 'Below targets' : 'Needs rent data'}</span>
            <span className={`confidence confidence-${a.verdict.confidence}`} title={a.verdict.confidenceReasons.join(' · ')}>
              {a.verdict.confidence} confidence
            </span>
          </div>
          <h2>{a.verdict.headline}</h2>
          <p className="muted">
            {a.address.matched}
            {` · ${money(a.allInCost)} all-in`}
            {a.arv ? ` · ARV ${money(a.arv.arv)}` : ''}
          </p>
        </div>
      </div>
      <div className="checks">
        {a.checks.map((c) => (
          <div key={c.id} className={`check ${c.pass ? 'pass' : 'fail'}`}>
            <span className="check-icon" aria-hidden>{c.pass ? <IconCheck /> : '!'}</span>
            <span className="check-label">{c.label}</span>
            <span className="check-val">{c.actual}</span>
            <span className="check-target">target {c.target}</span>
          </div>
        ))}
      </div>
      {a.verdict.confidenceReasons.length > 0 && (
        <p className="fine">Confidence is {a.verdict.confidence} because: {a.verdict.confidenceReasons.join(' · ')}.</p>
      )}
    </section>
  );
}

const KIND_LABEL = { rehab: 'Renovated', arms: 'Open market', asis: 'As-is', appraised: 'Appraised' } as const;

function ArvCard({ a }: { a: Analysis }) {
  const v = a.arv;
  if (!v) {
    return a.arvNote ? (
      <section className="card notes reveal" style={reveal(1)}>
        <h3>No ARV for this address</h3>
        <p className="muted">{a.arvNote} Results below use your all-in cost only.</p>
      </section>
    ) : null;
  }
  const date = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return (
    <section className="card reveal" style={reveal(1)}>
      <div className="card-head">
        <h3>{v.source === 'county-appraisal' ? 'After-repair value from nearby appraisals' : 'After-repair value from nearby sales'}</h3>
        <span className="muted small">
          {v.source === 'county-appraisal'
            ? `St. Louis County appraised values, tax year ${v.latestSale.slice(0, 4)}`
            : `City of St. Louis sales records through ${date(v.latestSale)}`}
        </span>
      </div>
      <div className="value-hero">
        <div>
          <span>ARV</span>
          <strong>{money(v.arv)}</strong>
        </div>
        <div>
          <span>Range of comps</span>
          <strong className="muted-strong">
            {money(v.low)} – {money(v.high)}
          </strong>
        </div>
        <div>
          <span>Max all-in (75% of ARV)</span>
          <strong className={a.allInCost <= (a.maxAllInFromArv ?? 0) ? 'pos' : 'neg'}>{money(a.maxAllInFromArv)}</strong>
        </div>
      </div>
      <p className={`arv-verdict ${a.allInCost <= (a.maxAllInFromArv ?? 0) ? 'ok' : 'over'}`}>
        Your all-in cost of {money(a.allInCost)} is{' '}
        {a.allInCost <= (a.maxAllInFromArv ?? 0)
          ? `${money((a.maxAllInFromArv ?? 0) - a.allInCost)} under the 75% mark.`
          : `${money(a.allInCost - (a.maxAllInFromArv ?? 0))} over the 75% mark.`}{' '}
        ({pct(a.allInCost / v.arv, 1)} of ARV)
      </p>
      <p className="arv-method">{v.method}</p>
      <div className="table-wrap">
        <table className="tbl comps">
          <thead>
            <tr>
              <th>{v.source === 'county-appraisal' ? 'Similar property' : 'Comparable sale'}</th>
              <th>{v.source === 'county-appraisal' ? 'Tax year' : 'Sold'}</th>
              <th>{v.source === 'county-appraisal' ? 'Appraised' : 'Price'}</th>
              <th>Sq ft</th>
            </tr>
          </thead>
          <tbody>
            {v.comps.map((c) => (
              <tr key={c.address + c.date}>
                <td>
                  {c.address}
                  {c.units > 1 ? ` · ${c.units} units` : ''}
                  {c.miles != null ? <span className="miles"> · {c.miles < 0.1 ? '<0.1' : c.miles.toFixed(1)} mi</span> : null} <span className={`kind kind-${c.kind}`}>{KIND_LABEL[c.kind]}</span>
                </td>
                <td>{v.source === 'county-appraisal' ? c.date.slice(0, 4) : date(c.date)}</td>
                <td>{money(c.price)}</td>
                <td>{c.area ? c.area.toLocaleString('en-US') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">
        {v.source === 'county-appraisal'
          ? 'Appraised values aren’t sale prices: they usually run below market and ignore renovations. Pull real sold comps (e.g. Redfin) before you offer.'
          : 'Sales records don’t show condition or finishes, so check these comps against your rehab scope. Underwrite at the low end if your finishes won’t match the renovated sales.'} {v.compCount > v.comps.length ? `Showing the ${v.comps.length} ${v.source === 'county-appraisal' ? 'closest in size' : 'closest'} of ${v.compCount}.` : ''}
      </p>
    </section>
  );
}

function Meter({ value, target, max }: { value: number; target: number; max: number }) {
  const fill = Math.max(0, Math.min(value / max, 1));
  return (
    <div className="meter" aria-hidden>
      <span className={`meter-fill ${value >= target ? 'ok' : 'low'}`} style={{ '--w': fill } as CSSProperties} />
      <span className="meter-target" style={{ left: `${(target / max) * 100}%` }} />
    </div>
  );
}

function Kpis({ a }: { a: Analysis }) {
  const s = a.result.stabilized;
  const known = a.rentKnown;
  const tiles = [
    {
      label: 'Monthly cash flow',
      value: known ? money(s.cashFlow / 12) : '—',
      sub: `${money(s.cashFlowPerUnitMonthly)}/unit · target $150`,
      meter: known && <Meter value={s.cashFlowPerUnitMonthly} target={150} max={225} />,
    },
    {
      label: 'DSCR',
      value: known ? ratio(s.dscr) : '—',
      sub: 'lenders want 1.20+',
      meter: known && <Meter value={s.dscr} target={1.2} max={1.8} />,
    },
    { label: 'Loan', value: money(a.loan.amount), sub: `= your all-in cost · ${a.loan.years} yrs`, meter: null },
    { label: 'Mortgage', value: `${money(a.loan.monthlyPayment)}`, sub: `per month at ${pct(a.loan.rate, 1)}`, meter: null },
  ];
  return (
    <section className="kpis">
      {tiles.map((k, i) => (
        <div key={k.label} className="kpi reveal" style={reveal(i + 1)}>
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          {k.meter}
          <div className="kpi-sub">{k.sub}</div>
        </div>
      ))}
    </section>
  );
}

const SEGMENTS = [
  { key: 'vacancy', label: 'Vacancy', color: '#c9801a' },
  { key: 'expenses', label: 'Taxes, insurance, utilities, maintenance', color: '#3d76d9' },
  { key: 'mortgage', label: 'Mortgage', color: '#a03c87' },
  { key: 'cashflow', label: 'Cash flow', color: '#01af8d' },
] as const;

function RentComps({ a }: { a: Analysis }) {
  const m = a.marketRent;
  if (!m || !m.comps.length) return null;
  const perUnit = a.units > 1;
  return (
    <section className="card reveal" style={reveal(5)}>
      <div className="card-head">
        <h3>Rental comps</h3>
        <span className="muted small">
          {money(m.rent)}/mo{perUnit ? ' per unit' : ''} · range {money(m.low)}–{money(m.high)}
        </span>
      </div>
      <p className="arv-method">
        {perUnit
          ? `Nearby ${m.beds ?? ''}-bed apartments listed for rent, used to price one unit. RentCast estimate.`
          : 'Nearby rentals similar to this home, used for the rent estimate. RentCast estimate.'}
      </p>
      <div className="table-wrap">
        <table className="tbl comps">
          <thead>
            <tr>
              <th>Rental</th>
              <th>Beds/baths</th>
              <th>Rent</th>
              <th>Sq ft</th>
            </tr>
          </thead>
          <tbody>
            {m.comps.map((c, i) => (
              <tr key={c.address + i}>
                <td>
                  {c.address.split(',')[0]}
                  {c.miles != null ? <span className="miles"> · {c.miles < 0.1 ? '<0.1' : c.miles.toFixed(1)} mi</span> : null}
                </td>
                <td>{c.beds ?? '—'}/{c.baths ?? '—'}</td>
                <td>{money(c.rent)}</td>
                <td>{c.sqft ? c.sqft.toLocaleString('en-US') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine">Listed rents, not signed leases. Check condition and finishes against your rehab plan.</p>
    </section>
  );
}

function RentBreakdown({ a }: { a: Analysis }) {
  const s = a.result.stabilized;
  if (!a.rentKnown || s.grossPotentialIncome <= 0) return null;
  const m = (x: number) => x / 12;
  const values = {
    vacancy: m(s.vacancy),
    expenses: m(s.operatingExpenses),
    mortgage: m(s.debtService),
    cashflow: Math.max(m(s.cashFlow), 0),
  };
  const total = Object.values(values).reduce((x, y) => x + y, 0);
  const shortfall = s.cashFlow < 0 ? -m(s.cashFlow) : 0;
  return (
    <section className="card reveal" style={reveal(5)}>
      <div className="card-head">
        <h3>Where the rent goes</h3>
        <span className="muted small">{money(m(s.grossPotentialIncome))}/mo rent</span>
      </div>
      <div className="stack" role="img" aria-label="Monthly rent split into vacancy, expenses, mortgage and cash flow">
        {SEGMENTS.map((g) =>
          values[g.key] > 0 ? (
            <span
              key={g.key}
              className="stack-seg"
              style={{ flexGrow: values[g.key], background: g.color }}
              title={`${g.label}: ${money(values[g.key])}/mo (${pct(values[g.key] / total, 0)})`}
            />
          ) : null,
        )}
      </div>
      <ul className="legend">
        {SEGMENTS.map((g) => (
          <li key={g.key}>
            <span className="swatch" style={{ background: g.color }} />
            <span className="legend-label">{g.label}</span>
            <span className="legend-val">{money(values[g.key])}</span>
          </li>
        ))}
      </ul>
      {shortfall > 0 && <p className="shortfall">Rent doesn’t cover everything: you’d add {money(shortfall)}/mo out of pocket.</p>}
    </section>
  );
}

function MakeItWork({ a }: { a: Analysis }) {
  const sol = a.solutions;
  const rent = a.result.stabilized.grossPotentialIncome / 12;
  const tiles = [
    {
      icon: <IconTag />,
      title: 'All-in cost that works',
      value: sol.maxAllIn ? money(sol.maxAllIn) : 'None',
      text: sol.maxAllIn
        ? sol.maxAllIn >= a.allInCost
          ? `Room to spare: still works up to ${money(sol.maxAllIn)} all-in.`
          : `${money(a.allInCost - sol.maxAllIn)} less than your all-in cost.`
        : 'No all-in cost clears both targets at this rent.',
    },
    {
      icon: <IconHome />,
      title: 'Rent it needs',
      value: sol.requiredMonthlyRent ? money(sol.requiredMonthlyRent) : '—',
      text: sol.requiredMonthlyRent
        ? `${money(sol.requiredMonthlyRent / a.units)}/unit${a.rentKnown ? ` vs ${money(rent / a.units)} modeled` : ''}. Check rental comps.`
        : 'Not solvable at this all-in cost.',
    },
    {
      icon: <IconBank />,
      title: 'Cash you’d need to put in',
      value: sol.cashNeeded === null ? '—' : money(sol.cashNeeded),
      text:
        sol.cashNeeded === null
          ? 'Even with no loan the rent wouldn’t clear the targets.'
          : sol.cashNeeded === 0
            ? 'None: it works fully financed.'
            : 'Paying this much down (a smaller loan) gets DSCR and cash flow to target.',
    },
  ];
  return (
    <section className="reveal" style={reveal(6)}>
      <div className="section-title">
        <h3>What would make it work</h3>
        <p className="muted small">Math thresholds under these assumptions, not what a seller or lender will accept.</p>
      </div>
      <div className="solve-grid solve-3">
        {tiles.map((t) => (
          <div key={t.title} className="solve-tile">
            <span className="solve-icon">{t.icon}</span>
            <div className="solve-title">{t.title}</div>
            <div className="solve-value">{t.value}</div>
            <div className="solve-text">{t.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LoanOptions({ a }: { a: Analysis }) {
  return (
    <section className="card reveal" style={reveal(7)}>
      <div className="card-head">
        <h3>Loan options at {money(a.loan.amount)}</h3>
        <span className="muted small">Loan = your all-in cost</span>
      </div>
      <div className="fin-list">
        {a.loanOptions.map((o) => (
          <div key={o.id} className={`fin fin-static ${o.id === 'base' ? 'fin-base' : ''}`}>
            <div className="fin-row">
              <div className="fin-name">
                <strong>{o.name}</strong>
                <span>{o.detail}</span>
              </div>
              <div className="fin-nums">
                <div>
                  <span>Payment / mo</span>
                  <strong>{money(o.monthlyPayment)}</strong>
                </div>
                <div>
                  <span>Cash flow / mo</span>
                  <strong className={a.rentKnown ? (o.monthlyCashFlow >= 0 ? 'pos' : 'neg') : ''}>
                    {a.rentKnown ? money(o.monthlyCashFlow) : '—'}
                  </strong>
                </div>
                <div className="fin-dscr">
                  <span>DSCR</span>
                  <strong>{a.rentKnown ? ratio(o.dscr) : '—'}</strong>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="fine">Rates at prime. Your lender’s quote decides the actual rate and term.</p>
    </section>
  );
}

function ValueCard({ a }: { a: Analysis }) {
  const v = a.valueAdd;
  if (!v) return null;
  const drop = v.value - v.valueIfCapUp;
  const equity = v.value - a.allInCost;
  return (
    <section className="card reveal" style={reveal(8)}>
      <div className="card-head">
        <h3>What raises the value</h3>
        <span className="muted small">Value = NOI ÷ {pct(v.capRate, 0)} cap rate</span>
      </div>
      <div className="value-hero">
        <div>
          <span>Income value</span>
          <strong>{money(v.value)}</strong>
        </div>
        <div>
          <span>vs. your all-in cost</span>
          <strong className={equity >= 0 ? 'pos' : 'neg'}>
            {equity >= 0 ? '+' : '−'}
            {money(Math.abs(equity))}
          </strong>
        </div>
        <div>
          <span>If cap rates rise 1 point</span>
          <strong className="neg">−{money(drop)}</strong>
        </div>
      </div>
      <ul className="levers">
        {v.levers.map((l) => (
          <li key={l.id}>
            <div>
              <div className="lever-label">{l.label}</div>
              <div className="lever-note">
                {l.note} +{money(l.addedNoi)}/yr NOI · worth spending up to {money(l.maxSpend)}
              </div>
            </div>
            <strong className="pos">+{money(l.addedValue)}</strong>
          </li>
        ))}
      </ul>
      <p className="fine">
        {v.incomeValued
          ? 'Buildings with 5+ units are valued on income, so every operating improvement shows up in value. '
          : 'Lenders value 1–4 units on sales comps, so treat these as income-based indications. '}
        “Worth spending up to” = pays for itself within 3 years. Every +$1,000/yr of NOI adds about {money(v.perThousandNoi)} of value.
      </p>
    </section>
  );
}

type Period = 'monthly' | 'annual';

function Statement({ a }: { a: Analysis }) {
  const [period, setPeriod] = useState<Period>('monthly');
  const d = period === 'monthly' ? 12 : 1;
  const s = a.result.stabilized;
  const ls = a.lineSources;
  const line = (label: string, v: number, src: Source | null, opts: { neg?: boolean; strong?: boolean } = {}) => (
    <tr className={opts.strong ? 'strong' : ''}>
      <td>
        {label} {src && <Tag source={src} />}
      </td>
      <td>{money((opts.neg ? -v : v) / d)}</td>
    </tr>
  );
  return (
    <details className="card section reveal" style={reveal(9)} open>
      <summary>
        <h3>Income, expenses &amp; cash flow</h3>
      </summary>
      <div className="seg" role="tablist">
        {(['monthly', 'annual'] as Period[]).map((p) => (
          <button key={p} className={p === period ? 'on' : ''} onClick={() => setPeriod(p)} type="button">
            {p === 'monthly' ? 'Monthly' : 'Annual'}
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <tbody>
            {line('Gross rent', s.grossPotentialIncome, ls.rent)}
            {line('Vacancy', s.vacancy, ls.vacancy, { neg: true })}
            {line('Effective income', s.effectiveIncome, null, { strong: true })}
            {line(a.taxBasis === 'reassessed' ? 'Property taxes (after rehab)' : 'Property taxes', s.taxes, ls.taxes, { neg: true })}
            {line('Insurance', s.insurance, ls.insurance, { neg: true })}
            {line('Utilities (water, sewer, trash)', s.waterSewerTrash, ls.utilities, { neg: true })}
            {line('Maintenance', s.maintenance, ls.maintenance, { neg: true })}
            {line('Operating expenses', s.operatingExpenses, null, { neg: true, strong: true })}
            {line('Net operating income (NOI)', s.noi, null, { strong: true })}
            {line(`Mortgage (${a.loan.years}-yr, ${pct(a.loan.rate, 1)})`, s.debtService, ls.loan, { neg: true })}
            {line('Cash flow', s.cashFlow, null, { strong: true })}
          </tbody>
          <tbody className="ratios">
            <tr>
              <td>DSCR</td>
              <td>{ratio(s.dscr)}</td>
            </tr>
            <tr>
              <td>Expense ratio (incl. vacancy)</td>
              <td>{pct(s.expenseRatio)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="fine">Cash flow = rent − vacancy − taxes − insurance − utilities − maintenance − mortgage.</p>
    </details>
  );
}

function Assumptions({ a }: { a: Analysis }) {
  return (
    <details className="card section reveal" style={reveal(10)}>
      <summary>
        <h3>Where every number comes from</h3>
      </summary>
      <ul className="assumptions">
        {a.assumptions.map((r) => (
          <li key={r.key}>
            <div className="a-top">
              <span>{r.label}</span>
              <span className="a-val">
                {r.value} <Tag source={r.source} />
              </span>
            </div>
            <div className="a-note">{r.note}</div>
          </li>
        ))}
      </ul>
      <p className="fine">Listing: {a.listing.detail}</p>
    </details>
  );
}

// ---------------- App ----------------

const STEPS = ['Finding the property', 'Pulling nearby sales', 'Estimating ARV', 'Pulling taxes & rents', 'Running the numbers'];

export function App() {
  const [address, setAddress] = useState('');
  const [allIn, setAllIn] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Analysis | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading) return;
    setStep(0);
    const t = window.setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 1100);
    return () => window.clearInterval(t);
  }, [loading]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = Number(allIn.replace(/,/g, ''));
    if (address.trim().length < 5) return setError('Enter the property address.');
    if (!v) return setError('Enter your all-in cost.');
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, allInCost: v }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.ref ? `${d.error} (ref ${d.ref})` : d.error);
      setResult(d);
      window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="shell">
      <div className="glow" aria-hidden />
      <div className="page">
        <header className="top">
          <div className="logo">
            <span className="logo-mark">{ARROW_LOGO}</span> Dealwise
          </div>
          <div className="by">by Multifamily Methods</div>
        </header>

        <main>
          <section className="hero">
            <div className="eyebrow">
              <span className="pulse" /> Deal analyzer
            </div>
            <h1>
              Know if a deal works <span className="hl">before you offer.</span>
            </h1>
            <p>Enter the address and your all-in cost. Get the ARV from nearby sales, the 75% check, and the rent, expenses, mortgage and cash flow.</p>
          </section>

          <form className="card form" onSubmit={submit} noValidate>
            <label htmlFor="address">Property address</label>
            <AddressInput value={address} onChange={setAddress} />
            <label htmlFor="allin">
              All-in cost <span className="opt">purchase + rehab + closing</span>
            </label>
            <div className="field">
              <span className="field-icon"><IconDollar /></span>
              <input
                id="allin"
                className="input"
                inputMode="numeric"
                placeholder="90,000"
                value={allIn}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 9);
                  setAllIn(digits ? Number(digits).toLocaleString('en-US') : '');
                }}
              />
            </div>
            <p className="form-hint">
              Use your underwriting spreadsheet for the all-in cost; the loan equals it on a 30-year mortgage. For St. Louis City and
              County addresses we also estimate the ARV and check you’re at or under 75% of it.
            </p>
            <button className={`btn ${loading ? 'busy' : ''}`} type="submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner" aria-hidden /> {STEPS[step]}…
                </>
              ) : (
                <>
                  Analyze property <IconArrow />
                </>
              )}
            </button>
            {loading && (
              <div className="progress" aria-hidden>
                <span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
              </div>
            )}
            {error && <p className="error" role="alert">{error}</p>}
          </form>

          {!result && (
            <ul className="trust">
              <li><IconCheck /> ARV from real sales</li>
              <li><IconCheck /> Every number sourced</li>
              <li><IconCheck /> No sign-up</li>
            </ul>
          )}

          {result && (
            <div className="results" ref={resultsRef}>
              <Verdict a={result} />
              <ArvCard a={result} />
              <Kpis a={result} />
              <RentBreakdown a={result} />
              <RentComps a={result} />
              <MakeItWork a={result} />
              {result.warnings.length > 0 && (
                <section className="card notes reveal" style={reveal(7)}>
                  <h3>Heads up</h3>
                  <ul>
                    {result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </section>
              )}
              <Statement a={result} />
              <LoanOptions a={result} />
              <ValueCard a={result} />
              <Assumptions a={result} />
              <p className="disclaimer">
                Educational screening estimate based on standard underwriting assumptions and free public data (HUD Fair Market Rents, US
                Census). Not an appraisal, loan approval or tax advice. Verify rents, taxes and insurance before you offer.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
