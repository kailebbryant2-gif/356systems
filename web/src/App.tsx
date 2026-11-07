import { useEffect, useRef, useState } from 'react';
import type { Analysis } from '../../shared/resolve';
import type { Source } from '../../shared/engine/types';
import { money, pct, ratio } from './format';

const SOURCE_LABEL: Record<Source, string> = {
  user: 'You',
  verified: 'Verified',
  listing: 'Listing',
  estimate: 'Estimate',
  default: 'Course rule',
};

function Tag({ source }: { source: Source }) {
  return <span className={`tag tag-${source}`}>{SOURCE_LABEL[source]}</span>;
}

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
    <div className="combo">
      <input
        id="address"
        className="input"
        autoComplete="off"
        placeholder="123 Main St, St. Louis, MO"
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
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PriceInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="price">
      <span>$</span>
      <input
        id="price"
        className="input"
        inputMode="numeric"
        placeholder="250,000"
        value={value}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 9);
          onChange(digits ? Number(digits).toLocaleString('en-US') : '');
        }}
      />
    </div>
  );
}

// ---------------- Results ----------------

function Verdict({ a }: { a: Analysis }) {
  const s = a.verdict.status;
  return (
    <section className={`card verdict verdict-${s}`}>
      <div className="verdict-top">
        <span className={`badge badge-${s}`}>{s === 'meets' ? 'Works' : s === 'misses' ? 'Doesn’t work yet' : 'Needs rent data'}</span>
        <span className={`confidence confidence-${a.verdict.confidence}`} title={a.verdict.confidenceReasons.join(' · ')}>
          {a.verdict.confidence} confidence
        </span>
      </div>
      <h2>{a.verdict.headline}</h2>
      <p className="muted">
        {a.address.matched} · {a.address.county} · {money(a.purchasePrice)}
      </p>
      <div className="checks">
        {a.checks.map((c) => (
          <div key={c.id} className={`check ${c.pass ? 'pass' : 'fail'}`}>
            <span className="dot" aria-hidden />
            <span className="check-label">{c.label}</span>
            <span className="check-val">{c.actual}</span>
            <span className="check-target">{c.target}</span>
          </div>
        ))}
      </div>
      {a.verdict.confidenceReasons.length > 0 && (
        <p className="fine">Lower confidence because: {a.verdict.confidenceReasons.join(' · ')}.</p>
      )}
    </section>
  );
}

function Kpis({ a }: { a: Analysis }) {
  const s = a.result.stabilized;
  const items = [
    { label: 'Monthly cash flow', value: money(s.cashFlow / 12), sub: `${money(s.cashFlowPerUnitMonthly)} per unit` },
    { label: 'Cash-on-cash', value: pct(s.cashOnCash), sub: 'Stabilized, year 1' },
    { label: 'DSCR', value: ratio(s.dscr), sub: 'Lenders want 1.20+' },
    { label: 'Cash to close', value: money(a.result.acquisition.cashInvested), sub: 'Down + closing + rehab' },
  ];
  return (
    <section className="kpis">
      {items.map((k) => (
        <div key={k.label} className="kpi">
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{a.rentKnown || k.label === 'Cash to close' ? k.value : '—'}</div>
          <div className="kpi-sub">{k.sub}</div>
        </div>
      ))}
    </section>
  );
}

