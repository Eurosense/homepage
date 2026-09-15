import type { Block } from '@/lib/content'

type DocumentBlock = Extract<Block, { type: 'document' }>

/**
 * Shows a document inline instead of only linking to it.
 *
 * Drive files use Google's `/preview` endpoint — the `/view` URL the site links
 * to refuses to be framed. Local PDFs are framed directly; the browser's own
 * viewer handles them, which costs nothing and works offline.
 *
 * Title and description come first, then the viewer. The original listed each
 * publication as a one-line link followed by its abstract, and putting a frame
 * between the two left every description reading as stray text below an
 * unrelated PDF.
 *
 * Every viewer is `loading="lazy"`: the publications page stacks six of these,
 * and eager iframes would pull several megabytes before the reader scrolls.
 * Spreadsheets get no viewer at all, only a download — there is no
 * browser-native way to render one, and a broken frame is worse than an honest
 * link.
 */
export function DocumentEmbed({ block }: { block: DocumentBlock }) {
  const previewSrc =
    block.kind === 'drive' && block.driveId
      ? `https://drive.google.com/file/d/${block.driveId}/preview`
      : block.kind === 'pdf'
        ? `${block.href}#view=FitH`
        : null

  return (
    /*
     * Each document is a card rather than a run of text: six of these stack on
     * /storyboards, and with the title at body size and no rule between them the
     * page read as one undifferentiated column of PDF viewers.
     */
    <figure className="w-full border-t border-line/40 pt-8 pb-14 first:border-t-0 first:pt-0">
      <h3 className="font-display text-[length:calc(19.825px+0.31771vw)] leading-[1.176] font-bold text-[color:var(--sec-heading)]">
        <a
          href={block.href}
          target="_blank"
          rel="noreferrer noopener"
          className="no-underline hover:underline"
        >
          {block.title}
        </a>
      </h3>

      {block.description ? (
        <div
          className="prose-eurosense mt-3"
          dangerouslySetInnerHTML={{ __html: block.description }}
        />
      ) : null}

      {/*
        The original listed a "Download" next to every title, and a reader who
        wants the file rather than the viewer still needs it — an inline frame is
        awkward to read at length and useless on a slow connection.
      */}
      <a
        href={block.href}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-2 inline-block text-sm underline underline-offset-4"
        // Only a same-origin file can be given the download hint; a
        // cross-origin one is ignored by the browser anyway.
        download={block.kind === 'drive' ? undefined : ''}
      >
        Download
      </a>

      {previewSrc ? (
        <iframe
          src={previewSrc}
          title={block.title}
          loading="lazy"
          allow="autoplay"
          className="mt-4 h-[70vh] max-h-[820px] min-h-[420px] w-full rounded-xl border border-line bg-white"
        />
      ) : null}
    </figure>
  )
}
