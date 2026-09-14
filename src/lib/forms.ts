import fs from 'node:fs'
import path from 'node:path'

export type FormTarget =
  | { provider: 'hubspot'; portalId: string; formId: string; region: string }
  | { provider: 'deploybase'; endpoint: string }
  | null

type FormEntry = {
  name: string
  provider?: 'hubspot' | 'deploybase' | null
  deploybaseFormId?: string | null
  hubspot?: { portalId?: string; formId?: string; region?: string }
}

type FormsFile = {
  hubspotDefaults?: { portalId?: string; region?: string }
  forms: Record<string, FormEntry>
}

const FORMS_PATH = path.join(process.cwd(), 'content', 'forms.json')

function readForms(): FormsFile {
  return JSON.parse(fs.readFileSync(FORMS_PATH, 'utf8')) as FormsFile
}

/**
 * Resolves a Squarespace form id to whatever now handles it.
 *
 * Returns null when the form has no provider yet. Callers must treat that as
 * "do not render a working-looking form" — see ContactForm.
 */
export function getFormTarget(squarespaceFormId: string): FormTarget {
  const file = readForms()
  const entry = file.forms[squarespaceFormId]
  if (!entry) return null

  if (entry.provider === 'hubspot') {
    const portalId = entry.hubspot?.portalId ?? file.hubspotDefaults?.portalId
    const formId = entry.hubspot?.formId
    if (!portalId || !formId) return null
    return {
      provider: 'hubspot',
      portalId,
      formId,
      region: entry.hubspot?.region ?? file.hubspotDefaults?.region ?? 'na1',
    }
  }

  if (entry.deploybaseFormId) {
    return {
      provider: 'deploybase',
      endpoint: `https://api.deploybase.eu/f/${entry.deploybaseFormId}`,
    }
  }

  return null
}

/** Squarespace form ids that still have no provider. */
export function unconnectedForms(): { id: string; name: string }[] {
  return Object.entries(readForms().forms)
    .filter(([, entry]) => !getFormTargetFor(entry))
    .map(([id, entry]) => ({ id, name: entry.name }))
}

function getFormTargetFor(entry: FormEntry): boolean {
  if (entry.provider === 'hubspot') return Boolean(entry.hubspot?.formId)
  return Boolean(entry.deploybaseFormId)
}
