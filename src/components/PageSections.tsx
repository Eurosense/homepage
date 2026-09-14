import { SectionView } from '@/components/BlockRenderer'
import { FluidSection } from '@/components/FluidSection'
import type { Section } from '@/lib/content'

/**
 * Sends each section to the renderer that matches how Squarespace built it:
 * fluid-engine sections keep their grid, older layout-engine sections fall back
 * to a single column, which is what they were anyway.
 */
export function PageSections({ sections }: { sections: Section[] }) {
  return (
    <>
      {sections.map((section, i) => {
        const positioned = section.grid && section.blocks.some((b) => b.layout?.mobile?.area)

        return positioned ? (
          <FluidSection
            key={section.id ?? i}
            id={section.id ?? `section-${i}`}
            grid={section.grid!}
            blocks={section.blocks}
            background={section.background}
            theme={section.theme}
          />
        ) : (
          <SectionView
            key={section.id ?? i}
            blocks={section.blocks}
            background={section.background}
            theme={section.theme}
          />
        )
      })}
    </>
  )
}
