import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Kindly palette — calm, warm, trustworthy. Not the AI-default cream/terracotta.
        ink: '#23302E',      // deep evergreen ink (text)
        sage: '#5B7F73',     // primary sage
        sageDeep: '#3F5C52', // hover / accents
        clay: '#C98A6B',     // warm clay accent (used sparingly)
        mist: '#F3F1EA',     // soft off-white background
        cloud: '#FBFAF6',    // card / surface
        line: '#DED9CC',     // hairline borders
        muted: '#6B7771',    // secondary text
      },
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      fontSize: {
        // Senior-friendly scale: larger base, generous line height.
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
