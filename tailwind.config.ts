import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        // Krawings brand orange — use as text-krawings-600, bg-krawings-50 etc.
        krawings: {
          50:  '#FFF4E6',
          100: '#FFE4BE',
          200: '#FDBA74',
          300: '#FB923C',
          400: '#F97316',
          500: '#F5800A',  // ← primary brand colour
          600: '#E86000',  // ← hover / active
          700: '#C05200',
          800: '#9A4200',
          900: '#7C3500',
        },
      },
      fontFamily: {
        sans: ['DM Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
