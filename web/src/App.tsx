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
const IconLink = () => <Icon d={<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>} />;
const IconArrow = () => <Icon d={<><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>} />;
const IconCheck = () => <Icon size={16} d={<path d="M5 12.5l4.5 4.5L19 7.5" />} />;
const IconTag = () => <Icon d={<><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.3" /></>} />;
const IconHome = () => <Icon d={<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-5h4v5" /></>} />;
const IconBank = () => <Icon d={<><path d="M3 9l9-5 9 5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8" /><path d="M3 20h18" /></>} />;
const IconRuler = () => <Icon d={<><path d="M4 16L16 4l4 4L8 20z" /><path d="M8 12l2 2M11 9l2 2M14 6l2 2" /></>} />;

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
        setOpen(true);
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
        id="address"
        className="input"
        autoComplete="off"
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
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
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
            {a.address.matched} · {money(a.purchasePrice)}
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
      label: 'Cash-on-cash',
      value: known ? pct(s.cashOnCash) : '—',
      sub: 'target 10%',
      meter: known && <Meter value={s.cashOnCash} target={0.1} max={0.15} />,
    },
    {
      label: 'DSCR',
      value: known ? ratio(s.dscr) : '—',
      sub: 'lenders want 1.20+',
      meter: known && <Meter value={s.dscr} target={1.2} max={1.8} />,
    },
    {
      label: 'Cash to close',
      value: money(a.result.acquisition.cashInvested),
      sub: a.rehab.cost > 0 ? `incl. ${money(a.rehab.cost)} rehab` : 'down + closing',
      meter: null,
    },
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
  { key: 'expenses', label: 'Operating expenses', color: '#3d76d9' },
  { key: 'mortgage', label: 'Mortgage', color: '#a03c87' },
  { key: 'cashflow', label: 'Cash flow', color: '#25935a' },
] as const;

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
        <span className="muted small">{money(m(s.grossPotentialIncome))}/mo stabilized rent</span>
      </div>
      <div className="stack" role="img" aria-label="Monthly rent split into vacancy, operating expenses, mortgage and cash flow">
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
      {shortfall > 0 && (
        <p className="shortfall">Rent doesn’t cover everything: you’d add {money(shortfall)}/mo out of pocket.</p>
      )}
    </section>
  );
}

