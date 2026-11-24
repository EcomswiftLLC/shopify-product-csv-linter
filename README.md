# shopify-product-csv-linter

Lint a Shopify product import CSV **before** you upload it. It finds the things that make an import fail halfway, or worse, succeed with wrong data: duplicate variants, prices with a `$` in them, barcodes Excel turned into `4.00638E+12`, images that are not URLs, products that can quietly import at 0.00. One CLI, zero dependencies.

We built this because catalog migrations keep going wrong in the same dozen ways, and Shopify's importer tells you about them one failed row at a time, after the upload. `spcl` checks the whole file in a second and points at the exact line.

**Free audit for your own store while you're here:** [audit.ecomswiftllc.com](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-product-csv-linter) checks SEO, speed, CRO and AI-visibility in one pass.

## Example

```
$ spcl lint examples/bad.csv

examples/bad.csv: 2 product(s), 4 variant(s), 4 row(s) - 8 error(s), 8 warning(s), 0 note(s)

warning line 1     [unknown-column] Column "Variant Imag" is not a Shopify column. Did you mean "Variant Image"?
error   line 2     [price-invalid] Variant Price "$1,299.00" is not a plain number: remove the currency symbol.
warning line 2     [handle-format] Handle "Linen Shirt" is not a clean URL handle. Shopify will rewrite it, roughly to "linen-shirt".
warning line 2     [qty-without-tracker] Inventory Qty is 15 but Variant Inventory Tracker is blank; the quantity will likely be ignored. Set the tracker to "shopify".
warning line 2     [barcode-checksum] Barcode 4006381333932 has the length of a GTIN but its check digit is wrong. Check for a typo or a lost leading zero.
error   line 3     [duplicate-variant] Duplicate variant "S" (same as line 2).
error   line 4     [option-value-missing] Variant has no value for Size (Option1 Value).
error   line 4     [image-url-invalid] Image Src "not-a-url.jpg" is not an http(s) URL. Shopify fetches images from public URLs.
error   line 5     [missing-title] First row of the product has no Title.
error   line 5     [scientific-notation] Variant SKU "1.23457E+12" looks like a number Excel converted to scientific notation. Re-export with the column formatted as text.
...

$ echo $?
1
```

(Abridged. `examples/bad.csv` and `examples/good.csv` are in the repo so you can try it.)

## What it checks

48 checks in five groups. Run `spcl rules` for the full list with default severities.

- **File and header:** unterminated quotes, missing `Handle`/`Title` columns, duplicate columns, misspelt column names (with a "did you mean"), rows with too many or too few cells, non-UTF-8 text.
- **Products:** missing handle or title, handle format and length, rows of one product split apart, invalid `Status` and TRUE/FALSE values, tag counts and lengths, over-long SEO fields.
- **Variants:** duplicate option combinations, missing option values, option values with no option name, the `Default Title` placeholder mixed with real variants, too many variants.
- **Money, stock and identifiers:** unreadable prices (`$19.99`, `1,299.00`, `12,50`), negative prices, compare-at prices that do not make a sale, missing prices (these tend to import at 0.00), grams and weight units, inventory quantity vs tracker, duplicate SKUs, SKUs and barcodes mangled into scientific notation, GTIN check digits.
- **Images:** non-URL `Image Src`, bad or repeated `Image Position`, missing alt text, variant images that are not in the product's image list.

Each finding is an **error** (the import will fail or the product will be broken), a **warning** (it will probably import but probably not as you meant) or a **note** (worth knowing).

## Features

- **Line numbers that match your editor.** Quoted fields with embedded newlines do not throw the count off.
- **Understands image-only rows.** A row that only carries an extra image is not mistaken for a variant.
- **Three output formats:** `text`, `json` (for CI) and `markdown` (paste into a ticket).
- **Useful exit codes.** `0` clean, `1` errors (or warnings with `--strict`), `2` bad usage or unreadable file, so it drops straight into a CI step or a pre-upload script.
- **Tunable.** `--ignore rule-id` for checks you do not care about, `--min-severity error` to see only blockers, `--max-variants` for your own limit.
- **Reads stdin** (`spcl lint -`), so you can pipe a CSV from another tool.
- **Zero runtime dependencies.** Node's built-ins only.
- **Usable as a library:** `lintCsv`, `parseCsv`, `isValidGtin` and the formatters are exported.

## Installation

```bash
git clone https://github.com/EcomswiftLLC/shopify-product-csv-linter.git
cd shopify-product-csv-linter
node bin/spcl.js --help
# or get an `spcl` command on your PATH
npm link
```

The package is not published to npm yet. Requires Node.js 18+.

## Usage

```
spcl lint <file.csv|->   Check a product import CSV ("-" reads stdin)
spcl rules               List every check and its default severity
```

| Flag | Meaning |
| --- | --- |
| `--format <text\|json\|markdown>` | output format (default `text`) |
| `--min-severity <error\|warning\|info>` | hide anything less severe (default `info`) |
| `--max-variants <n>` | warn above `n` variants per product (default 100) |
| `--ignore <rule,rule>` | skip these rule ids |
| `--strict` | exit 1 on warnings as well as errors |

```bash
# Only the blockers, as JSON, for a CI step
spcl lint products.csv --min-severity error --format json

# Descriptions and alt text are still to come, so skip those checks for now
spcl lint products.csv --ignore missing-description,image-alt-missing

# Fail the build on warnings too
spcl lint products.csv --strict
```

