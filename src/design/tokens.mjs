// Dearly design tokens: the single source for colours. Read by
// tailwind.config.ts and by scripts/contrast-table.mjs (and its test), so the
// WCAG contrast table in the PR is computed from the same values the app uses.

/** @type {Record<string, string>} */
export const colors = {
  ink: '#23302E', // deep evergreen ink (text)
  sage: '#4D7064', // primary sage (darkened in chat 12: 4.87:1 on mist)
  sageDeep: '#3F5C52', // hover, links, eyebrow
  clay: '#C98A6B', // warm accent: DECORATIVE ONLY, never text or meaning
  error: '#A4472B', // errors, destructive actions, "sensitive" badge, recording
  mist: '#F3F1EA', // page background
  cloud: '#FBFAF6', // card / surface
  line: '#DED9CC', // decorative hairlines (card edges, dividers)
  field: '#8A877C', // form-control borders (≥3:1 on mist and cloud)
  muted: '#5A655F', // secondary text
};

/**
 * Every foreground/background pair the app relies on, with the WCAG AA
 * minimum it must meet: 4.5 for normal text, 3 for UI components (borders,
 * focus rings) per WCAG 1.4.11.
 * @type {Array<{fg: string, bg: string, min: number, use: string}>}
 */
export const contrastPairs = [
  { fg: 'ink', bg: 'mist', min: 4.5, use: 'body text on page' },
  { fg: 'ink', bg: 'cloud', min: 4.5, use: 'body text on card' },
  { fg: 'muted', bg: 'mist', min: 4.5, use: 'secondary text on page' },
  { fg: 'muted', bg: 'cloud', min: 4.5, use: 'secondary text on card' },
  { fg: 'sageDeep', bg: 'mist', min: 4.5, use: 'links, eyebrow on page' },
  { fg: 'sageDeep', bg: 'cloud', min: 4.5, use: 'links, eyebrow on card' },
  { fg: 'sage', bg: 'mist', min: 4.5, use: 'sage text on page' },
  { fg: 'sage', bg: 'cloud', min: 4.5, use: 'sage text on card' },
  { fg: 'cloud', bg: 'sage', min: 4.5, use: 'primary button label' },
  { fg: 'cloud', bg: 'sageDeep', min: 4.5, use: 'primary button hover / active tab' },
  { fg: 'error', bg: 'mist', min: 4.5, use: 'error text on page' },
  { fg: 'error', bg: 'cloud', min: 4.5, use: 'error text, Remove/Delete, Sensitive badge on card' },
  { fg: 'cloud', bg: 'error', min: 4.5, use: 'recording button label' },
  { fg: 'field', bg: 'mist', min: 3, use: 'input border on page' },
  { fg: 'field', bg: 'cloud', min: 3, use: 'input border on card' },
  { fg: 'sageDeep', bg: 'mist', min: 3, use: 'focus outline on page' },
  { fg: 'sageDeep', bg: 'cloud', min: 3, use: 'focus outline on card' },
];

/** WCAG 2.x relative luminance of a #RRGGBB colour. */
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colours (1–21). */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Rows for the contrast table, computed from the tokens above. */
export function contrastTable() {
  return contrastPairs.map((p) => {
    const ratio = contrastRatio(colors[p.fg], colors[p.bg]);
    return { ...p, fgHex: colors[p.fg], bgHex: colors[p.bg], ratio: Math.round(ratio * 100) / 100, pass: ratio >= p.min };
  });
}