function MakeItWork({ a }: { a: Analysis }) {
  const sol = a.solutions;
  const rent = a.result.stabilized.grossPotentialIncome / 12;
  const units = a.result.acquisition.purchasePrice / a.result.acquisition.pricePerUnit;
  const rows = [
    {
      title: 'Price that works',
      value: sol.maxPrice ? money(sol.maxPrice) : 'None at these rents',
      text: sol.maxPrice
        ? sol.maxPrice >= a.purchasePrice
          ? `You have room: the targets still pass up to ${money(sol.maxPrice)}.`
          : `${money(a.purchasePrice - sol.maxPrice)} below your price. Highest price where DSCR, cash flow and cash-on-cash all pass.`
        : 'No price meets all three cash-flow targets at these rents and terms.',
    },
    {
      title: 'Rent it needs',
      value: sol.requiredMonthlyRent ? `${money(sol.requiredMonthlyRent)}/mo` : '—',
      text: sol.requiredMonthlyRent
        ? `${money(sol.requiredMonthlyRent / units)} per unit${a.rentKnown ? ` vs ${money(rent / units)} modeled` : ''}. Check this against rental comps.`
        : 'Not solvable at this price.',
    },
    {
      title: 'Down payment it needs',
      value: sol.requiredDownPct !== null ? pct(sol.requiredDownPct, 0) : '—',
      text:
        sol.requiredDownPct !== null && sol.requiredDownCash !== null
          ? `${money(sol.requiredDownCash)} down gets DSCR and cash flow to target. More cash in lowers your cash-on-cash.`
          : 'Even all cash wouldn’t clear the targets at these rents.',
    },
    {
      title: '75% rule offer',
      value: money(Math.max(sol.seventyFiveRuleMaxOffer, 0)),
      text: 'Course rule: price + rehab ≤ 75% of ARV. ARV here is an income-based estimate.',
    },
  ];
  return (
    <section className="card">
      <h3>What would make it work</h3>
      <div className="solve">
        {rows.map((r) => (
          <div key={r.title} className="solve-row">
            <div>
              <div className="solve-title">{r.title}</div>
              <div className="solve-text">{r.text}</div>
            </div>
            <div className="solve-value">{r.value}</div>
          </div>
        ))}
      </div>
      <p className="fine">These are math thresholds under the assumptions below, not what a seller, lender or the market will accept.</p>
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
    <details className="card section" open>
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
            {line('Gross rent', c.grossPotentialIncome, s.grossPotentialIncome, [ls.gpiCurrent, ls.gpiStabilized].filter((x, i, arr) => arr.indexOf(x) === i) as Source[])}
            {line('Vacancy', c.vacancy, s.vacancy, ls.vacancy, { neg: true })}
            {line('Effective income', c.effectiveIncome, s.effectiveIncome, [], { strong: true })}
            {line('Property taxes', c.taxes, s.taxes, [ls.taxesCurrent, ls.taxesStabilized].filter((x, i, arr) => arr.indexOf(x) === i) as Source[], { neg: true })}
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
        Current = today’s rent (or the benchmark when the listing doesn’t state rent). Stabilized = after the rehab, at market rent with
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
    ['Down payment', `${money(q.downPayment)} (${pct(1 - (q.loanAmount - q.rehabFinanced) / q.purchasePrice, 0)})`, 'default'],
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
    <details className="card section">
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
        Forced appreciation = ARV − price − closing − rehab. Yield on cost = stabilized NOI ÷ all-in cost. Rehab uses James’s $30 / $50 / $75
        per sq ft bands. It’s a screening estimate, not a contractor bid.
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
    <details className="card section">
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
        includes one-time forced appreciation. Tax effect = −(NOI − interest − depreciation) × 25%. A negative number means tax owed. Passive-loss
        rules and depreciation recapture can change this, so ask a CPA.
      </p>
    </details>
  );
}

function Assumptions({ a }: { a: Analysis }) {
  return (
    <details className="card section">
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

const STEPS = ['Finding the property', 'Reading the listing', 'Pulling HUD market rents', 'Estimating taxes & rehab', 'Running the underwriting'];

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
    <div className="page">
      <header className="top">
        <div className="logo">
          <span className="logo-mark" aria-hidden>◆</span> Dealwise
        </div>
        <div className="by">by Multifamily Methods</div>
      </header>

      <main>
        <section className="hero">
          <h1>Does this deal work?</h1>
          <p>Enter a property and price. We run James’s underwriting and show you what it would take to hit the targets.</p>
        </section>

        <form className="card form" onSubmit={submit} noValidate>
          <label htmlFor="address">Property address</label>
          <AddressInput value={address} onChange={setAddress} />
          <label htmlFor="price">Purchase price</label>
          <PriceInput value={price} onChange={setPrice} />
          <label htmlFor="link">
            Listing link <span className="opt">with photos</span>
          </label>
          <input
            id="link"
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? STEPS[step] + '…' : 'Analyze property'}
          </button>
          {error && <p className="error" role="alert">{error}</p>}
        </form>

        {result && (
          <div className="results" ref={resultsRef}>
            <Verdict a={result} />
            <Kpis a={result} />
            <MakeItWork a={result} />
            {result.warnings.length > 0 && (
              <section className="card notes">
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
              Educational screening estimate based on the Multifamily Methods course rules and free public data (HUD Fair Market Rents, US
              Census). Not an appraisal, inspection, loan approval, or tax advice. Verify rents, taxes, insurance and rehab before you offer.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
