/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        surface: {
          DEFAULT: 'var(--surface)',
          muted: 'var(--surface-muted)',
          elevated: 'var(--surface-elevated)',
        },
        border: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          hover: 'var(--brand-hover)',
          soft: 'var(--brand-soft)',
          foreground: 'var(--brand-foreground)',
        },
        'text-main': 'var(--text-primary)',
        'text-sub': 'var(--text-secondary)',
        'text-subtle': 'var(--text-subtle)',
        semantic: {
          morning: {
            bg: 'var(--morning-surface)',
            border: 'var(--morning-border)',
            accent: 'var(--morning-accent)',
            text: 'var(--morning-text)',
          },
          night: {
            bg: 'var(--night-surface)',
            border: 'var(--night-border)',
            accent: 'var(--night-accent)',
            text: 'var(--night-text)',
          },
          taking: {
            bg: 'var(--taking-surface)',
            border: 'var(--taking-border)',
            accent: 'var(--taking-accent)',
            text: 'var(--taking-text)',
          },
          skip: {
            bg: 'var(--skip-surface)',
            border: 'var(--skip-border)',
            accent: 'var(--skip-accent)',
            text: 'var(--skip-text)',
          },
          shared: {
            bg: 'var(--shared-surface)',
            border: 'var(--shared-border)',
            accent: 'var(--shared-accent)',
            text: 'var(--shared-text)',
          },
          warning: {
            bg: 'var(--warning-surface)',
            border: 'var(--warning-border)',
            accent: 'var(--warning-accent)',
            text: 'var(--warning-text)',
          },
          danger: {
            bg: 'var(--danger-surface)',
            border: 'var(--danger-border)',
            accent: 'var(--danger-accent)',
            text: 'var(--danger-text)',
          },
        },
      },
      borderRadius: {
        sm: '8px',
        md: '10px',
        lg: '12px',
        xl: '16px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.04)',
        DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        md: '0 4px 12px -2px rgb(0 0 0 / 0.05), 0 2px 6px -2px rgb(0 0 0 / 0.04)',
        lg: '0 10px 24px -4px rgb(0 0 0 / 0.07), 0 4px 8px -3px rgb(0 0 0 / 0.04)',
      },
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      maxWidth: {
        container: '1160px',
      },
    },
  },
  plugins: [],
};
