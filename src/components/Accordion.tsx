import { renderMarkdown } from '@/lib/markdown'

type Item = { title: string; markdown: string }

/**
 * Native <details> rather than a scripted disclosure: it is keyboard and
 * screen-reader accessible for free, works without JavaScript, and lets the
 * browser's find-in-page reach collapsed answers.
 */
export function Accordion({ items }: { items: Item[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.title} className="group py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-display text-lg font-medium text-purple-deep marker:hidden hover:text-purple">
            {item.title}
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              aria-hidden
              className="shrink-0 text-gold transition-transform group-open:rotate-45"
            >
              <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </summary>
          <div
            className="prose-eurosense mt-3"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.markdown) }}
          />
        </details>
      ))}
    </div>
  )
}