function MakeItWork({ a }: { a: Analysis }) {
  const sol = a.solutions;
  const rent = a.result.stabilized.grossPotentialIncome / 12;
  const units = a.result.acquisition.purchasePrice / a.result.acquisition.pricePerUnit;
  const tiles = [
    {
      icon: <IconTag />,
      title: 'Price that works',
      value: sol.maxPrice ? money(sol.maxPrice) : 'None',
      text: sol.maxPrice
        ? sol.maxPrice >= a.purchasePrice
          ? `Room to spare: targets still pass up to ${money(sol.maxPrice)}.`
          : `${money(a.purchasePrice - sol.maxPrice)} below your price.`
        : 'No price clears all three at these rents and terms.',
    },
    {
      icon: <IconHome />,
      title: 'Rent it needs',
      value: sol.requiredMonthlyRent ? `${money(sol.requiredMonthlyRent)}` : '—',
      text: sol.requiredMonthlyRent
        ? `${money(sol.requiredMonthlyRent / units)}/unit${a.rentKnown ? ` vs ${money(rent / units)} modeled` : ''}.`
        : 'Not solvable at this price.',
    },
    {
      icon: <IconBank />,
      title: 'Down payment it needs',
      value: sol.requiredDownPct !== null ? pct(sol.requiredDownPct, 0) : '—',
      text:
        sol.requiredDownPct !== null && sol.requiredDownCash !== null
          ? `${money(sol.requiredDownCash)} down fixes DSCR and cash flow.`
          : 'Even all cash wouldn’t clear the targets.',
    },
    {
      icon: <IconRuler />,
      title: '75% rule offer',
      value: money(Math.max(sol.seventyFiveRuleMaxOffer, 0)),
      text: 'Price + rehab ≤ 75% of after-repair value.',
    },
  ];
  return (
    <section className="reveal" style={reveal(6)}>
      <div className="section-title">
        <h3>What would make it work</h3>
        <p className="muted small">Math thresholds under these assumptions, not what a seller or lender will accept.</p>
      </div>
      <div className="solve-grid">
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

type Period = 'monthly' | 'annual';

function Statement({ a }: { a: Analysis }) {
  const [period, setPeriod] = useState<Period>('monthly');
  const d = period === 'monthly' ? 12 : 1;
  const c = a.result.current;
  const s = a.result.stabilized;
  const ls = a.lineSources;
  const uniq = (xs: Source[]) => xs.filter((x, i) => xs.indexOf(x) === i);
  const line = (label: string, cur: number, stab: number, src: Source | Source[], opts: { neg?: boolean; strong?: boolean } = {}) => {
    const srcs = Array.isArray(src) ? src : [src];
    return (
      <tr className={opts.strong ? 'strong' : ''}>
        <td>
          {label} {srcs.map((x, i) => <Tag key={i} source={x} />)}
        </td>
        <td>{money((opts.neg ? -cur : cur) / d)}</td>
        <td>{money((opts.neg ? -stab : stab) / d)}</td>
      </tr>
    );
  };
  return (
    <details className="card section reveal" style={reveal(7)} open>
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
          <thead>
            <tr>
              <th />
              <th>Current</th>
              <th>Stabilized</th>
            </tr>
          </thead>
          <tbody>
            {line('Gross rent', c.grossPotentialIncome, s.grossPotentialIncome, uniq([ls.gpiCurrent, ls.gpiStabilized]))}
            {line('Vacancy', c.vacancy, s.vacancy, ls.vacancy, { neg: true })}
            {line('Effective income', c.effectiveIncome, s.effectiveIncome, [], { strong: true })}
            {line('Property taxes', c.taxes, s.taxes, uniq([ls.taxesCurrent, ls.taxesStabilized]), { neg: true })}
            {line('Insurance', c.insurance, s.insurance, ls.insurance, { neg: true })}
            {line('Management', c.management, s.management, ls.management, { neg: true })}
            {line('Maintenance', c.maintenance, s.maintenance, ls.maintenance, { neg: true })}
            {line('Water, sewer, trash', c.waterSewerTrash, s.waterSewerTrash, ls.utilities, { neg: true })}
            {line('Lawn & snow', c.lawnSnow, s.lawnSnow, ls.utilities, { neg: true })}
            {line('Operating expenses', c.operatingExpenses, s.operatingExpenses, [], { neg: true, strong: true })}
            {line('Net operating income (NOI)', c.noi, s.noi, [], { strong: true })}
            {line('Mortgage (P&I)', c.debtService, s.debtService, ls.financing, { neg: true })}
            {line('Cash flow', c.cashFlow, s.cashFlow, [], { strong: true })}
          </tbody>
          <tbody className="ratios">
            <tr>
              <td>DSCR</td>
              <td>{ratio(c.dscr)}</td>
              <td>{ratio(s.dscr)}</td>
            </tr>
            <tr>
              <td>Expense ratio</td>
              <td>{pct(c.expenseRatio)}</td>
              <td>{pct(s.expenseRatio)}</td>
            </tr>
            <tr>
              <td>Cash-on-cash</td>
              <td>{pct(c.cashOnCash)}</td>
              <td>{pct(s.cashOnCash)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="fine">
        Current = today’s rent (or the benchmark when the listing doesn’t state rent). Stabilized = after any rehab, at market rent with
        taxes reassessed.
      </p>
    </details>
  );
}

function Acquisition({ a }: { a: Analysis }) {
  const q = a.result.acquisition;
  const rows: [string, string, Source | null][] = [
    ['Purchase price', money(q.purchasePrice), 'user'],
    ['Price per unit', money(q.pricePerUnit), null],
    ['Closing costs', money(q.closingCosts), 'default'],
    ['Down payment', `${money(q.downPayment)} (${pct(q.downPayment / q.purchasePrice, 0)})`, 'default'],
    ['Loan amount', money(q.loanAmount), null],
    ['Monthly payment (P&I)', money(q.monthlyPayment), 'default'],
    ['Rehab budget', `${money(a.rehab.cost)} · ${a.rehab.scope === 'unknown' ? 'condition unknown' : a.rehab.scope}`, a.lineSources.rehab],
    ['Cash to close', money(q.cashInvested), null],
    ['After-repair value (ARV)', money(q.arv), 'estimate'],
    ['Forced appreciation', money(q.forcedAppreciation), null],
    ['Going-in cap rate', pct(q.goingInCapRate), null],
    ['Yield on cost', pct(q.yieldOnCost), null],
  ];
  return (
    <details className="card section reveal" style={reveal(8)}>
      <summary>
        <h3>Purchase, financing &amp; rehab</h3>
      </summary>
      <dl className="kv">
        {rows.map(([k, v, src]) => (
          <div key={k}>
            <dt>
              {k} {src && <Tag source={src} />}
            </dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="fine">
        Forced appreciation = ARV − price − closing − rehab. Yield on cost = stabilized NOI ÷ all-in cost. Rehab uses $30 / $50 / $75 per sq ft
        bands for cosmetic / substantial / gut work. It’s a screening estimate, not a contractor bid.
      </p>
    </details>
  );
}

function Returns({ a }: { a: Analysis }) {
  const ys = a.result.years;
  const row = (label: string, f: (y: (typeof ys)[number]) => string, strong = false) => (
    <tr className={strong ? 'strong' : ''}>
      <td>{label}</td>
      {ys.map((y) => (
        <td key={y.year}>{f(y)}</td>
      ))}
    </tr>
  );
  return (
    <details className="card section reveal" style={reveal(9)}>
      <summary>
        <h3>5-year returns</h3>
      </summary>
      <div className="table-wrap">
        <table className="tbl tbl-wide">
          <thead>
            <tr>
              <th />
              {ys.map((y) => (
                <th key={y.year}>Yr {y.year}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row('Cash flow', (y) => money(y.cashFlow))}
            {row('Tax effect', (y) => money(y.taxEffect, { sign: true }))}
            {row('Principal paydown', (y) => money(y.principal))}
            {row('Appreciation', (y) => money(y.appreciation))}
            {row('Total return', (y) => money(y.totalReturn), true)}
            {row('Total ROI', (y) => pct(y.totalRoi), true)}
            {row('Cash-on-cash', (y) => pct(y.cashFlowRoi))}
            {row('Equity', (y) => money(y.equity))}
            {row('Net wealth created', (y) => money(y.netWealthCreated))}
          </tbody>
        </table>
      </div>
      <p className="fine">
        Only cash flow is cash in your pocket. Paydown and appreciation build equity you can’t spend until you sell or refinance. Year 1
        includes one-time forced appreciation. Tax effect = −(NOI − interest − depreciation) × 25%; a negative number means tax owed.
        Passive-loss rules and depreciation recapture can change this, so ask a CPA.
      </p>
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
      <p className="fine">
        Listing: {a.listing.detail}
        {a.listing.status === 'used' && a.listing.photos.length > 0 ? ` ${a.listing.photos.length} photos found.` : ''}
      </p>
    </details>
  );
}

// ---------------- App ----------------

const STEPS = ['Finding the property', 'Reading the listing', 'Pulling market rents', 'Estimating taxes & rehab', 'Running the numbers'];

export function App() {
  const [address, setAddress] = useState('');
  const [price, setPrice] = useState('');
  const [link, setLink] = useState('');
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
    const p = Number(price.replace(/,/g, ''));
    if (address.trim().length < 5) return setError('Enter the property address.');
    if (!p) return setError('Enter the purchase price.');
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, purchasePrice: p, listingUrl: link.trim() }),
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
              <span className="pulse" /> Free rental deal analyzer
            </div>
            <h1>
              Know if a deal works <span className="hl">before you offer.</span>
            </h1>
            <p>Address, price and listing link in. Rent, expenses, NOI, cash flow, DSCR and the price that makes it work out.</p>
          </section>

          <form className="card form" onSubmit={submit} noValidate>
            <label htmlFor="address">Property address</label>
            <AddressInput value={address} onChange={setAddress} />
            <div className="row2">
              <div>
                <label htmlFor="price">Purchase price</label>
                <div className="field">
                  <span className="field-icon"><IconDollar /></span>
                  <input
                    id="price"
                    className="input"
                    inputMode="numeric"
                    placeholder="250,000"
                    value={price}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 9);
                      setPrice(digits ? Number(digits).toLocaleString('en-US') : '');
                    }}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="link">
                  Listing link <span className="opt">with photos</span>
                </label>
                <div className="field">
                  <span className="field-icon"><IconLink /></span>
                  <input
                    id="link"
                    className="input"
                    type="url"
                    inputMode="url"
                    placeholder="https://…"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                  />
                </div>
              </div>
            </div>
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
              <li><IconCheck /> Full underwriting</li>
              <li><IconCheck /> Every number sourced</li>
              <li><IconCheck /> No sign-up</li>
            </ul>
          )}

          {result && (
            <div className="results" ref={resultsRef}>
              <Verdict a={result} />
              <Kpis a={result} />
              <RentBreakdown a={result} />
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
              <Acquisition a={result} />
              <Returns a={result} />
              <Assumptions a={result} />
              <p className="disclaimer">
                Educational screening estimate based on standard underwriting assumptions and free public data (HUD Fair Market Rents, US
                Census). Not an appraisal, inspection, loan approval or tax advice. Verify rents, taxes, insurance and rehab before you offer.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
