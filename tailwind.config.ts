import type { Config } from 'tailwindcss';
import { colors } from './src/design/tokens.mjs';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      // Single-sourced in src/design/tokens.mjs (also feeds the contrast table).
      colors,
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      fontSize: {
        // Senior-friendly scale: larger base, generous line height. xs/sm are
        // floored at 16/17px; app screens use text-base or larger (chat 12).
        xs: ['1rem', { lineHeight: '1.5rem' }],
        sm: ['1.0625rem', { lineHeight: '1.625rem' }],
        base: ['1.1875rem', { lineHeight: '1.75rem' }],
        lg: ['1.375rem', { lineHeight: '2rem' }],
        xl: ['1.75rem', { lineHeight: '2.25rem' }],
        '2xl': ['2.25rem', { lineHeight: '2.6rem' }],
        '3xl': ['3rem', { lineHeight: '3.25rem' }],
        '4xl': ['3.75rem', { lineHeight: '4rem' }],
      },
      borderRadius: { xl: '1.25rem', '2xl': '1.75rem' },
      maxWidth: { content: '68rem' },
    },
  },
  plugins: [],
};
export default config;
