import fs from 'node:fs'
import path from 'node:path'

type FormEntry = {
  name: string
  deploybaseFormId: string | null
}

type FormsFile = {
  forms: Record<string, FormEntry>
}

const FORMS_PATH = path.join(process.cwd(), 'content', 'forms.json')

function readForms(): FormsFile {
  return JSON.parse(fs.readFileSync(FORMS_PATH, 'utf8')) as FormsFile
}

/**
 * Resolves a Squarespace form id to its deploybase POST endpoint, or null when
 * the form has not been reconnected yet. Callers must handle null by refusing
 * to render a working-looking form — see ContactForm.
 */
export function getFormEndpoint(squarespaceFormId: string): string | null {
  const entry = readForms().forms[squarespaceFormId]
  if (!entry?.deploybaseFormId) return null
  return `https://api.deploybase.eu/f/${entry.deploybaseFormId}`
}

/** Squarespace form ids that still have no deploybase endpoint. */
export function unmappedForms(): { id: string; name: string }[] {
  return Object.entries(readForms().forms)
    .filter(([, entry]) => !entry.deploybaseFormId)
    .map(([id, entry]) => ({ id, name: entry.name }))
}
