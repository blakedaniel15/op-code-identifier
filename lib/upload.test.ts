import { dealerNameFromFilename, storeIdFromDealer, pickUploadColumns, extractRows } from './upload';

// The real 50-column Singing River / Deacon Jones export header (trimmed to what matters).
const HEADERS = [
  'Dealer ID', 'Team Name', 'Customer Number', 'Op Code', 'Operations Line Number',
  'Operations Cwi', 'Operations Description', 'Service Name', 'Advisor Name', 'Advisor Number',
  'Tech Name', 'Tech Number', 'Repair Order Number', 'Repair Order Open Date', 'Repair Order Close Date',
  'Repair Order Mileage', 'Vehicle Make', 'Vehicle Model', 'Vehicle Vin Number', 'Vehicle Year',
  'Labor Cost', 'Labor Sale', 'Tech Hours', 'Parts Cost', 'Parts Sale',
];

test('dealerNameFromFilename strips extension + export suffix and title-cases', () => {
  expect(dealerNameFromFilename('singing_river_cdjr_raw_data_2026_06_01_to_2026_06_30.csv'))
    .toBe('Singing River Cdjr');
  expect(dealerNameFromFilename('Deacon Jones.csv')).toBe('Deacon Jones');
});

test('storeIdFromDealer slugs to UPPER-KEBAB regardless of casing', () => {
  expect(storeIdFromDealer('Singing River CDJR')).toBe('SINGING-RIVER-CDJR');
  expect(storeIdFromDealer('Singing River Cdjr')).toBe('SINGING-RIVER-CDJR');
  expect(storeIdFromDealer('  Toyota of Gallatin! ')).toBe('TOYOTA-OF-GALLATIN');
});

test('pickUploadColumns finds the four columns in the real header set', () => {
  expect(pickUploadColumns(HEADERS)).toEqual({ opCode: 3, opDescription: 6, laborSale: 21, techHours: 22 });
});

test('pickUploadColumns returns null when there is no op-code column', () => {
  expect(pickUploadColumns(['Team Name', 'Service Name'])).toBeNull();
});

test('extractRows keeps only the four fields and drops blank-op-code rows', () => {
  const cols = pickUploadColumns(HEADERS)!;
  const row = new Array(25).fill('');
  row[1] = 'Singing River CDJR'; row[3] = '90'; row[6] = 'MULTI-POINT INSPECTION';
  row[18] = '2C3CDZAGXHH548679'; row[21] = '$0.00'; row[22] = '0.00';
  const blank = new Array(25).fill(''); blank[6] = 'ORPHAN DESCRIPTION';
  expect(extractRows([row, blank], cols)).toEqual([
    { opCode: '90', opDescription: 'MULTI-POINT INSPECTION', laborSale: '$0.00', techHours: '0.00' },
  ]);
});
