import { test, expect } from '@playwright/test';
import { generateProductStorageZPL } from '../src/lib/zpl';
import { LABEL_SIZE_PRESETS, LABEL_CONSTRAINTS } from '../src/types/labeling';

/**
 * The shelf label — "this is what belongs here".
 *
 * 90 × 60 mm on a Zebra ZD421 at 203 dpi = 720 × 480 dots. The rules that matter
 * to the person holding a sticker roll, pinned so a later tweak can't quietly
 * break them.
 */

const SIZE = { widthMm: 90, heightMm: 60 };
const FULL = {
  productName: 'Thymian, frisch',
  barcodeValue: 'KRW-1546',
  locationLabel: 'WAJ Kitchen › Countertop fridge › D4',
  locationCode: 'KWLOC-38',
  uom: 'kg',
};

/** Every ^FOx,y in the order they are drawn. */
function positions(zpl: string): { x: number; y: number }[] {
  return Array.from(zpl.matchAll(/\^FO(\d+),(\d+)/g)).map((m) => ({ x: +m[1], y: +m[2] }));
}
/** The ^A0N,height,width of the FIRST text field — the product name. */
function nameHeight(zpl: string): number {
  const m = zpl.match(/\^A0N,(\d+),\d+/);
  return m ? +m[1] : 0;
}

test('the 90x60 shelf preset exists and fits the print head', () => {
  const p = LABEL_SIZE_PRESETS.find((s) => s.id === '90x60');
  expect(p, 'the shelf size must be pickable').toBeTruthy();
  expect(p!.widthMm).toBe(90);
  expect(p!.heightMm).toBe(60);
  expect(p!.widthMm).toBeLessThanOrEqual(LABEL_CONSTRAINTS.maxWidthMm);
});

test('a full label carries all four things Ethan asked for', () => {
  const z = generateProductStorageZPL(FULL, SIZE);
  expect(z, 'product name').toContain('Thymian, frisch');
  expect(z, 'the product barcode, as bars').toMatch(/\^BCN,\d+/);
  expect(z, 'and as readable text').toContain('KRW-1546');
  expect(z, 'the location in full').toContain('WAJ Kitchen');
  expect(z, 'down to the drawer').toContain('D4');
  expect(z, "the shelf's own code as a QR").toMatch(/\^BQN,2,\d+\^FDQA,KWLOC-38/);
  expect(z.startsWith('^XA') && z.trim().endsWith('^XZ')).toBe(true);
});

test('THE POINT: the name is the biggest thing on the label', () => {
  const z = generateProductStorageZPL(FULL, SIZE);
  const heights = Array.from(z.matchAll(/\^A0N,(\d+),\d+/g)).map((m) => +m[1]);
  expect(nameHeight(z), 'the name is drawn first').toBe(Math.max(...heights));
  // ~10mm per line at 203dpi — big enough to read across a kitchen. It cannot go
  // much higher: at 22% the barcode had no room left and silently disappeared,
  // so this floor and the barcode's floor below are the two ends of one trade.
  expect(nameHeight(z), 'the name must stay large').toBeGreaterThanOrEqual(9 * 8);
});

test('a long name steps DOWN a size instead of pushing the barcode off', () => {
  const long = generateProductStorageZPL(
    { ...FULL, productName: 'Original Buns L (Bekarei) extra large' }, SIZE);
  expect(nameHeight(long)).toBeLessThan(nameHeight(generateProductStorageZPL(FULL, SIZE)));
  expect(long, 'the barcode survives').toMatch(/\^BCN,\d+/);
});

test('everything stays inside the label', () => {
  const z = generateProductStorageZPL(FULL, SIZE);
  const wDots = 90 * 8, hDots = 60 * 8;
  for (const p of positions(z)) {
    expect(p.x, `x ${p.x} is off the label`).toBeLessThan(wDots);
    expect(p.y, `y ${p.y} is off the label`).toBeLessThan(hDots);
  }
  expect(z).toContain(`^PW${wDots}`);
  expect(z).toContain(`^LL${hDots}`);
});

test('the barcode is scannably tall — between 8mm and 18mm', () => {
  const h = +generateProductStorageZPL(FULL, SIZE).match(/\^BCN,(\d+)/)![1];
  expect(h).toBeGreaterThanOrEqual(8 * 8);
  expect(h).toBeLessThanOrEqual(18 * 8);
});

test('a narrow label drops to ^BY1 rather than print a chopped barcode', () => {
  const narrow = generateProductStorageZPL(
    { ...FULL, barcodeValue: 'KRW-1234567890123456' }, { widthMm: 48, heightMm: 60 });
  expect(narrow).toMatch(/\^BY1\^BCN/);
});

test('no barcode yet says so, instead of leaving a silent gap', () => {
  const z = generateProductStorageZPL({ ...FULL, barcodeValue: null }, SIZE);
  expect(z).toContain('No barcode yet');
  expect(z, 'and prints no bars at all').not.toMatch(/\^BCN,\d+/);
});

test('no storage place yet says so too — the label still prints', () => {
  const z = generateProductStorageZPL(
    { ...FULL, locationLabel: null, locationCode: null }, SIZE);
  expect(z).toContain('No storage place set');
  expect(z, 'no shelf QR when there is no shelf').not.toMatch(/\^BQN/);
  expect(z, 'but the product is still labelled').toContain('Thymian, frisch');
});

test('the barcode sits in the SAME place whether the name is one line or two', () => {
  const oneLine = generateProductStorageZPL({ ...FULL, productName: 'Salt' }, SIZE);
  const twoLine = generateProductStorageZPL({ ...FULL, productName: 'Thymian, frisch' }, SIZE);
  const barY = (z: string) => positions(z)[
    z.split('\n').findIndex((l) => l.includes('^BCN'))
  ];
  expect(barY(oneLine)?.y, 'a batch of stickers must look identical').toBe(barY(twoLine)?.y);
});

test('the printed-on stamp appears only when asked for', () => {
  expect(generateProductStorageZPL(FULL, SIZE)).not.toContain('04.08.2026');
  expect(generateProductStorageZPL({ ...FULL, printedOn: '04.08.2026' }, SIZE))
    .toContain('04.08.2026');
});

test('a 300dpi printer scales everything, not just the page', () => {
  const at203 = generateProductStorageZPL(FULL, SIZE);
  const at300 = generateProductStorageZPL(FULL, { ...SIZE, dpi: 300 });
  expect(+at300.match(/\^PW(\d+)/)![1]).toBeGreaterThan(+at203.match(/\^PW(\d+)/)![1]);
  expect(nameHeight(at300), 'text must grow with the page or it prints tiny')
    .toBeGreaterThan(nameHeight(at203));
});

test('ZPL control characters in a product name cannot break the label', () => {
  const z = generateProductStorageZPL({ ...FULL, productName: 'Caret ^ and tilde ~ sauce' }, SIZE);
  const body = z.split('\n').filter((l) => l.includes('Caret')).join('');
  expect(body, 'a raw ^ would end the field early').not.toMatch(/\^FDCaret \^ /);
});
