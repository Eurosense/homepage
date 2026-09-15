import type { PositionedBlock, Placement } from '@/lib/content'

/**
 * Merges each document block with the description that follows it.
 *
 * On the original site a publication was a one-line link followed by a separate
 * paragraph in its own grid cell. Embedding a viewer in the link's cell pushed
 * that paragraph below the frame, so every description read as loose text
 * between two PDFs. Pairing them restores the original reading order — title,
 * then description — and puts the viewer underneath, where it does not separate
 * a heading from the text belonging to it.
 *
 * The two cells occupy adjacent rows of the same grid, so the merged block takes
 * the union of their areas and the section's layout is otherwise untouched.
 */

/** `row-start/column-start/row-end/column-end`, Squarespace's grid-area order. */
function parseArea(area: string) {
  const parts = area.split('/').map((n) => Number.parseInt(n.trim(), 10))
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null
}

function mergePlacement(a: Placement | undefined, b: Placement | undefined) {
  if (!a?.area) return b
  if (!b?.area) return a

  const first = parseArea(a.area)
  const second = parseArea(b.area)
  if (!first || !second) return a

  const area = [
    Math.min(first[0], second[0]),
    Math.min(first[1], second[1]),
    Math.max(first[2], second[2]),
    Math.max(first[3], second[3]),
  ].join('/')

  return { ...a, area }
}

export function pairDocumentDescriptions(blocks: PositionedBlock[]): PositionedBlock[] {
  const out: PositionedBlock[] = []

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const next = blocks[i + 1]

    if (block.type === 'document' && next?.type === 'richText') {
      out.push({
        ...block,
        description: next.html,
        layout: {
          mobile: mergePlacement(block.layout?.mobile, next.layout?.mobile),
          desktop: mergePlacement(block.layout?.desktop, next.layout?.desktop),
        },
      })
      i++
      continue
    }

    out.push(block)
  }

  return out
}
