import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Minimal palette for v1. Agent 6 builds out shadcn tokens later.
        ink: '#111827',
        muted: '#6b7280',
        surface: '#ffffff',
        hairline: '#e5e7eb',
        accent: '#0ea5e9',
        danger: '#dc2626',
        warn: '#d97706',
        ok: '#059669',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      minHeight: {
        tap: '44px', // mobile tap target minimum
      },
      minWidth: {
        tap: '44px',
      },
    },
  },
  plugins: [],
}

export default config
