/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── Premium neutral scale (Linear/Vercel-like hierarchy) ──
        // Page #000000 → secondary #0A0A0B → surface #000000 (pure-black chrome).
        // Numeric increase = darker, preserving Tailwind ordering.
        dark: {
          50: '#F2F4F7',
          100: '#DCE1E7',
          200: '#B9C1CB',
          300: '#98A1AD',
          400: '#98A1AD',
          500: '#66707C',
          600: '#3A424D',
          700: '#272D35',
          800: '#000000',
          900: '#0A0A0B',
          950: '#000000',
        },
        // ── Primary accent: restrained soft blue ──
        primary: {
          50: '#EEF1FF',
          100: '#DDE4FF',
          200: '#C3CFFF',
          300: '#A4B9FF',
          400: '#829EFF',
          500: '#6C8CFF',
          600: '#6C8CFF',
          700: '#5569C4',
          800: '#3D4C8F',
          900: '#2A3358',
          950: '#181D33',
        },
        // ── Layered surfaces (explicit tokens, §29) ──
        background: '#000000',
        'background-secondary': '#0A0A0B',
        surface: '#000000',
        'surface-hover': '#101012',
        'surface-active': '#18181b',
        appborder: '#272D35',
        'appborder-subtle': '#20252C',
        // ── Text tokens ──
        'text-primary': '#F2F4F7',
        'text-secondary': '#98A1AD',
        'text-muted': '#66707C',
        // ── Muted semantic colors ──
        success: {
          DEFAULT: '#4CAF82',
          muted: 'rgba(76, 175, 130, 0.12)',
        },
        warning: {
          DEFAULT: '#D6A85A',
          muted: 'rgba(214, 168, 90, 0.12)',
        },
        danger: {
          DEFAULT: '#D66B72',
          muted: 'rgba(214, 107, 114, 0.12)',
        },
        info: {
          DEFAULT: '#6C8CFF',
          muted: 'rgba(108, 140, 255, 0.12)',
        },
        worker: {
          bg: '#0B0E14',
          surface: '#12161F',
          'surface-2': '#171C27',
          border: '#232A38',
          text: '#E7EAF2',
          'text-muted': '#93A0B4',
          'text-faint': '#5C6779',
          accent: '#7C86FF',
          'accent-hover': '#8F98FF',
          success: '#34D399',
          warning: '#F5B454',
          danger: '#FB7185',
          info: '#7C86FF',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
        display: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '10px',
        xl: '12px',
      },
      boxShadow: {
        pop: '0 12px 32px rgba(0, 0, 0, 0.25)',
        subtle: '0 1px 2px rgba(0, 0, 0, 0.2)',
      },
      backgroundImage: {
        'wallet-gradient': 'linear-gradient(135deg, #5B63D8 0%, #7C86FF 55%, #9B7BFF 100%)',
      },
    },
  },
  plugins: [],
};
