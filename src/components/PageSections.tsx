import { SectionView } from '@/components/BlockRenderer'
import { FluidSection } from '@/components/FluidSection'
import { PostList } from '@/components/PostList'
import type { Post, Section } from '@/lib/content'

/**
 * Sends each section to the renderer that matches how Squarespace built it:
 * fluid-engine sections keep their grid, older layout-engine sections fall back
 * to a single column, which is what they were anyway.
 */
export function PageSections({
  sections,
  posts = [],
}: {
  sections: Section[]
  /** Collection items, rendered where the page's `postList` block sits. */
  posts?: Post[]
}) {
  return (
    <>
      {sections.map((section, i) => {
        /*
         * The collection list keeps its position in the page. Appending it after
         * every section instead put the articles at the very bottom, below the
         * newsletter, where the original has them directly under the hero.
         */
        if (section.blocks.length === 1 && section.blocks[0].type === 'postList') {
          return (
            <section
              key={section.id ?? i}
              data-theme={section.theme ?? 'none'}
              className="py-10"
            >
              <PostList posts={posts} />
            </section>
          )
        }

        const positioned = section.grid && section.blocks.some((b) => b.layout?.mobile?.area)

        return positioned ? (
          <FluidSection
            key={section.id ?? i}
            id={section.id ?? `section-${i}`}
            grid={section.grid!}
            blocks={section.blocks}
            background={section.background}
            theme={section.theme}
            minHeight={section.minHeight}
            verticalAlign={section.verticalAlign}
          />
        ) : (
          <SectionView
            key={section.id ?? i}
            blocks={section.blocks}
            background={section.background}
            theme={section.theme}
            minHeight={section.minHeight}
            verticalAlign={section.verticalAlign}
          />
        )
      })}
    </>
  )
}
