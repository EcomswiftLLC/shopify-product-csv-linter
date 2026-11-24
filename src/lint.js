'use strict';

const { parseCsv } = require('./csv');
const { defaultSeverity } = require('./rules');
const { isValidGtin } = require('./gtin');

/** Columns in Shopify's product CSV template (current and older names). */
const KNOWN_COLUMNS = [
  'Handle', 'Title', 'Body (HTML)', 'Body HTML', 'Vendor', 'Product Category', 'Type', 'Tags', 'Published',
  'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value', 'Option3 Name', 'Option3 Value',
  'Variant SKU', 'Variant Grams', 'Variant Inventory Tracker', 'Variant Inventory Qty',
  'Variant Inventory Policy', 'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
  'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode', 'Image Src', 'Image Position',
  'Image Alt Text', 'Gift Card', 'SEO Title', 'SEO Description', 'Variant Image', 'Variant Weight Unit',
  'Variant Tax Code', 'Cost per item', 'Status',
];
const KNOWN_LOWER = new Map(KNOWN_COLUMNS.map((c) => [c.toLowerCase(), c]));
// "Google Shopping / Gender", "Color (product.metafields.shopify.color-pattern)", ...
const KNOWN_PATTERNS = [/^google shopping \/ /i, /\((product|variant)\.metafields\.[^)]+\)\s*$/i];

const REQUIRED_COLUMNS = ['Handle', 'Title'];
const NUMBER = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;
const SCI = /^\d+(\.\d+)?e\+?\d+$/i;
const HTTP_URL = /^https?:\/\/\S+$/i;

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

function closestKnown(header) {
  const h = header.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const col of KNOWN_COLUMNS) {
    const d = levenshtein(h, col.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = col;
    }
  }
  return bestDist <= 2 ? best : null;
}

function describeBadNumber(value) {
  if (/[$€£¥]/.test(value)) return 'remove the currency symbol';
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) return 'remove the thousands separator';
  if (/^\d+,\d+$/.test(value)) return 'use a dot, not a comma, as the decimal separator';
  return 'use digits and an optional decimal point only, e.g. 19.99';
}

/**
 * Lint the text of a Shopify product import CSV.
 *
 * @param {string} text  file contents
 * @param {object} [options]
 * @param {number} [options.maxVariants=100]  warn above this many variants per product
 * @param {string[]} [options.ignore=[]]      rule ids to skip
 * @returns {{issues: object[], stats: object}}
 */
