const path = require('path');

// Tailwind 3.x (we're on 3.2.4) resolves relative `content` globs against
// process.cwd() at the time the build runs, NOT against this config file's
// own directory (the `relative: true` option that would do that requires
// Tailwind 3.3+). `yarn dev:fast` happens to `cd` into platform/app first,
// so relative globs worked by coincidence, but `yarn build:fast` runs
// `rsbuild build` straight from the repo root - every `./...` and `../../...`
// glob below silently resolved to a nonexistent path and matched zero files,
// so production builds only ever scanned @ohif/ui (the one glob that
// happened to also resolve from root) and silently dropped every class from
// platform/app/src, extensions/, ui-next, modes/, and extension-* packages.
// Resolving to absolute, forward-slash paths here makes this correct
// regardless of the CWD the build is invoked from.
const abs = relPath => path.resolve(__dirname, relPath).split(path.sep).join('/');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Note: in Tailwind 3.0, JIT will purge unused styles by default
  // but in development, it is often useful to disable this to see
  // and try out all the styles that are available.
  // ...(process.env.NODE_ENV === 'development' && {
  //   safelist: [{ pattern: /.*/ }],
  // }),
  presets: [require('../ui/tailwind.config.js'), require('../ui-next/tailwind.config.js')],
  content: [
    abs('./src/**/*.{jsx,js,ts,tsx,css}'),
    abs('./public/**/*.js'),
    abs('../../extensions/**/*.{jsx,js,ts,tsx,css}'),
    abs('../ui/src/**/*.{jsx,js,ts,tsx,css}'),
    abs('../../modes/**/*.{jsx,js,ts,tsx,css}'),
    abs('./node_modules/@ohif/ui/src/**/*.{js,jsx,ts,tsx,css}'),
    abs('../../node_modules/@ohif/ui/src/**/*.{js,jsx,ts,tsx,css}'),
    abs('../../node_modules/@ohif/ui-next/src/**/*.{js,jsx,ts,tsx,css}'),
    abs('../../node_modules/@ohif/extension-*/src/**/*.{js,jsx,css,ts,tsx}'),
  ],
  theme: {
    fontFamily: {
      sans: [
        'Inter',
        'system-ui',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        '"Noto Sans"',
        'sans-serif',
        '"Apple Color Emoji"',
        '"Segoe UI Emoji"',
        '"Segoe UI Symbol"',
        '"Noto Color Emoji"',
      ],
      serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
      mono: ['Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
    },
    fontSize: {
      xxs: '0.625rem', // 10px
      xs: '0.6875rem', // 11px
      sm: '0.75rem', // 12px
      base: '0.8125rem', // 13px
      lg: '0.875rem', // 14px
      xl: '1rem', // 16px
      // 2xl and above will be updated in an upcoming version
      '2xl': '1.5rem',
      '3xl': '1.875rem',
      '4xl': '2.25rem',
      '5xl': '3rem',
      '6xl': '4rem',
    },
  },
};
