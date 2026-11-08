import { describe, expect, it } from 'vitest';
import { listingMatchesAddress, parseListing } from '../shared/sources/listing';
import { estimateRehab } from '../shared/sources/rehab';

const fourplex = `<!doctype html><html><head>
<meta property="og:title" content="3520 Wyoming St, St. Louis, MO 63118 | 4-Unit Multifamily">
<meta property="og:description" content="Fourplex in Tower Grove South. Each unit 2 bed / 1 bath. Needs updating.">
<meta property="og:image" content="https://img.example.com/1.jpg">
<script type="application/ld+json">{"@type":"Residence","address":{"streetAddress":"3520 Wyoming St","addressLocality":"St. Louis","addressRegion":"MO","postalCode":"63118"},"floorSize":{"value":"3,600"},"image":["https://img.example.com/2.jpg","https://img.example.com/3.jpg"]}</script>
</head><body>
<h1>3520 Wyoming St</h1><p>8 beds · 4 baths · 3,600 sq ft</p>
<p>Total monthly rent: $3,400. Annual taxes: $2,150.</p>
</body></html>`;

describe('listing parser', () => {
  const f = parseListing(fourplex, 'https://example.com/listing/3520-wyoming');

  it('extracts only stated facts', () => {
    expect(f.units).toBe(4);
    expect(f.sqft).toBe(3600);
    expect(f.totalBeds).toBe(8);
    expect(f.monthlyRent).toBe(3400);
    expect(f.annualTaxes).toBe(2150);
    expect(f.photos).toHaveLength(3);
  });

  it('matches the right address and rejects a different one', () => {
    expect(listingMatchesAddress(f, '3520', 'WYOMING')).toBe(true);
    expect(listingMatchesAddress(f, '3522', 'WYOMING')).toBe(false);
    expect(listingMatchesAddress(f, '3520', 'ARSENAL')).toBe(false);
  });

  it('converts annual income to monthly', () => {
    const g = parseListing('<body>Duplex. Gross scheduled income: $30,000</body>', 'https://x.test/a');
    expect(g.units).toBe(2);
    expect(g.monthlyRent).toBe(2500);
  });

  it('sums per-unit rents only when every unit has one', () => {
    const h = parseListing('<body>Triplex. Unit 1: $800/mo. Unit 2: $850/mo. Unit 3: $900/mo.</body>', 'https://x.test/b');
    expect(h.units).toBe(3);
    expect(h.monthlyRent).toBe(2550);
    const i = parseListing('<body>Triplex. Unit 1: $800/mo. Unit 2: $850/mo.</body>', 'https://x.test/c');
    expect(i.monthlyRent).toBeNull();
  });

  it('does not invent rent or taxes', () => {
    const j = parseListing('<body>Charming home near the park.</body>', 'https://x.test/d');
    expect(j.monthlyRent).toBeNull();
    expect(j.annualTaxes).toBeNull();
    expect(j.units).toBeNull();
  });
});

describe('rehab screen (course bands)', () => {
  it('maps listing language to $30 / $50 / $75', () => {
    expect(estimateRehab('Needs updating throughout', 1000).cost).toBe(50000);
    expect(estimateRehab('Dated kitchen, original baths', 1000).cost).toBe(30000);
    expect(estimateRehab('Fire damaged shell', 1000).cost).toBe(75000);
    expect(estimateRehab('Fully renovated, turnkey', 1000).cost).toBe(0);
    expect(estimateRehab('Gut rehabbed in 2021, turnkey', 1000).scope).toBe('renovated');
  });
  it('unknown condition uses the middle band with the full range', () => {
    const r = estimateRehab('Nice brick home', 1000);
    expect(r.scope).toBe('unknown');
    expect([r.low, r.cost, r.high]).toEqual([30000, 50000, 75000]);
  });
  it('an occupied, rent-producing building with no condition notes gets no rehab', () => {
    const r = estimateRehab('Nice brick building, fully leased', 1000, { occupied: true });
    expect([r.low, r.cost, r.high]).toEqual([0, 0, 30000]);
    expect(estimateRehab('Needs work, fully leased', 1000, { occupied: true }).cost).toBe(50000);
  });
});
