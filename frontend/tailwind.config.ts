import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#1E3A5F',
          'navy-dark': '#0F1E30',
          'navy-light': '#2D4A73',
          'accent-blue': '#0F7ABF',
          'accent-blue-light': '#1E8FD4',
          'accent-blue-dark': '#0A5A99',
          teal: '#06B6D4',
          'teal-dark': '#0891B2',
        },
        neutral: {
          'bg-dark': '#0A0E27',
          'bg-card': '#111B35',
          'bg-hover': '#1A2847',
          'surface': '#16213E',
          'border': '#2D3E5F',
          'text-primary': '#F5F7FA',
          'text-secondary': '#B8BFCC',
          'text-tertiary': '#8B92A1',
        },
        status: {
          up: '#10B981',
          down: '#EF4444',
          neutral: '#6B7280',
          warning: '#F59E0B',
          critical: '#DC2626',
        },
      },
      backgroundColor: {
        dark: '#0A0E27',
        'dark-card': '#111B35',
        'dark-hover': '#1A2847',
      },
      textColor: {
        dark: '#F5F7FA',
        'dark-secondary': '#B8BFCC',
      },
      borderColor: {
        dark: '#2D3E5F',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-in': 'slide-in 0.3s ease-out',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.8' },
        },
        'slide-in': {
          from: { transform: 'translateX(-100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