function lintCsv(text, options = {}) {
  const opts = { maxVariants: 100, ignore: [], ...options };
  const issues = [];
  const add = (rule, line, message, extra = {}) => {
    if (opts.ignore.includes(rule)) return;
    issues.push({ rule, severity: defaultSeverity(rule), line, message, ...extra });
  };
  const stats = { rows: 0, products: 0, variants: 0, images: 0 };

  if (String(text).includes('�')) {
    add('encoding', 1, 'The file contains U+FFFD replacement characters. Re-save it as UTF-8 from your spreadsheet app.');
  }

  const parsed = parseCsv(text);
  if (parsed.unterminatedQuoteLine) {
    add('unterminated-quote', parsed.unterminatedQuoteLine, 'A quoted field opened here is never closed; every row after it would be read as part of one cell.');
  }
  if (parsed.records.length === 0) {
    if (!parsed.unterminatedQuoteLine) add('missing-column', 1, 'The file is empty: there is no header row.');
    return { issues: sortIssues(issues), stats };
  }

  // ---- header row ----
  const headerRecord = parsed.records[0];
  const headers = headerRecord.fields.map((h) => h.trim());
  const index = new Map(); // canonical lower name -> column index
  headers.forEach((h, i) => {
    const key = h.toLowerCase();
    if (KNOWN_LOWER.has(key)) {
      if (index.has(key)) {
        add('duplicate-column', headerRecord.line, `Column "${h}" appears twice (columns ${index.get(key) + 1} and ${i + 1}).`, { column: h });
      } else {
        index.set(key, i);
      }
    } else if (!KNOWN_PATTERNS.some((p) => p.test(h)) && h !== '') {
      const guess = closestKnown(h);
      if (guess) {
        add('unknown-column', headerRecord.line, `Column "${h}" is not a Shopify column. Did you mean "${guess}"?`, { column: h });
      } else {
        add('extra-column', headerRecord.line, `Column "${h}" is not in Shopify's product CSV template and will be ignored.`, { column: h });
      }
    }
  });
  if (index.has('body html') && !index.has('body (html)')) index.set('body (html)', index.get('body html'));

  const missingRequired = REQUIRED_COLUMNS.filter((c) => !index.has(c.toLowerCase()));
  for (const c of missingRequired) {
    add('missing-column', headerRecord.line, `Required column "${c}" is missing from the header row.`, { column: c });
  }
  if (!index.has('handle')) return { issues: sortIssues(issues), stats };

  // ---- data rows ----
  const products = new Map();
  const skuSeen = new Map();
  let lastHandle = null;

  for (const record of parsed.records.slice(1)) {
    const fields = record.fields;
    const line = record.line;
    if (fields.every((f) => f.trim() === '')) continue;
    stats.rows++;

    if (fields.length > headers.length) {
      add('row-too-wide', line, `Row has ${fields.length} cells but the header has ${headers.length}. An unquoted comma in a value is the usual cause.`);
    } else if (fields.length < headers.length) {
      add('row-too-narrow', line, `Row has ${fields.length} cells but the header has ${headers.length}.`);
    }

    const get = (name) => {
      const i = index.get(name.toLowerCase());
      return i === undefined ? '' : (fields[i] || '').trim();
    };

    const handle = get('Handle');
    if (!handle) {
      add('missing-handle', line, 'Row has data but an empty Handle.');
      continue;
    }

    const isFirst = !products.has(handle);
    if (isFirst) {
      products.set(handle, {
        handle, firstLine: line, optionNames: ['', '', ''], variantKeys: new Map(), variantCount: 0,
        hasDefaultTitle: false, imagePositions: new Map(), imageSrcs: new Set(), variantImages: [], reportedSplit: false,
      });
      stats.products++;
      checkHandle(handle, line, add);
    } else if (handle !== lastHandle && !products.get(handle).reportedSplit) {
      products.get(handle).reportedSplit = true;
      add('non-contiguous-handle', line, `Rows for "${handle}" continue here after rows of another product (first seen on line ${products.get(handle).firstLine}). Keep each product's rows together.`, { handle });
    }
    lastHandle = handle;
    const product = products.get(handle);
    const ctx = { handle, line };

    if (isFirst) checkProductFields(get, add, ctx);
    checkBooleans(get, add, ctx);

    // --- options and variants ---
    const names = [get('Option1 Name'), get('Option2 Name'), get('Option3 Name')];
    const vals = [get('Option1 Value'), get('Option2 Value'), get('Option3 Value')];
    if (isFirst) {
      product.optionNames = names;
    } else {
      names.forEach((n, i) => {
        if (n && n.toLowerCase() !== product.optionNames[i].toLowerCase()) {
          const first = product.optionNames[i];
          add('option-name-mismatch', line, `Option${i + 1} Name is "${n}" here but ${first ? `"${first}"` : 'blank'} on the product's first row; only the first row's name is used.`, ctx);
        }
      });
    }
    const defined = [0, 1, 2].filter((i) => product.optionNames[i]);
    vals.forEach((v, i) => {
      if (v && !product.optionNames[i]) {
        add('option-name-missing', line, `Option${i + 1} Value "${v}" has no Option${i + 1} Name on the product's first row.`, ctx);
      }
    });

    const variantFields = ['Variant SKU', 'Variant Price', 'Variant Grams', 'Variant Inventory Qty', 'Variant Compare At Price', 'Variant Barcode'];
    const hasVariantData = vals.some(Boolean) || variantFields.some((f) => get(f));
    const isVariantRow = isFirst || hasVariantData;

    if (isVariantRow) {
      product.variantCount++;
      stats.variants++;
      if (!isFirst && defined.length === 0) {
        add('variant-without-options', line, 'This row adds a variant but the product defines no Option1 Name. Add option names on the first row or remove the row.', ctx);
      }
      for (const i of defined) {
        if (!vals[i]) add('option-value-missing', line, `Variant has no value for ${product.optionNames[i]} (Option${i + 1} Value).`, ctx);
      }
      if (defined.length > 0 && defined.every((i) => vals[i])) {
        const key = defined.map((i) => vals[i].toLowerCase()).join('\u0001');
        if (product.variantKeys.has(key)) {
          add('duplicate-variant', line, `Duplicate variant "${defined.map((i) => vals[i]).join(' / ')}" (same as line ${product.variantKeys.get(key)}).`, ctx);
        } else {
          product.variantKeys.set(key, line);
        }
      }
      if (vals[0].toLowerCase() === 'default title') product.hasDefaultTitle = true;
      checkVariantFields(get, add, ctx, skuSeen);
    }

    // --- images ---
    const src = get('Image Src');
    const pos = get('Image Position');
    if (src) {
      stats.images++;
      if (!HTTP_URL.test(src)) {
        add('image-url-invalid', line, `Image Src "${truncate(src)}" is not an http(s) URL. Shopify fetches images from public URLs.`, { ...ctx, column: 'Image Src' });
      } else {
        product.imageSrcs.add(src);
      }
      if (!get('Image Alt Text')) add('image-alt-missing', line, 'Image has no Image Alt Text.', { ...ctx, column: 'Image Alt Text' });
    }
    if (pos) {
      if (!/^[1-9]\d*$/.test(pos)) {
        add('image-position-invalid', line, `Image Position "${pos}" is not a positive whole number.`, { ...ctx, column: 'Image Position' });
      } else if (product.imagePositions.has(pos)) {
        add('image-position-duplicate', line, `Image Position ${pos} is already used on line ${product.imagePositions.get(pos)}.`, { ...ctx, column: 'Image Position' });
      } else {
        product.imagePositions.set(pos, line);
      }
    }
    const variantImage = get('Variant Image');
    if (variantImage) {
      if (!HTTP_URL.test(variantImage)) {
        add('image-url-invalid', line, `Variant Image "${truncate(variantImage)}" is not an http(s) URL.`, { ...ctx, column: 'Variant Image' });
      } else {
        product.variantImages.push({ line, url: variantImage });
      }
    }
  }

  // ---- per-product checks that need the whole product ----
  for (const p of products.values()) {
    if (p.variantCount > opts.maxVariants) {
      add('too-many-variants', p.firstLine, `"${p.handle}" has ${p.variantCount} variants (limit used for this check: ${opts.maxVariants}).`, { handle: p.handle });
    }
    if (p.hasDefaultTitle && p.variantCount > 1) {
      add('default-title-mixed', p.firstLine, `"${p.handle}" has a "Default Title" variant next to ${p.variantCount - 1} other variant(s). Default Title is only for products with no options.`, { handle: p.handle });
    }
    for (const vi of p.variantImages) {
      if (!p.imageSrcs.has(vi.url)) {
        add('variant-image-unlisted', vi.line, `Variant Image "${truncate(vi.url)}" is not one of the Image Src values of "${p.handle}".`, { handle: p.handle, column: 'Variant Image' });
      }
    }
  }

  return { issues: sortIssues(issues), stats };
}

