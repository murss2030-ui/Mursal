/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/ui/**/*.{ts,tsx}', './src/i18n/**/*.tsx'],
  theme: {
    extend: {
      fontFamily: {
        // Plex Sans for Latin, Plex Sans Arabic for Arabic: one design family in both scripts.
        sans: ['"IBM Plex Sans"', '"IBM Plex Sans Arabic"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Tahoma', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Deep teal ink: the header, the hero panels and the brand.
        ink: { DEFAULT: '#0b2e2f', 700: '#1b5354', 800: '#123f40', 900: '#0b2e2f' },
        // Warm paper background and hairlines.
        paper: '#f7f5f0',
        line: '#e6e1d6',
        // Saffron accent (progress, highlights), tuned for contrast on white and on ink.
        saffron: { 50: '#fff8eb', 100: '#fdebc8', 300: '#f7c35c', 400: '#f2a91d', 500: '#d98e04', 700: '#965f00', 800: '#7a4d02', 900: '#5c3a03' },
      },
      boxShadow: {
        card: '0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)',
        lift: '0 10px 30px -12px rgba(11, 46, 47, 0.35)',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
};
