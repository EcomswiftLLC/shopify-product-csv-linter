'use strict';

const ORDER = { error: 0, warning: 1, info: 2 };

function filterBySeverity(issues, min) {
  const limit = ORDER[min] === undefined ? 2 : ORDER[min];
  return issues.filter((i) => ORDER[i.severity] <= limit);
}

function countBySeverity(issues) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) counts[i.severity]++;
  return counts;
}

function countByRule(issues) {
  const byRule = new Map();
  for (const i of issues) byRule.set(i.rule, (byRule.get(i.rule) || 0) + 1);
  return [...byRule.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function summaryLine(file, stats, counts) {
  const parts = [`${stats.products} product(s)`, `${stats.variants} variant(s)`, `${stats.rows} row(s)`];
  return `${file}: ${parts.join(', ')} - ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} note(s)`;
}

function formatText(file, result, { minSeverity = 'info' } = {}) {
  const shown = filterBySeverity(result.issues, minSeverity);
  const counts = countBySeverity(result.issues);
  const lines = [summaryLine(file, result.stats, counts), ''];
  for (const i of shown) {
    lines.push(`${i.severity.padEnd(7)} line ${String(i.line).padEnd(5)} [${i.rule}] ${i.message}`);
  }
  if (shown.length) {
    lines.push('', 'By rule:');
    for (const [rule, n] of countByRule(shown)) lines.push(`  ${String(n).padStart(4)}  ${rule}`);
  } else {
    lines.push('No issues found at this severity.');
  }
  return lines.join('\n');
}

function formatJson(file, result, { minSeverity = 'info' } = {}) {
  const shown = filterBySeverity(result.issues, minSeverity);
  return JSON.stringify({ file, stats: result.stats, counts: countBySeverity(result.issues), issues: shown }, null, 2);
}

function escapeCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatMarkdown(file, result, { minSeverity = 'info' } = {}) {
  const shown = filterBySeverity(result.issues, minSeverity);
  const counts = countBySeverity(result.issues);
  const lines = [`## ${file}`, '', summaryLine(file, result.stats, counts).replace(`${file}: `, ''), ''];
  if (!shown.length) {
    lines.push('No issues found at this severity.');
  } else {
    lines.push('| Severity | Line | Rule | Message |', '| --- | --- | --- | --- |');
    for (const i of shown) lines.push(`| ${i.severity} | ${i.line} | \`${i.rule}\` | ${escapeCell(i.message)} |`);
  }
  return lines.join('\n');
}

module.exports = { formatText, formatJson, formatMarkdown, countBySeverity, filterBySeverity };
