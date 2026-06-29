import type { Config } from 'tailwindcss';
const c = (v: string) => `rgb(var(${v}) / <alpha-value>)`;
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {
    colors: {
      background: c('--background'), foreground: c('--foreground'), card: c('--card'),
      primary: { DEFAULT: c('--primary'), foreground: c('--primary-foreground') },
      accent: { DEFAULT: c('--accent'), foreground: c('--accent-foreground') },
      muted: { DEFAULT: c('--muted'), foreground: c('--muted-foreground') },
      border: c('--border'), ring: c('--ring'),
      destructive: { DEFAULT: c('--destructive'), foreground: c('--destructive-foreground') },
      exact: c('--exact'), fuzzy: c('--fuzzy'), ai: c('--ai'), unmatched: c('--unmatched'),
    },
    fontFamily: {
      sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
    },
    borderRadius: { lg: '0.75rem', md: '0.5rem', sm: '0.375rem' },
  } },
} satisfies Config;
