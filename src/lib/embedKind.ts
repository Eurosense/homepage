/**
 * What a third-party embed is, so a click-to-load placeholder can name it.
 *
 * Every embed on the site is held back until the reader asks for it, which only
 * works if the placeholder says what they would be loading. "Load the form" over
 * a conference recording is worse than no gate at all — people click past a
 * button they cannot read a reason into.
 *
 * `note` is what actually happens on load, not a blanket cookie warning: Kumu
 * sets storage and Google sets cookies, and saying so only where it is true
 * keeps the claim checkable.
 */
export type EmbedKind = {
  /** Heading for the placeholder, e.g. "Presentation slides". */
  label: string
  /** The embed as a reader would name it, for "Load the …". Kept separate from
   *  `label` because "Load the Presentation slides" does not read. */
  noun: string
  /** Who hosts it, shown so the reader knows whose content it is. */
  provider: string
  /** One sentence on what loading it does. */
  note: string
}

const GOOGLE_NOTE = 'Google sets cookies when it loads.'

export function describeEmbed(src: string): EmbedKind {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return { label: 'Embedded content', noun: 'content', provider: 'another site', note: '' }
  }

  const provider = url.hostname.replace(/^www\./, '')
  const path = url.pathname

  if (provider === 'drive.google.com' && path.includes('/file/')) {
    return {
      label: 'Video recording',
      noun: 'video',
      provider: 'Google Drive',
      note: GOOGLE_NOTE,
    }
  }
  if (provider === 'docs.google.com' && path.includes('/presentation/')) {
    return {
      label: 'Presentation slides',
      noun: 'slides',
      provider: 'Google Slides',
      note: GOOGLE_NOTE,
    }
  }
  if (provider.endsWith('kumu.io')) {
    return {
      label: 'Interactive map',
      noun: 'map',
      provider: 'Kumu',
      note: 'Kumu stores data in your browser.',
    }
  }
  if (provider.endsWith('sensemaker-suite.com')) {
    return {
      label: 'Story collection form',
      noun: 'form',
      provider: 'SenseMaker',
      note: 'It loads Google Analytics and Tag Manager, which set cookies.',
    }
  }
  if (provider.endsWith('youtube.com') || provider === 'youtu.be') {
    return { label: 'Video', noun: 'video', provider: 'YouTube', note: GOOGLE_NOTE }
  }
  if (provider === 'gstatic.com' && path.includes('df-messenger')) {
    return {
      label: 'Chat assistant',
      noun: 'chat assistant',
      provider: 'Google Dialogflow',
      note: GOOGLE_NOTE,
    }
  }
  if (provider.endsWith('elfsight.com')) {
    return {
      label: 'Social media feed',
      noun: 'feed',
      provider: 'Elfsight',
      note: 'Elfsight sets cookies and stores data in your browser.',
    }
  }

  return { label: 'Embedded content', noun: 'content', provider, note: '' }
}
