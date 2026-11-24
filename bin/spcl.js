#!/usr/bin/env node
'use strict';

const fs = require('fs');
const {
  lintCsv, formatText, formatJson, formatMarkdown, countBySeverity, RULES,
} = require('../src/index');

const HELP = `spcl - Shopify product CSV linter

Usage:
  spcl lint <file.csv|->   Check a product import CSV before you upload it ("-" reads stdin)
  spcl rules               List every check and its default severity
  spcl --help | --version

Options (lint):
  --format <text|json|markdown>   output format (default text)
  --min-severity <error|warning|info>   hide anything less severe (default info)
  --max-variants <n>              warn above n variants per product (default 100)
  --ignore <rule,rule,...>        skip these rules (see "spcl rules")
  --strict                        exit 1 on warnings as well as errors

Exit codes: 0 clean (or only warnings/notes), 1 errors found (or warnings with --strict), 2 bad usage or unreadable file.
`;

function fail(message) {
  process.stderr.write(`spcl: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { _: [], format: 'text', minSeverity: 'info', maxVariants: 100, ignore: [], strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) fail(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--format') args.format = next();
    else if (a === '--min-severity') args.minSeverity = next();
    else if (a === '--max-variants') args.maxVariants = Number(next());
    else if (a === '--ignore') args.ignore = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--strict') args.strict = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
    else if (a.startsWith('--')) fail(`unknown option ${a}`);
    else args._.push(a);
  }
  return args;
}

function readInput(file) {
  try {
    return file === '-' ? fs.readFileSync(0) : fs.readFileSync(file);
  } catch (err) {
    return fail(`cannot read ${file}: ${err.message}`);
  }
}

// Decode as UTF-8; invalid bytes become U+FFFD, which the linter reports as an encoding problem.
function decode(buffer) {
  return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.version) {
    process.stdout.write(`${require('../package.json').version}\n`);
    return;
  }
  const command = args._[0];
  if (args.help || !command) {
    process.stdout.write(HELP);
    return;
  }

  if (command === 'rules') {
    for (const [id, [severity, description]] of Object.entries(RULES)) {
      process.stdout.write(`${severity.padEnd(7)} ${id.padEnd(26)} ${description}\n`);
    }
    return;
  }

  if (command !== 'lint') fail(`unknown command "${command}". Try --help.`);
  const file = args._[1];
  if (!file) fail('lint needs a file path (or "-" for stdin)');
  if (!['text', 'json', 'markdown'].includes(args.format)) fail('--format must be text, json or markdown');
  if (!['error', 'warning', 'info'].includes(args.minSeverity)) fail('--min-severity must be error, warning or info');
  if (!Number.isInteger(args.maxVariants) || args.maxVariants < 1) fail('--max-variants must be a positive whole number');
  const unknown = args.ignore.filter((id) => !RULES[id]);
  if (unknown.length) fail(`unknown rule id(s) for --ignore: ${unknown.join(', ')}`);

  const result = lintCsv(decode(readInput(file)), { maxVariants: args.maxVariants, ignore: args.ignore });
  const label = file === '-' ? '(stdin)' : file;
  const format = { text: formatText, json: formatJson, markdown: formatMarkdown }[args.format];
  process.stdout.write(`${format(label, result, { minSeverity: args.minSeverity })}\n`);

  const counts = countBySeverity(result.issues);
  if (counts.error > 0 || (args.strict && counts.warning > 0)) process.exitCode = 1;
}

main();
