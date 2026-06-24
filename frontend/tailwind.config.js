/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream:      '#FAF7F2',
        warm: {
          50:  '#FEFCF9',
          100: '#FAF7F2',
          200: '#F3EDE4',
          300: '#E8DFD2',
          400: '#D4C8B8',
          500: '#B5A898',
          600: '#8F8274',
        },
        terra:      '#C4603A',
        'terra-light': '#D4774F',
        'terra-dark':  '#A84E2E',
        sage:       '#6B8F71',
        'sage-light': '#7FA886',
        'sage-dark':  '#577358',
        amber:      '#D4933A',
        'amber-light': '#E0A84F',
        border:     '#E8DFD2',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        'hero': '20px',
        'card': '16px',
        'item': '12px',
      },
    },
  },
  plugins: [],
}