### As a library

```js
const { lintCsv, formatText } = require('shopify-product-csv-linter');
const fs = require('fs');

const result = lintCsv(fs.readFileSync('products.csv', 'utf8'), { maxVariants: 100 });
console.log(result.stats);               // { rows, products, variants, images }
console.log(result.issues[0]);           // { rule, severity, line, message, handle?, column? }
console.log(formatText('products.csv', result));
```

## What it does NOT do

- **It is not Shopify's importer.** The checks follow [Shopify's published product CSV format](https://help.shopify.com/en/manual/products/import-export/using-csv) and the limits we know of (255-character titles, handles and tags, 250 tags per product, `active`/`draft`/`archived` status, and so on). Shopify can change its rules; a clean run here is not a promise that the upload will succeed, and a warning here is not a promise that it will fail.
- **It never touches your store.** No API, no credentials, no network calls. It cannot check that an image URL actually loads, that a vendor or product category exists, or that a SKU is already in your store from an earlier import.
- **It does not fix the file.** It reports; you edit. Rewriting a catalog automatically is how data gets lost.
- **It does not check your content.** Descriptions are only tested for being empty. No spelling, HTML validity or SEO quality scoring beyond the two length notes.
- **Metafield and Google Shopping columns are accepted but not validated.** Their values depend on definitions in your store.
- **Variant limits are yours to set.** The default warning at 100 variants is a conservative guard, not Shopify's current ceiling, which depends on how you import and changes over time. Use `--max-variants` to match your situation.
- **GTIN checks cover digits only.** It verifies the check digit of 8, 12, 13 and 14 digit barcodes. It does not know whether the number is registered to you, and other barcode formats are left alone.
- **Not run against a live import by us.** The 25 tests cover every rule against hand-built CSVs and the CLI's exit codes. Start with a ten-product slice of your file on a development store.

## FAQ

**Why is a missing price only a warning?**
In our experience a variant with an empty price tends to import as 0.00 instead of being rejected, so the import succeeds and you find out when a product is free. Shopify's behaviour here is not something we can guarantee, which is why it is a warning rather than an error.

**Why are duplicate SKUs a warning and not an error?**
Shopify allows two variants to share a SKU. Inventory tools, 3PLs and sync apps usually do not cope with it.

**Why does it complain about `Default Title`?**
`Default Title` is the placeholder Shopify uses for a product with a single variant and no real options. Next to real variants it usually means two exports were pasted together.

**Excel keeps wrecking my barcodes.**
Excel turns long digit strings into `4.00638E+12` and drops leading zeros. Format the column as text before pasting, or open the CSV through *Data → From Text/CSV* and set the column type to Text. `spcl` flags the scientific notation case. A lost leading zero changes the barcode's length, so it is only caught if the shortened number happens to still be a GTIN length with a bad check digit.

Cleaning a catalog before a migration is also a good moment to look at how those products read on the page. If you'd like a second pair of eyes, our [free Shopify tools](https://www.ecomswiftllc.com/free-tools) and the [store audit](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-product-csv-linter) are a good starting point.

## Related Shopify tools

- [`shopify-product-feed-validator`](https://github.com/EcomswiftLLC/shopify-product-feed-validator): the next step after a clean import, checking the feed you send to shopping channels.
- [`shopify-metafields-manager`](https://github.com/Ecom-Swift-LLC/shopify-metafields-manager): read and write the metafields that the CSV's metafield columns map to.
- [`shopify-bulk-operations-toolkit`](https://github.com/Ecom-Swift-LLC/shopify-bulk-operations-toolkit): bulk queries and mutations over the Admin API without hand-rolled polling.
- [`shopify-image-auditor`](https://github.com/Ecom-Swift-LLC/shopify-image-auditor): check image weight, size and alt text on a live store.
- [`shopify-inventory-sync-cli`](https://github.com/EcomswiftLLC/shopify-inventory-sync-cli): diff-based inventory sync from a spreadsheet.

## Contributing

Issues and PRs welcome, especially reports of an import that failed in a way this linter did not predict (include the smallest CSV that reproduces it), new rules with a test, and column names from Shopify's newer templates that are missing from the known list.

## Roadmap

- A `--fix-safe` mode for the mechanical cases (trim whitespace, strip currency symbols, lowercase handles) that writes a new file and never overwrites yours.
- Checking product and variant metafield columns against a definitions export.
- A GitHub Action wrapper.

## License

MIT © Ecom Swift LLC

## Need help?

This project is maintained by **Ecom Swift LLC**, a Shopify Partner.

- 🛍️ Shopify Partner Directory: https://www.shopify.com/partners/directory/partner/waowy
- ✉️ Email: support@ecomswiftllc.com
- 💬 WhatsApp: https://wa.me/16312511767

---

Moving a catalog and want the new store checked for speed, SEO and conversion leaks once it is live? [Get a free store audit](https://audit.ecomswiftllc.com/?utm_source=github&utm_medium=repo&utm_campaign=shopify-product-csv-linter) (SEO, speed, CRO, AI visibility) or browse our other [free Shopify tools](https://www.ecomswiftllc.com/free-tools). We're **Ecom Swift LLC**, a Shopify Partner Agency: [www.ecomswiftllc.com](https://www.ecomswiftllc.com).
