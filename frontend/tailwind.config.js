/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        cream:      '#FFF3DE',
        ink:        '#0A0A0A',
        warm: {
          50:  '#FFFBF3',
          100: '#FBF0DD',
          200: '#F0E2C4',
          300: '#DCCDA8',
          400: '#A99A80',
          500: '#6F6252',
          600: '#4A4038',
        },
        terra:         '#FF4D4D',
        'terra-light': '#FF8A8A',
        'terra-dark':  '#D62E2E',
        sage:          '#2FD675',
        'sage-light':  '#7CEBA6',
        'sage-dark':   '#1AA855',
        amber:         '#FFB800',
        'amber-light': '#FFD666',
        'amber-dark':  '#D99400',
        invest:        '#6C5CE7',
        'invest-light':'#9C90F5',
        'invest-dark':  '#4B3AC4',
        border:        '#0A0A0A',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderWidth: {
        DEFAULT: '2px',
      },
      borderRadius: {
        'hero': '24px',
        'card': '18px',
        'item': '12px',
      },
      boxShadow: {
        'brutal':      '6px 6px 0px 0px rgba(10,10,10,1)',
        'brutal-sm':   '4px 4px 0px 0px rgba(10,10,10,1)',
        'brutal-lg':   '9px 9px 0px 0px rgba(10,10,10,1)',
        'brutal-xs':   '2px 2px 0px 0px rgba(10,10,10,1)',
        'brutal-white':'6px 6px 0px 0px rgba(255,255,255,1)',
      },
    },
  },
  plugins: [],
}
