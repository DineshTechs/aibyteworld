import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fdf4ef',
          100: '#fae5d8',
          200: '#f4c8b0',
          300: '#eda47f',
          400: '#e57c4d',
          500: '#de5f2b',
          600: '#cf4921',
          700: '#ac371d',
          800: '#8a2e1f',
          900: '#70281c',
        },
      },
      fontFamily: {
        serif: ['"Iowan Old Style"', '"Palatino Linotype"', 'Palatino', 'Georgia', 'serif'],
        sans: ['"Segoe UI"', 'system-ui', '-apple-system', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [typography],
};
