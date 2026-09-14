#!/usr/bin/env node
/**
 * Refreshes public/dashboard-app/captures.csv from the SenseMaker API.
 *
 * Replaces the job that used to live in Medibunny/Eurosense, which started an
 * Express server, registered a node-cron schedule, then had the CI workflow curl
 * the server's own endpoint and kill it. All of that to make two HTTP requests,
 * which is what this does with no dependencies.
 *
 * Credentials come from the environment and are never written to disk or logged:
 *
 *   SENSEMAKER_PAT_ID     personal access token id, exchanged for a bearer token
 *   SENSEMAKER_FRAMEWORK  framework (project) whose captures are exported
 *   DASHBOARD_CSV_OUT     optional; where to write. The nightly workflow points
 *                         this at a staging directory it publishes to GitHub
 *                         Pages, so refreshing data does not commit to the site
 *                         repository and does not spend a deploybase build.
 *
 * Run it with `npm run dashboard:data`. The daily workflow runs the same script.
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const TOKEN_API = 'https://api.singularity.icatalyst.com/v2/api/personalaccesstokens'
const CAPTURES_API = 'https://api-gateway.sensemaker-suite.com/v2/frameworks'

const DEFAULT_OUT = path.join(
  import.meta.dirname,
  '..',
  'public',
  'dashboard-app',
  'captures.csv',
)
const OUT = process.env.DASHBOARD_CSV_OUT
  ? path.resolve(process.env.DASHBOARD_CSV_OUT)
  : DEFAULT_OUT

const patId = process.env.SENSEMAKER_PAT_ID
const framework = process.env.SENSEMAKER_FRAMEWORK

if (!patId || !framework) {
  console.error(
    'Missing credentials. Set SENSEMAKER_PAT_ID and SENSEMAKER_FRAMEWORK.\n' +
      'In CI these come from repository secrets; see README.',
  )
  process.exit(1)
}

/** Exchange the personal access token id for a short-lived bearer token. */
async function getBearerToken() {
  const res = await fetch(`${TOKEN_API}/${patId}/accesstoken`)
  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${res.statusText}`)
  const token = (await res.text()).trim()
  if (!token) throw new Error('Token request returned an empty body')
  return token
}

async function fetchCaptures(token) {
  const res = await fetch(`${CAPTURES_API}/${framework}/captures/`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/csv; version=1' },
  })
  if (!res.ok) {
    throw new Error(`Captures request failed: ${res.status} ${res.statusText}`)
  }
  return res.text()
}

const token = await getBearerToken()
const csv = await fetchCaptures(token)

/*
 * Refuse to overwrite good data with something obviously wrong. An auth or
 * gateway problem can still return 200 with an error page or an empty export,
 * and committing that would silently blank the dashboard.
 */
const lines = csv.trimEnd().split('\n').length
if (!csv.startsWith('id,project_id,') || lines < 2) {
  throw new Error(`Response does not look like the captures export (${lines} lines)`)
}

/*
 * Compare against the committed copy even when writing elsewhere: a staging
 * directory starts empty, and without a baseline the shrink guard below would
 * never fire on the run that matters.
 */
const baseline = existsSync(DEFAULT_OUT) ? DEFAULT_OUT : OUT
const previous = existsSync(baseline) ? await readFile(baseline, 'utf8') : ''
const previousLines = previous ? previous.trimEnd().split('\n').length : 0

if (previousLines && lines < previousLines * 0.5) {
  throw new Error(
    `Refusing to write: export shrank from ${previousLines} to ${lines} lines. ` +
      'Re-run once the API is healthy, or update the file by hand if the drop is real.',
  )
}

await mkdir(path.dirname(OUT), { recursive: true })
await writeFile(OUT, csv)

if (previous === csv) {
  console.log(`No change (${lines} rows).`)
  process.exit(0)
}
console.log(`Updated captures.csv: ${previousLines} -> ${lines} rows.`)
