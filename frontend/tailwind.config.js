/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream:      '#FAFAFA',
        warm: {
          50:  '#FAFAFA',
          100: '#F5F5F5',
          200: '#E5E5E5',
          300: '#D4D4D4',
          400: '#A3A3A3',
          500: '#737373',
          600: '#525252',
        },
        terra:         '#0A0A0A',
        'terra-light': '#262626',
        'terra-dark':  '#000000',
        sage:          '#525252',
        'sage-light':  '#737373',
        'sage-dark':   '#404040',
        amber:         '#737373',
        'amber-light': '#8A8A8A',
        border:        '#E5E5E5',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        'hero': '20px',
        'card': '16px',
        'item': '12px',
      },
      boxShadow: {
        'premium': '0 1px 3px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)',
      },
    },
  },
  plugins: [],
}
