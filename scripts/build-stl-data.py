#!/usr/bin/env python3
"""
Build the St. Louis City comps data bundled with Dealwise.

Sources (City of St. Louis open data, public):
  - Assessor sales history (2009–present):  ASSESSOR/sales_history.zip
  - Assessor parcels (shapefile .dbf):        ASSESSOR/PARCELS.zip

Outputs (shared/data/):
  - stl-sales.json    recent residential sales usable as comps
  - stl-parcels.json  per-parcel facts: neighborhoods, units, building area, year built, address

Usage:  python3 scripts/build-stl-data.py [download_dir]
Re-run whenever the city publishes new sales (the 2026 file is updated through the year).
"""
import csv, io, json, os, re, struct, sys, urllib.request, zipfile
from datetime import date

BASE = 'https://static.stlouis-mo.gov/open-data/ASSESSOR'
OUT = os.path.join(os.path.dirname(__file__), '..', 'shared', 'data')
DL = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '.data-cache')
RECENT_MONTHS = 36

# Sales the comps can use. Rehabbed sales are the best ARV evidence.
SALE_TYPES = {
    'Improved, open market, arms length': 'arms',
    'Bldg. Rehabbed prior to sale': 'rehab',
    'As-Is Open Market': 'asis',
}
# Property type by unit count.
OCCUPANCY_UNITS = {
    'Single Family Units': 1,
    'Townhouse': 1,
    'Two Family Unit': 2,
    'Three Family Unit': 3,
    'Four Family Unit': 4,
    'Multi-Family Residential': 5,
}
MONTHS = {m: i + 1 for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])}


def fetch(name):
    os.makedirs(DL, exist_ok=True)
    path = os.path.join(DL, name)
    if not os.path.exists(path):
        print('downloading', name)
        urllib.request.urlretrieve(f'{BASE}/{name}', path)
    return path


def parse_date(s):
    # "Sun Nov 30 2025 18:00:00 GMT-0600 (...)" or "11/30/2025"
    m = re.match(r'\w{3} (\w{3}) (\d{1,2}) (\d{4})', s or '')
    if m:
        return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})', s or '')
    if m:
        return date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    return None


def dbf_rows(data, want):
    h = data[:32]
    n = struct.unpack('<I', h[4:8])[0]
    hl = struct.unpack('<H', h[8:10])[0]
    rl = struct.unpack('<H', h[10:12])[0]
    fields, off, pos = {}, 1, 32
    while data[pos] != 0x0D:
        d = data[pos:pos + 32]
        name = d[:11].split(b'\0')[0].decode()
        if name in want:
            fields[name] = (off, d[16])
        off += d[16]
        pos += 32
    for i in range(n):
        r = data[hl + i * rl: hl + (i + 1) * rl]
        if not r or r[:1] == b'*':
            continue
        row = {k: r[o:o + l].decode('latin1').strip() for k, (o, l) in fields.items()}
        row['_i'] = i
        yield row


def shp_centers(data):
    """Record index → (x, y) bounding-box center, in Missouri East State Plane feet."""
    out, pos, i = {}, 100, 0
    while pos + 8 <= len(data):
        _, clen = struct.unpack('>2i', data[pos:pos + 8])
        st = struct.unpack('<i', data[pos + 8:pos + 12])[0]
        if st != 0:
            x0, y0, x1, y1 = struct.unpack('<4d', data[pos + 12:pos + 44])
            out[i] = (round((x0 + x1) / 2), round((y0 + y1) / 2))
        pos += 8 + clen * 2
        i += 1
    return out


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def main():
    sales_zip = zipfile.ZipFile(fetch('sales_history.zip'))
    parcels_zip = zipfile.ZipFile(fetch('PARCELS.zip'))

    parcels = {}
    want = {'ParcelId', 'SITEADDR', 'ASRNBRHD', 'NBRHD', 'NbrOfUnits', 'LastYearBu'}
    centers = shp_centers(parcels_zip.read('Parcels.shp'))
    for r in dbf_rows(parcels_zip.read('Parcels.dbf'), want):
        pid = r['ParcelId']
        if pid:
            r['xy'] = centers.get(r['_i'])
            parcels[pid] = r

    sales, area = [], {}
    for info in sorted(sales_zip.infolist(), key=lambda i: i.filename):
        if not info.filename.endswith('.csv'):
            continue
        with sales_zip.open(info) as fh:
            for s in csv.DictReader(io.TextIOWrapper(fh, encoding='latin1')):
                pid = s.get('ParcelNumber', '')
                a = num(s.get('TotalArea'))
                if pid and a > 0:
                    area[pid] = a  # later files overwrite earlier: latest known building area
                sales.append(s)

    latest = max(d for d in (parse_date(s.get('SalesDate')) for s in sales) if d)
    cutoff = date(latest.year - RECENT_MONTHS // 12, latest.month, 1)

    comps = []
    for s in sales:
        kind = SALE_TYPES.get(s.get('SalesTransactionType', ''))
        units = OCCUPANCY_UNITS.get(s.get('Occupancy', ''))
        d = parse_date(s.get('SalesDate'))
        price = num(s.get('SalesPrice'))
        p = parcels.get(s.get('ParcelNumber', ''))
        if not (kind and units and d and d >= cutoff and price >= 10000 and p):
            continue
        comps.append([
            s['ParcelNumber'],
            re.sub(r'\s+', ' ', p['SITEADDR']).title(),
            p['ASRNBRHD'],
            p['NBRHD'],
            units,
            int(num(s.get('TotalArea'))),
            int(price),
            d.isoformat(),
            kind,
            int(num(s.get('YearBuilt'))) or None,
            *(p['xy'] or (None, None)),
        ])

    parcel_out = {}
    for pid, p in parcels.items():
        units = int(num(p['NbrOfUnits']))
        if units < 1:
            continue
        parcel_out[pid] = [
            re.sub(r'\s+', ' ', p['SITEADDR']).upper(),
            p['ASRNBRHD'],
            p['NBRHD'],
            units,
            int(area.get(pid, 0)),
            int(num(p['LastYearBu'])) or None,
            *(p['xy'] or (None, None)),
        ]

    os.makedirs(OUT, exist_ok=True)
    meta = {'source': 'City of St. Louis Assessor open data', 'latestSale': latest.isoformat(), 'built': date.today().isoformat()}
    with open(os.path.join(OUT, 'stl-sales.json'), 'w') as f:
        json.dump({'meta': meta, 'fields': ['parcelId', 'address', 'asrNbhd', 'nbhd', 'units', 'area', 'price', 'date', 'kind', 'yearBuilt', 'x', 'y'], 'rows': comps}, f, separators=(',', ':'))
    with open(os.path.join(OUT, 'stl-parcels.json'), 'w') as f:
        json.dump({'meta': meta, 'fields': ['address', 'asrNbhd', 'nbhd', 'units', 'area', 'yearBuilt', 'x', 'y'], 'rows': parcel_out}, f, separators=(',', ':'))
    print(f'{len(comps)} comp sales since {cutoff}, latest {latest}; {len(parcel_out)} parcels ({sum(1 for v in parcel_out.values() if v[4])} with building area)')


if __name__ == '__main__':
    main()
