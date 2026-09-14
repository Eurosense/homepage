import type { Block } from '@/lib/content'

type DocumentBlock = Extract<Block, { type: 'document' }>

/**
 * Shows a document inline instead of only linking to it.
 *
 * Drive files use Google's `/preview` endpoint — the `/view` URL the site links
 * to refuses to be framed. Local PDFs are framed directly; the browser's own
 * viewer handles them, which costs nothing and works offline.
 *
 * Every viewer is `loading="lazy"`: the publications page stacks five of these,
 * and eager iframes would pull several megabytes before the reader scrolls.
 * Spreadsheets get no viewer at all, only a download — there is no browser-native
 * way to render one, and a broken frame is worse than an honest link.
 */
export function DocumentEmbed({ block }: { block: DocumentBlock }) {
  const previewSrc =
    block.kind === 'drive' && block.driveId
      ? `https://drive.google.com/file/d/${block.driveId}/preview`
      : block.kind === 'pdf'
        ? `${block.href}#view=FitH`
        : null

  return (
    <figure className="w-full">
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-display text-lg font-medium">{block.title}</span>
        <a
          href={block.href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm underline underline-offset-4"
          // Only a same-origin file can be given the download hint; a
          // cross-origin one is ignored by the browser anyway.
          download={block.kind !== 'drive' ? '' : undefined}
        >
          {block.kind === 'drive' ? 'Open in Google Drive' : 'Download'}
        </a>
      </figcaption>

      {previewSrc ? (
        <iframe
          src={previewSrc}
          title={block.title}
          loading="lazy"
          allow="autoplay"
          className="h-[70vh] max-h-[820px] min-h-[420px] w-full rounded-xl border border-line bg-white"
        />
      ) : null}
    </figure>
  )
}
