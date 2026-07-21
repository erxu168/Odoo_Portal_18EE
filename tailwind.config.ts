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
        // @deprecated LEGACY orange scale — do NOT use in new code.
        // The portal brand is NOT orange: headers are blue #2563EB and the action
        // color is green #16A34A (see src/lib/design-system.ts + DESIGN_GUIDE.md).
        // Kept only so the one remaining consumer (purchase/GuideOrder.tsx) builds;
        // it will be migrated off `krawings-*` and this scale removed.
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
