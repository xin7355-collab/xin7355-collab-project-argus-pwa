/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Tactical radar palette
        tactical: {
          bg: '#0f172a', // slate-900
          panel: '#1e293b', // slate-800
          green: '#34d399', // emerald-400
          cyan: '#22d3ee', // cyan-400
          alert: '#f43f5e', // rose-500
        },
      },
      keyframes: {
        'pulse-alert': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        sweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'pulse-alert': 'pulse-alert 1s ease-in-out infinite',
        sweep: 'sweep 4s linear infinite',
      },
    },
  },
  plugins: [],
}
