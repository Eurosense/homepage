import { marked } from 'marked'

marked.use({
  gfm: true,
  breaks: false,
})

/**
 * Renders Markdown from `content/` to HTML at build time.
 *
 * Output is not sanitised. The input is first-party content from this
 * repository, and it intentionally contains raw HTML — the extractor preserves
 * `<iframe>` embeds for third-party apps that the site depends on. Sanitising
 * would strip them. Treat `content/` as trusted code, reviewed through pull
 * requests like any other file here.
 */
export function renderMarkdown(md: string): string {
  return marked.parse(md, { async: false })
}
