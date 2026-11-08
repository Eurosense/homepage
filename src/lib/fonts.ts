import localFont from 'next/font/local'

/** Fetched by scripts/fonts.mjs. Run `npm run fonts` if src/fonts/ is empty. */
export const satoshi = localFont({
  src: [
    { path: '../fonts/Satoshi-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/Satoshi-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/Satoshi-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-satoshi',
})
