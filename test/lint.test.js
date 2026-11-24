'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lintCsv, parseCsv, isValidGtin, formatText, formatJson, formatMarkdown, RULES } = require('../src/index');

const HEADER = 'Handle,Title,Body (HTML),Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Inventory Tracker,Variant Inventory Qty,Variant Price,Variant Compare At Price,Variant Barcode,Image Src,Image Position,Image Alt Text,Variant Image,Status,Tags';
// Build a row from a partial object so each test names only the cells it cares about.
const COLS = HEADER.split(',');
const row = (cells) => COLS.map((c) => {
  const v = cells[c] ?? '';
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(',');
const csv = (...rows) => [HEADER, ...rows.map(row)].join('\n');
const rules = (result) => result.issues.map((i) => i.rule);
const first = { Handle: 'tee', Title: 'Tee', 'Body (HTML)': '<p>x</p>', 'Variant Price': '10.00' };

test('parser: quotes, embedded newlines, CRLF, BOM and line numbers', () => {
  const { records } = parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\nz,"q""uote"\r\n');
  assert.deepEqual(records.map((r) => r.fields), [['a', 'b'], ['x, y', 'line1\nline2'], ['z', 'q"uote']]);
  assert.deepEqual(records.map((r) => r.line), [1, 2, 4]);
});

test('parser: reports an unterminated quote', () => {
  assert.equal(parseCsv('a,b\n"open,1\n2,3\n').unterminatedQuoteLine, 2);
});

test('gtin: valid and invalid check digits', () => {
  assert.equal(isValidGtin('4006381333931'), true);
  assert.equal(isValidGtin('036000291452'), true);
  assert.equal(isValidGtin('96385074'), true);
  assert.equal(isValidGtin('4006381333932'), false);
  assert.equal(isValidGtin('12345'), false);
});

test('a clean product raises no errors or warnings', () => {
  const r = lintCsv(csv({ ...first, 'Image Src': 'https://x.test/a.jpg', 'Image Alt Text': 'Tee', 'Image Position': '1' }));
  assert.deepEqual(r.issues.filter((i) => i.severity !== 'info'), []);
  assert.equal(r.stats.products, 1);
  assert.equal(r.stats.variants, 1);
});

test('shipped good.csv has no errors or warnings; bad.csv has both', () => {
  const dir = path.join(__dirname, '..', 'examples');
  const good = lintCsv(fs.readFileSync(path.join(dir, 'good.csv'), 'utf8'));
  assert.deepEqual(good.issues.filter((i) => i.severity !== 'info'), []);
  const bad = lintCsv(fs.readFileSync(path.join(dir, 'bad.csv'), 'utf8'));
  assert.ok(bad.issues.some((i) => i.severity === 'error'));
  assert.ok(bad.issues.some((i) => i.severity === 'warning'));
});

test('header: missing required columns, duplicates, typos and extras', () => {
  const r = lintCsv('Handle,Variant Pricce,Variant Price,Variant Price,Internal Notes\nx,1,2,3,n\n');
  assert.ok(rules(r).includes('missing-column'));
  assert.ok(rules(r).includes('duplicate-column'));
  const typo = r.issues.find((i) => i.rule === 'unknown-column');
  assert.match(typo.message, /Did you mean "Variant Price"/);
  assert.ok(rules(r).includes('extra-column'));
});

test('header: metafield and Google Shopping columns are accepted', () => {
  const r = lintCsv('Handle,Title,Color (product.metafields.shopify.color-pattern),Google Shopping / Gender\nx,X,red,female\n');
  assert.ok(!rules(r).includes('extra-column'));
  assert.ok(!rules(r).includes('unknown-column'));
});

test('empty file and missing Handle column stop early', () => {
  assert.deepEqual(rules(lintCsv('')), ['missing-column']);
  assert.ok(lintCsv('Title\nX\n').issues.every((i) => i.rule === 'missing-column'));
});

test('rows: too wide, too narrow, missing handle', () => {
  const r = lintCsv('Handle,Title\na,b,c\nd\n,Orphan\n');
  const structural = ['missing-handle', 'row-too-narrow', 'row-too-wide'];
  assert.deepEqual(rules(r).filter((id) => structural.includes(id)).sort(), structural);
  assert.equal(r.issues.find((i) => i.rule === 'row-too-wide').line, 2);
  assert.equal(r.issues.find((i) => i.rule === 'missing-handle').line, 4);
});

test('encoding: replacement characters are flagged', () => {
  assert.ok(rules(lintCsv(csv({ ...first, Title: 'Caf�' }))).includes('encoding'));
});

test('handle: format, length and non-contiguous rows', () => {
  assert.ok(rules(lintCsv(csv({ ...first, Handle: 'Linen Shirt' }))).includes('handle-format'));
  assert.ok(!rules(lintCsv(csv({ ...first, Handle: 'lino-camisa-ñandú' }))).includes('handle-format'));
  assert.ok(rules(lintCsv(csv({ ...first, Handle: 'a'.repeat(256) }))).includes('handle-too-long'));
  const split = lintCsv(csv(
    { ...first, Handle: 'a' },
    { ...first, Handle: 'b' },
    { Handle: 'a', 'Variant Price': '5', 'Option1 Value': 'x' },
  ));
  assert.ok(rules(split).includes('non-contiguous-handle'));
});

test('product fields: title, status, booleans, tags, SEO', () => {
  const long = 'x'.repeat(256);
  const r = lintCsv(csv({
    ...first, Title: '', Status: 'live', Tags: Array.from({ length: 251 }, (_, i) => `t${i}`).join(','),
  }));
  assert.ok(rules(r).includes('missing-title'));
  assert.ok(rules(r).includes('invalid-status'));
  assert.ok(rules(r).includes('tags-too-many'));
  assert.ok(rules(lintCsv(csv({ ...first, Title: long }))).includes('title-too-long'));
  assert.ok(rules(lintCsv(csv({ ...first, Tags: long }))).includes('tag-too-long'));
  assert.ok(rules(lintCsv(csv({ ...first, 'Body (HTML)': '' }))).includes('missing-description'));
  const bool = lintCsv('Handle,Title,Published,Gift Card\nx,X,MAYBE,yes\n');
  assert.equal(rules(bool).filter((x) => x === 'invalid-boolean').length, 2);
});

test('variants: duplicates, missing option values, default title', () => {
  const dup = lintCsv(csv(
    { ...first, 'Option1 Name': 'Size', 'Option1 Value': 'S' },
    { Handle: 'tee', 'Option1 Value': 's', 'Variant Price': '10' },
  ));
  assert.ok(rules(dup).includes('duplicate-variant'));

  const missing = lintCsv(csv(
    { ...first, 'Option1 Name': 'Size', 'Option1 Value': 'S' },
    { Handle: 'tee', 'Variant Price': '10', 'Variant SKU': 'T2' },
  ));
  assert.ok(rules(missing).includes('option-value-missing'));

  const noOpts = lintCsv(csv(first, { Handle: 'tee', 'Variant Price': '10', 'Variant SKU': 'T2' }));
  assert.ok(rules(noOpts).includes('variant-without-options'));

  const nameless = lintCsv(csv({ ...first, 'Option1 Value': 'S' }));
  assert.ok(rules(nameless).includes('option-name-missing'));

  const mismatch = lintCsv(csv(
    { ...first, 'Option1 Name': 'Size', 'Option1 Value': 'S' },
    { Handle: 'tee', 'Option1 Name': 'Colour', 'Option1 Value': 'M', 'Variant Price': '10' },
  ));
  assert.ok(rules(mismatch).includes('option-name-mismatch'));

  const mixed = lintCsv(csv(
    { ...first, 'Option1 Name': 'Title', 'Option1 Value': 'Default Title' },
    { Handle: 'tee', 'Option1 Value': 'Big', 'Variant Price': '10' },
  ));
  assert.ok(rules(mixed).includes('default-title-mixed'));
});

test('variants: image-only rows are not counted as variants', () => {
  const r = lintCsv(csv(
    { ...first, 'Image Src': 'https://x.test/1.jpg', 'Image Alt Text': 'a', 'Image Position': '1' },
    { Handle: 'tee', 'Image Src': 'https://x.test/2.jpg', 'Image Alt Text': 'b', 'Image Position': '2' },
  ));
  assert.equal(r.stats.variants, 1);
  assert.deepEqual(r.issues.filter((i) => i.severity !== 'info'), []);
});

test('variants: too many, honouring --max-variants', () => {
  const rows = [{ ...first, 'Option1 Name': 'N', 'Option1 Value': 'v0' }];
  for (let i = 1; i < 5; i++) rows.push({ Handle: 'tee', 'Option1 Value': `v${i}`, 'Variant Price': '10' });
  assert.ok(!rules(lintCsv(csv(...rows))).includes('too-many-variants'));
  assert.ok(rules(lintCsv(csv(...rows), { maxVariants: 4 })).includes('too-many-variants'));
});

test('prices: missing, symbols, separators, negatives, compare-at', () => {
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant Price': '' }))).includes('price-missing'));
  const sym = lintCsv(csv({ ...first, 'Variant Price': '$19.99' }));
  assert.match(sym.issues.find((i) => i.rule === 'price-invalid').message, /currency symbol/);
  const thousands = lintCsv(csv({ ...first, 'Variant Price': '1,299.00' }));
  assert.match(thousands.issues.find((i) => i.rule === 'price-invalid').message, /thousands/);
  const comma = lintCsv(csv({ ...first, 'Variant Price': '12,50' }));
  assert.match(comma.issues.find((i) => i.rule === 'price-invalid').message, /decimal/);
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant Price': '-1' }))).includes('price-negative'));
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant Compare At Price': 'abc' }))).includes('compare-at-invalid'));
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant Compare At Price': '10.00' }))).includes('compare-at-not-higher'));
  assert.ok(!rules(lintCsv(csv({ ...first, 'Variant Compare At Price': '15.00' }))).includes('compare-at-not-higher'));
});

test('other numeric columns', () => {
  const r = lintCsv('Handle,Title,Variant Price,Variant Grams,Variant Weight Unit,Variant Inventory Qty,Variant Inventory Tracker,Variant Inventory Policy,Cost per item\nx,X,1,-5,stone,2.5,fedex,maybe,free\n');
  for (const id of ['grams-invalid', 'weight-unit-invalid', 'inventory-qty-invalid', 'inventory-tracker-invalid', 'inventory-policy-invalid', 'cost-invalid']) {
    assert.ok(rules(r).includes(id), id);
  }
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant Inventory Qty': '5' }))).includes('qty-without-tracker'));
  assert.ok(!rules(lintCsv(csv({ ...first, 'Variant Inventory Qty': '5', 'Variant Inventory Tracker': 'shopify' }))).includes('qty-without-tracker'));
});

test('sku and barcode: scientific notation, duplicates, checksum', () => {
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant SKU': '1.23457E+12' }))).includes('scientific-notation'));
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant Barcode': '4.00638E+12' }))).includes('scientific-notation'));
  const dup = lintCsv(csv(
    { ...first, 'Variant SKU': 'ABC' },
    { ...first, Handle: 'other', 'Variant SKU': 'abc' },
  ));
  assert.ok(rules(dup).includes('sku-duplicate'));
  assert.ok(rules(lintCsv(csv({ ...first, 'Variant Barcode': '4006381333932' }))).includes('barcode-checksum'));
  assert.ok(!rules(lintCsv(csv({ ...first, 'Variant Barcode': "'4006381333931" }))).includes('barcode-checksum'));
  assert.ok(!rules(lintCsv(csv({ ...first, 'Variant Barcode': 'ISBN-ABC-1' }))).includes('barcode-checksum'));
});

test('images: url, position, duplicate position, alt text, variant image', () => {
  const r = lintCsv(csv(
    { ...first, 'Image Src': 'not-a-url', 'Image Position': '0' },
    { Handle: 'tee', 'Image Src': 'https://x.test/1.jpg', 'Image Position': '2', 'Image Alt Text': 'a' },
    { Handle: 'tee', 'Image Src': 'https://x.test/2.jpg', 'Image Position': '2', 'Image Alt Text': 'b', 'Variant Image': 'https://x.test/other.jpg' },
  ));
  for (const id of ['image-url-invalid', 'image-position-invalid', 'image-position-duplicate', 'image-alt-missing', 'variant-image-unlisted']) {
    assert.ok(rules(r).includes(id), id);
  }
  const listed = lintCsv(csv(
    { ...first, 'Image Src': 'https://x.test/1.jpg', 'Image Alt Text': 'a', 'Image Position': '1', 'Variant Image': 'https://x.test/1.jpg' },
  ));
  assert.ok(!rules(listed).includes('variant-image-unlisted'));
});

test('seo lengths', () => {
  const r = lintCsv('Handle,Title,SEO Title,SEO Description\nx,X,' + 'a'.repeat(71) + ',' + 'b'.repeat(321) + '\n');
  assert.ok(rules(r).includes('seo-title-long'));
  assert.ok(rules(r).includes('seo-description-long'));
});

test('unterminated quote is reported with its line', () => {
  const r = lintCsv('Handle,Title\nx,"oops\ny,Z\n');
  const issue = r.issues.find((i) => i.rule === 'unterminated-quote');
  assert.equal(issue.line, 2);
});

test('ignore option removes a rule', () => {
  const r = lintCsv(csv({ ...first, 'Body (HTML)': '' }), { ignore: ['missing-description'] });
  assert.ok(!rules(r).includes('missing-description'));
});

test('every emitted rule id exists in the rule table, and has severity + description', () => {
  for (const [id, [sev, desc]] of Object.entries(RULES)) {
    assert.ok(['error', 'warning', 'info'].includes(sev), id);
    assert.ok(desc.length > 10, id);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lint.js'), 'utf8');
  const used = new Set([...src.matchAll(/add\('([a-z-]+)'/g)].map((m) => m[1]));
  for (const id of used) assert.ok(RULES[id], `lint.js emits unknown rule ${id}`);
  for (const id of Object.keys(RULES)) assert.ok(used.has(id), `rule ${id} is never emitted`);
});

test('formatters render text, json and markdown', () => {
  const result = lintCsv(csv({ ...first, 'Variant Price': 'abc' }));
  assert.match(formatText('f.csv', result), /\[price-invalid\]/);
  assert.equal(JSON.parse(formatJson('f.csv', result)).counts.error, 1);
  assert.match(formatMarkdown('f.csv', result), /\| error \| 2 \| `price-invalid` \|/);
  assert.doesNotMatch(formatText('f.csv', result, { minSeverity: 'error' }), /missing-description/);
});

test('cli: exit codes and stdin', () => {
  const bin = path.join(__dirname, '..', 'bin', 'spcl.js');
  const dir = path.join(__dirname, '..', 'examples');
  const run = (args, input) => spawnSync(process.execPath, [bin, ...args], { input, encoding: 'utf8' });

  assert.equal(run(['lint', path.join(dir, 'good.csv')]).status, 0);
  const bad = run(['lint', path.join(dir, 'bad.csv')]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /error/);
  assert.equal(run(['lint', '-', '--format', 'json'], csv(first)).status, 0);
  assert.equal(run(['lint', path.join(dir, 'missing.csv')]).status, 2);
  assert.equal(run(['lint', path.join(dir, 'good.csv'), '--ignore', 'nope']).status, 2);
  assert.equal(run(['lint', '-', '--strict'], csv({ ...first, 'Variant Price': '' })).status, 1);
  assert.equal(run(['lint', '-'], csv({ ...first, 'Variant Price': '' })).status, 0);
  assert.match(run(['rules']).stdout, /duplicate-variant/);
});