function checkHandle(handle, line, add) {
  if (handle.length > 255) add('handle-too-long', line, `Handle is ${handle.length} characters; the limit is 255.`, { handle });
  if (/[\p{Lu}\s]|[^\p{L}\p{N}\p{M}-]/u.test(handle)) {
    const suggestion = handle.toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-+|-+$/g, '');
    add('handle-format', line, `Handle "${truncate(handle)}" is not a clean URL handle. Shopify will rewrite it, roughly to "${truncate(suggestion)}".`, { handle });
  }
}

function checkProductFields(get, add, ctx) {
  const title = get('Title');
  if (!title) add('missing-title', ctx.line, 'First row of the product has no Title.', ctx);
  else if (title.length > 255) add('title-too-long', ctx.line, `Title is ${title.length} characters; the limit is 255.`, ctx);
  if (!get('Body (HTML)')) add('missing-description', ctx.line, 'Product has no description (Body (HTML)).', ctx);

  const tags = get('Tags').split(',').map((t) => t.trim()).filter(Boolean);
  if (tags.length > 250) add('tags-too-many', ctx.line, `Product has ${tags.length} tags; the limit is 250.`, ctx);
  const longTag = tags.find((t) => t.length > 255);
  if (longTag) add('tag-too-long', ctx.line, `A tag is ${longTag.length} characters; the limit is 255.`, ctx);

  const seoTitle = get('SEO Title');
  if (seoTitle.length > 70) add('seo-title-long', ctx.line, `SEO Title is ${seoTitle.length} characters; search results usually cut off around 60-70.`, ctx);
  const seoDesc = get('SEO Description');
  if (seoDesc.length > 320) add('seo-description-long', ctx.line, `SEO Description is ${seoDesc.length} characters; search results usually cut off well before 320.`, ctx);
}

function checkBooleans(get, add, ctx) {
  const status = get('Status');
  if (status && !['active', 'draft', 'archived'].includes(status.toLowerCase())) {
    add('invalid-status', ctx.line, `Status "${status}" must be active, draft or archived.`, { ...ctx, column: 'Status' });
  }
  for (const col of ['Published', 'Variant Requires Shipping', 'Variant Taxable', 'Gift Card']) {
    const v = get(col);
    if (v && !['true', 'false'].includes(v.toLowerCase())) {
      add('invalid-boolean', ctx.line, `${col} is "${v}" but must be TRUE or FALSE.`, { ...ctx, column: col });
    }
  }
}

