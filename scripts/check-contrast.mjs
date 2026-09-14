#!/usr/bin/env node
/**
 * Fails when a section theme paints text in its own background colour.
 *
 * This exact bug shipped three times during the migration: headings rendered
 * gold on gold, purple on purple, and dark-on-dark. Every time the content was
 * in the DOM, the build was green, the links resolved and the responsive sweep
 * was clean — the words were simply invisible.
 *
 * Reads the theme blocks out of globals.css and resolves the custom properties
 * itself, so it needs no browser and runs in CI.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

const CSS = path.join(import.meta.dirname, '..', 'src', 'app', 'globals.css')
const css = await readFile(CSS, 'utf8')

/** The palette from the @theme block: --color-x: #hex. */
const palette = Object.fromEntries(
  [...css.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map((m) => [
    `--color-${m[1]}`,
    m[2].toLowerCase(),
  ]),
)

/** Resolve a value that may be a literal colour or a var() into the palette. */
function resolve(value) {
  const trimmed = value.trim()
  const varMatch = trimmed.match(/^var\((--[a-z-]+)\)$/)
  if (varMatch) return palette[varMatch[1]] ?? null
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed.toLowerCase()
  return null
}

/** Expand #abc to #aabbcc so two spellings of one colour compare equal. */
function normalise(hex) {
  if (!hex) return null
  if (hex.length === 4) return `#${[...hex.slice(1)].map((c) => c + c).join('')}`
  return hex.slice(0, 7)
}

/*
 * Each `[data-theme=...] { ... }` block, including the base `[data-theme]` one
 * whose values every other theme inherits unless it overrides them.
 */
const blocks = [...css.matchAll(/\[data-theme(?:=['"]([a-z-]+)['"])?\]([^{]*)\{([^}]*)\}/g)]

const base = {}
const themes = new Map()

for (const [, name, extraSelector, body] of blocks) {
  // Skip compound selectors like [data-theme][data-has-background='true'].
  if (extraSelector.trim() && !name) continue

  const props = {}
  for (const decl of body.split(';')) {
    const [rawKey, ...rest] = decl.split(':')
    const key = rawKey.trim()
    if (!key.startsWith('--sec-')) continue
    props[key] = normalise(resolve(rest.join(':')))
  }

  if (!name) Object.assign(base, props)
  else themes.set(name, { ...base, ...props })
}

// Themes that only inherit still need checking.
for (const [name, props] of themes) themes.set(name, { ...base, ...props })

const CHECKS = [
  ['--sec-heading', '--sec-bg', 'headings'],
  ['--sec-text', '--sec-bg', 'body text'],
  ['--sec-btn-outline', '--sec-bg', 'outlined buttons'],
  ['--sec-btn-text', '--sec-btn-bg', 'button labels'],
]

const problems = []
for (const [name, props] of themes) {
  for (const [fg, bg, what] of CHECKS) {
    if (!props[fg] || !props[bg]) continue
    if (props[fg] === props[bg]) {
      problems.push(`theme "${name}": ${what} are ${props[fg]} on ${props[bg]} — invisible`)
    }
  }
}

console.log(
  `${themes.size} section themes checked against ${Object.keys(palette).length} palette colours.`,
)

if (problems.length) {
  console.error(`\n${problems.length} theme(s) paint content in their own background:\n`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('\nMeasure the real values on the live site; see DESIGN.md.')
  process.exit(1)
}

console.log('No theme paints text in its own background colour.')
