/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        court: {
          wood: '#e7c993',
          line: '#1c1614',
        },
        // iOS-style dark surfaces
        ink: {
          900: '#000000',  // OLED black
          800: '#1c1c1e',  // iOS primary grouped background
          700: '#2c2c2e',  // iOS secondary grouped background
          600: '#3a3a3c',  // iOS separator
          500: '#8e8e93',  // iOS secondaryLabel
        },
        chalk: '#f5f5f7',    // Apple-style near-white
        rim: '#cc0000',      // Lawrence County red
        away: '#e8743b',     // keep orange for court opponent markers
        home: '#37b6c4',     // keep cyan for court home markers
      },
      fontFamily: {
        display: ['"Barlow Condensed"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
