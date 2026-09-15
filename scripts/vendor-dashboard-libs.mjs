#!/usr/bin/env node
/**
 * Copies the dashboard's charting libraries out of node_modules into
 * public/dashboard-app/vendor/.
 *
 * The dashboard arrived from Squarespace loading six third-party CDNs
 * (Google Fonts, plot.ly, jsdelivr, cdnjs, code.highcharts.com). Three problems
 * with that on a site hosted in the EU:
 *
 *  - every visitor's IP is disclosed to four US CDNs before any consent prompt;
 *  - the references were unpinned, so `plotly-latest` silently means v1.58.5 —
 *    frozen since 2021 — and an echarts major bump could break the page with no
 *    commit to point at;
 *  - four cross-origin connections gate first render on the slowest one.
 *
 * Copying at build time rather than committing the bundles keeps ~4 MB of
 * minified third-party code out of a public repo while package.json still
 * records the exact versions and their licences.
 *
 * vendor/ is gitignored; `npm run build` regenerates it.
 */

import { mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ROOT = path.join(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'dashboard-app', 'vendor')

/*
 * plotly.js ships partial bundles. The dashboard only draws ternary plots, and
 * `scatterternary` lives in the cartesian bundle — 1.1 MB against 3.4 MB for the
 * full build, for the same output.
 */
const LIBS = [
  ['papaparse/papaparse.min.js', 'papaparse.min.js'],
  ['echarts/dist/echarts.min.js', 'echarts.min.js'],
  ['highcharts/highmaps.js', 'highmaps.js'],
  ['highcharts/modules/exporting.js', 'highmaps-exporting.js'],
  ['highcharts/modules/accessibility.js', 'highmaps-accessibility.js'],
  ['plotly.js-cartesian-dist-min/plotly-cartesian.min.js', 'plotly-cartesian.min.js'],
  // Not for the dashboard: the /eurosensers map fetches this topology at runtime,
  // and it is the last thing on the site that would otherwise reach a CDN.
  ['@highcharts/map-collection/custom/europe.topo.json', 'europe.topo.json'],
]

const FONTS = [
  ['@fontsource/inter/files/inter-latin-400-normal.woff2', 'inter-400.woff2', 400],
  ['@fontsource/inter/files/inter-latin-600-normal.woff2', 'inter-600.woff2', 600],
]

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

/** node_modules path for a file inside a package, without importing the package. */
function locate(spec) {
  const [scope, ...rest] = spec.split('/')
  const pkg = scope.startsWith('@') ? `${scope}/${rest.shift()}` : scope
  const pkgJson = require.resolve(`${pkg}/package.json`)
  return path.join(path.dirname(pkgJson), ...rest)
}

for (const [spec, name] of [...LIBS, ...FONTS.map(([s, n]) => [s, n])]) {
  await copyFile(locate(spec), path.join(OUT, name))
}

const fontCss = FONTS.map(
  ([, name, weight]) => `@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url('./${name}') format('woff2');
}`,
).join('\n\n')

await writeFile(path.join(OUT, 'inter.css'), `${fontCss}\n`)

// Record what was copied so a reader can tie a bundle to a version without
// unminifying it.
const versions = {}
for (const [spec] of [...LIBS, ...FONTS]) {
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
  if (versions[pkg]) continue
  versions[pkg] = JSON.parse(
    await readFile(require.resolve(`${pkg}/package.json`), 'utf8'),
  ).version
}
await writeFile(path.join(OUT, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`)

console.log(`Vendored ${LIBS.length} libraries and ${FONTS.length} font files into ${OUT}`)
for (const [pkg, version] of Object.entries(versions)) console.log(`  ${pkg}@${version}`)
