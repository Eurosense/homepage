import { notFound } from 'next/navigation'

import { PageSections } from '@/components/PageSections'
import { getPage } from '@/lib/content'

export default function HomePage() {
  const page = getPage('/')
  if (!page) notFound()

  return <PageSections sections={page.sections} />
}
