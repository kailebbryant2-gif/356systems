import { describe, expect, it } from 'vitest';
import { parseStlParcel } from '../shared/sources/stlCity';

// Visible text of a City of St. Louis parcel page (owner name removed).
const text = `Basic Info Primary address 3520 WYOMING ST ST LOUIS MO 63118 Parcel ID 1488-9-070.000 Collector of Revenue account 1488-00-00700 Neighborhood 25 - Tower Grove East Property Class RESIDENTIAL Tax Abatement This property is not abated Property description C.B. 1488 WYOMING ST Units Property class RESIDENTIAL Zoning B - Two Family Residential Redevelopment code N/A Vacant lot No Current 2026 Assessed Values Residential Land $1,580.00 Residential improvements $28,160.00 Assessed total $29,740.00 Appraised total $156,511.00 Year built 1906 Images No images found Parcel Information Condominium No Number of units 1.00 Frontage 33.00 feet Real Estate Tax Summary Data provided by Collector of Revenue Tax Year Special Business District Tax Lateral Sewer Fee Commercial Surtax Total Original Tax Amount Paid Balance Action 2025 $0.00 $28.00 $0.00 $2,297.48 $2,297.48 $0.00 Print Receipt 2024 $0.00 $28.00 $0.00 $1,534.76 $1,534.76 $0.00`;

describe('City of St. Louis parcel record', () => {
  it('reads the latest tax bill, units and values', () => {
    expect(parseStlParcel(text)).toEqual({
      parcelId: '1488-9-070.000',
      units: 1,
      annualTax: 2297.48,
      taxYear: 2025,
      assessedTotal: 29740,
      appraisedTotal: 156511,
      abated: false,
      zoning: 'B - Two Family Residential',
      yearBuilt: 1906,
    });
  });

  it('detects an abated parcel', () => {
    expect(parseStlParcel(text.replace('This property is not abated', 'This property is abated through 2031'))!.abated).toBe(true);
  });

  it('returns null for a page without a parcel', () => {
    expect(parseStlParcel('No results found')).toBeNull();
  });
});