function checkVariantFields(get, add, ctx, skuSeen) {
  const price = get('Variant Price');
  const compare = get('Variant Compare At Price');
  const cost = get('Cost per item');
  const col = (column) => ({ ...ctx, column });

  if (!price) {
    add('price-missing', ctx.line, 'Variant has no Variant Price; Shopify will likely import it at 0.00.', col('Variant Price'));
  } else if (!NUMBER.test(price)) {
    add('price-invalid', ctx.line, `Variant Price "${price}" is not a plain number: ${describeBadNumber(price)}.`, col('Variant Price'));
  } else if (Number(price) < 0) {
    add('price-negative', ctx.line, `Variant Price ${price} is negative.`, col('Variant Price'));
  }
  if (compare) {
    if (!NUMBER.test(compare)) {
      add('compare-at-invalid', ctx.line, `Variant Compare At Price "${compare}" is not a plain number: ${describeBadNumber(compare)}.`, col('Variant Compare At Price'));
    } else if (NUMBER.test(price) && Number(compare) > 0 && Number(compare) <= Number(price)) {
      add('compare-at-not-higher', ctx.line, `Compare At Price ${compare} is not higher than Price ${price}, so the product will not show as on sale.`, col('Variant Compare At Price'));
    }
  }
  if (cost) {
    if (!NUMBER.test(cost)) add('cost-invalid', ctx.line, `Cost per item "${cost}" is not a plain number: ${describeBadNumber(cost)}.`, col('Cost per item'));
    else if (Number(cost) < 0) add('price-negative', ctx.line, `Cost per item ${cost} is negative.`, col('Cost per item'));
  }

  const grams = get('Variant Grams');
  if (grams && (!NUMBER.test(grams) || Number(grams) < 0)) {
    add('grams-invalid', ctx.line, `Variant Grams "${grams}" must be a number of 0 or more.`, col('Variant Grams'));
  }
  const unit = get('Variant Weight Unit');
  if (unit && !['g', 'kg', 'oz', 'lb'].includes(unit.toLowerCase())) {
    add('weight-unit-invalid', ctx.line, `Variant Weight Unit "${unit}" must be g, kg, oz or lb.`, col('Variant Weight Unit'));
  }

  const qty = get('Variant Inventory Qty');
  const tracker = get('Variant Inventory Tracker');
  if (qty && !INTEGER.test(qty)) add('inventory-qty-invalid', ctx.line, `Variant Inventory Qty "${qty}" must be a whole number.`, col('Variant Inventory Qty'));
  if (tracker && tracker.toLowerCase() !== 'shopify') {
    add('inventory-tracker-invalid', ctx.line, `Variant Inventory Tracker "${tracker}" should be "shopify" or blank.`, col('Variant Inventory Tracker'));
  }
  if (qty && INTEGER.test(qty) && !tracker) {
    add('qty-without-tracker', ctx.line, `Inventory Qty is ${qty} but Variant Inventory Tracker is blank; the quantity will likely be ignored. Set the tracker to "shopify".`, col('Variant Inventory Qty'));
  }
  const policy = get('Variant Inventory Policy');
  if (policy && !['deny', 'continue'].includes(policy.toLowerCase())) {
    add('inventory-policy-invalid', ctx.line, `Variant Inventory Policy "${policy}" must be deny or continue.`, col('Variant Inventory Policy'));
  }

  const sku = get('Variant SKU');
  if (sku) {
    if (SCI.test(sku)) {
      add('scientific-notation', ctx.line, `Variant SKU "${sku}" looks like a number Excel converted to scientific notation. Re-export with the column formatted as text.`, col('Variant SKU'));
    } else {
      const key = sku.toLowerCase();
      if (skuSeen.has(key)) add('sku-duplicate', ctx.line, `SKU "${sku}" is already used on line ${skuSeen.get(key)}.`, col('Variant SKU'));
      else skuSeen.set(key, ctx.line);
    }
  }
  const barcode = get('Variant Barcode').replace(/^'/, '');
  if (barcode) {
    if (SCI.test(barcode)) {
      add('scientific-notation', ctx.line, `Variant Barcode "${barcode}" looks like a number Excel converted to scientific notation. Re-export with the column formatted as text.`, col('Variant Barcode'));
    } else if (/^\d+$/.test(barcode) && [8, 12, 13, 14].includes(barcode.length) && !isValidGtin(barcode)) {
      add('barcode-checksum', ctx.line, `Barcode ${barcode} has the length of a GTIN but its check digit is wrong. Check for a typo or a lost leading zero.`, col('Variant Barcode'));
    }
  }
}

function truncate(s, n = 60) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const ORDER = { error: 0, warning: 1, info: 2 };
function sortIssues(issues) {
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => a.issue.line - b.issue.line || ORDER[a.issue.severity] - ORDER[b.issue.severity] || a.i - b.i)
    .map((x) => x.issue);
}

module.exports = { lintCsv, KNOWN_COLUMNS };
