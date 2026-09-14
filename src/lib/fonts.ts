import { Roboto } from 'next/font/google'
import localFont from 'next/font/local'

export const roboto = Roboto({
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '700'],
  display: 'swap',
  variable: '--font-roboto',
})

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
