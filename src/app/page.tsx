import { notFound } from 'next/navigation'

import { SectionView } from '@/components/BlockRenderer'
import { getPage } from '@/lib/content'

export default function HomePage() {
  const page = getPage('/')
  if (!page) notFound()

  return (
    <>
      {page.sections.map((section, i) => (
        <SectionView key={section.id ?? i} blocks={section.blocks} background={section.background} />
      ))}
    </>
  )
}
