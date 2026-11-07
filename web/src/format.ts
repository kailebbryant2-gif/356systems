export const money = (n: number | null | undefined, opts: { sign?: boolean } = {}) => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const r = Math.round(n);
  const s = `$${Math.abs(r).toLocaleString('en-US')}`;
  if (r < 0) return `−${s}`;
  return opts.sign && r > 0 ? `+${s}` : s;
};

export const pct = (n: number | null | undefined, d = 1) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(d)}%`;

export const ratio = (n: number | null | undefined) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(2);
