import { test, expect } from '@playwright/test';
import { buildImagesHtml } from '../src/lib/purchase-note-pdf';

test('buildImagesHtml renders one page per image, in order', () => {
  const html = buildImagesHtml([
    'data:image/png;base64,AAA',
    'data:image/jpeg;base64,BBB',
  ]);
  expect((html.match(/<img /g) || []).length).toBe(2);
  expect(html.indexOf('AAA')).toBeLessThan(html.indexOf('BBB'));
  expect(html).toContain('page-break-after');
});

test('buildImagesHtml handles a single image', () => {
  const html = buildImagesHtml(['data:image/jpeg;base64,ZZZ']);
  expect((html.match(/<img /g) || []).length).toBe(1);
  expect(html).toContain('ZZZ');
});
