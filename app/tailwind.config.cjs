/** @type {import('tailwindcss').Config} */
// BrotIA palette (docs/design/v1.1-ui-spec.md). Token names are stable; feature code depends on them.
// CommonJS on purpose: Node 22+ loads an ESM config via require(esm), which Tailwind cannot evict from its cache,
// so edits to an ESM config never reach a running dev server. A .cjs config reloads on save.
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1F6B43', hover: '#18573A', soft: '#E9F3EC', ink: '#0E2A23' },
        accent: '#2FA05A',
        ink: '#0E1914',
        muted: '#6A766F',
        surface: '#F6F8F7',
        line: '#E4EBE6',
        faint: '#E4EBE6',
        // `ink` variants are darker text shades for use on the soft fills (contrast >= 4.5:1).
        danger: { DEFAULT: '#D0533A', soft: '#FBECE8', ink: '#9E2F3A' },
        warn: { DEFAULT: '#E8933A', soft: '#FDF1E4', ink: '#8A4E0F' },
        // Risk ramp (the logo's soil row): tiers and score scales only.
        risk: { 0: '#1F6B43', 1: '#2FA05A', 2: '#8CC63F', 3: '#E3C93B', 4: '#E8933A', 5: '#D0533A', 6: '#9E2F3A' },
        tier: { normal: '#2FA05A', watch: '#E8933A', high: '#D0533A' },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: [['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'], { fontFeatureSettings: '"tnum" 1' }],
      },
      borderRadius: { card: '8px' },
      boxShadow: { panel: '0 1px 2px rgba(14,25,20,0.04)' },
    },
  },
  plugins: [],
};
