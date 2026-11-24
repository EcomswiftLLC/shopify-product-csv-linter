'use strict';

/**
 * Every check the linter can emit: id -> [default severity, description].
 *   error   - the import will fail, drop data, or produce a broken product
 *   warning - the import will probably succeed but the result is likely not what you meant
 *   info    - worth knowing, never fails a run on its own
 */
const RULES = {
  'unterminated-quote': ['error', 'A quoted field is never closed, so the rest of the file would be read as one cell.'],
  'missing-column': ['error', 'A column the importer needs (Handle, Title) is not in the header row.'],
  'duplicate-column': ['error', 'The same column name appears twice in the header row.'],
  'unknown-column': ['warning', 'A header looks like a misspelt Shopify column, so its data would be ignored.'],
  'extra-column': ['info', "A header is not part of Shopify's product CSV template and will be ignored."],
  'row-too-wide': ['error', 'A row has more cells than the header row, usually an unquoted comma.'],
  'row-too-narrow': ['warning', 'A row has fewer cells than the header row.'],
  'encoding': ['warning', 'The file contains U+FFFD replacement characters, so it was not saved as UTF-8.'],
  'missing-handle': ['error', 'A row has data but no Handle, so Shopify cannot tell which product it belongs to.'],
  'handle-format': ['warning', 'A Handle contains uppercase letters, spaces or symbols; Shopify will rewrite it.'],
  'handle-too-long': ['error', 'A Handle is longer than 255 characters.'],
  'non-contiguous-handle': ['warning', 'Rows for one product are split by rows of another product.'],
  'missing-title': ['error', 'The first row of a product has no Title.'],
  'title-too-long': ['error', 'A Title is longer than 255 characters.'],
  'missing-description': ['info', 'The first row of a product has an empty Body (HTML).'],
  'invalid-status': ['error', 'Status is not one of active, draft or archived.'],
  'invalid-boolean': ['error', 'A TRUE/FALSE column holds something else.'],
  'tags-too-many': ['error', 'A product has more than 250 tags.'],
  'tag-too-long': ['error', 'A tag is longer than 255 characters.'],
  'seo-title-long': ['info', 'SEO Title is longer than 70 characters and will probably be truncated in search results.'],
  'seo-description-long': ['info', 'SEO Description is longer than 320 characters and will probably be truncated in search results.'],
  'option-name-missing': ['error', 'A row has an option value but its product has no option name.'],
  'option-value-missing': ['error', 'A variant row has no value for an option the product defines.'],
  'variant-without-options': ['error', 'A second variant row exists but the product defines no options.'],
  'option-name-mismatch': ['warning', "A later row names an option differently from the first row; only the first row's name is used."],
  'duplicate-variant': ['error', 'Two variants of one product have the same option values.'],
  'default-title-mixed': ['warning', 'A product mixes the placeholder "Default Title" variant with real variants.'],
  'too-many-variants': ['warning', 'A product has more variants than --max-variants (default 100).'],
  'price-missing': ['warning', 'A variant has no price and will likely import at 0.00.'],
  'price-invalid': ['error', 'A price is not a plain number such as 19.99 (no currency symbol or thousands separator).'],
  'price-negative': ['error', 'A price or cost is negative.'],
  'compare-at-invalid': ['error', 'Compare At Price is not a plain number.'],
  'compare-at-not-higher': ['warning', 'Compare At Price is not higher than Price, so no sale badge will show.'],
  'cost-invalid': ['error', 'Cost per item is not a plain number.'],
  'grams-invalid': ['error', 'Variant Grams is not a non-negative number.'],
  'weight-unit-invalid': ['error', 'Variant Weight Unit is not g, kg, oz or lb.'],
  'inventory-qty-invalid': ['error', 'Variant Inventory Qty is not a whole number.'],
  'inventory-policy-invalid': ['error', 'Variant Inventory Policy is not deny or continue.'],
  'inventory-tracker-invalid': ['warning', 'Variant Inventory Tracker is not shopify or blank.'],
  'qty-without-tracker': ['warning', 'A quantity is set but inventory tracking is off, so the quantity will likely be ignored.'],
  'scientific-notation': ['error', 'A SKU or barcode was converted to scientific notation (e.g. 1.23457E+12), usually by Excel.'],
  'sku-duplicate': ['warning', 'The same SKU is used by more than one variant.'],
  'barcode-checksum': ['warning', 'A barcode of GTIN length (8, 12, 13 or 14 digits) fails its check digit.'],
  'image-url-invalid': ['error', 'Image Src is not an http(s) URL.'],
  'image-position-invalid': ['error', 'Image Position is not a positive whole number.'],
  'image-position-duplicate': ['warning', 'Two images of one product share an Image Position.'],
  'image-alt-missing': ['warning', 'An image has no Image Alt Text (accessibility and image SEO).'],
  'variant-image-unlisted': ['warning', "A Variant Image URL is not among the product's Image Src values."],
};

function defaultSeverity(id) {
  const rule = RULES[id];
  if (!rule) throw new Error(`Unknown rule: ${id}`);
  return rule[0];
}

module.exports = { RULES, defaultSeverity };
