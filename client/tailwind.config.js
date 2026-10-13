/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0B2545',
          50: '#EAF0F7',
          100: '#D3E0EF',
          600: '#123A6B',
          800: '#0B2545',
          900: '#071a33',
        },
        brand: {
          DEFAULT: '#1E9E5A',
          50: '#EAF6EE',
          100: '#D2ECDC',
          600: '#178a4d',
          700: '#116b3b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(11,37,69,0.06), 0 4px 16px rgba(11,37,69,0.06)',
      },
    },
  },
  plugins: [],
};
