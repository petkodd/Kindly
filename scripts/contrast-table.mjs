// Prints the WCAG contrast table for the design tokens (markdown). Exit 1 if any pair fails.
// Usage: node scripts/contrast-table.mjs
import { contrastTable } from '../src/design/tokens.mjs';

const rows = contrastTable();
console.log('| Foreground | Background | Ratio | Needs | Result | Used for |');
console.log('|---|---|---|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.fg} \`${r.fgHex}\` | ${r.bg} \`${r.bgHex}\` | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${r.pass ? 'PASS' : 'FAIL'} | ${r.use} |`);
}
if (rows.some((r) => !r.pass)) process.exit(1);
