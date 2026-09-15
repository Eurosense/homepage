import { renderMarkdown } from '@/lib/markdown'

type Item = { title: string; markdown: string; large?: boolean }

/**
 * Native <details> rather than a scripted disclosure: it is keyboard and
 * screen-reader accessible for free, works without JavaScript, and lets the
 * browser's find-in-page reach collapsed answers.
 *
 * `expandFirst` mirrors Squarespace's own setting. It matters for layout, not
 * just for taste: the author sized the grid row around an open first answer, so
 * rendering everything collapsed left the reserved rows empty.
 *
 * The title is the h3 type scale (24.4px at 1440) at weight 700, measured from
 * the live site.
 */
export function Accordion({ items, expandFirst }: { items: Item[]; expandFirst?: boolean }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item, i) => (
        <details
          key={item.title}
          /* 30px item padding and 15px below the answer, measured from the block's own CSS. */
          className="accordion-item group py-[30px]"
          open={expandFirst && i === 0}
        >
          <summary className="font-display flex cursor-pointer list-none items-center justify-between gap-4 text-left text-[length:calc(19.825px+0.31771vw)] leading-[1.176] font-bold text-purple marker:hidden hover:opacity-80">
            {item.title}
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              aria-hidden
              className="shrink-0 text-gold transition-transform group-open:rotate-45"
            >
              <path
                d="M10 4v12M4 10h12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </summary>
          <div
            className={`prose-eurosense pb-[15px] ${item.large ? 'sqsrte-large mt-4' : 'mt-3'}`}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.markdown) }}
          />
        </details>
      ))}
    </div>
  )
}
