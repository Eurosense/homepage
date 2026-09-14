import Image from 'next/image'

import { BlockView } from '@/components/BlockRenderer'
import type { PositionedBlock, Placement, SectionGrid } from '@/lib/content'

const GAP_FALLBACK = '12px'

/**
 * Horizontal alignment came off `.sqs-block { justify-content }` and vertical
 * off `.sqs-block-alignment-wrapper { align-items }`. The cell here is a column
 * flex container, where the main axis is vertical — so the two swap.
 */
function alignmentCss(placement: Placement | undefined) {
  if (!placement) return ''
  const horizontal = placement.justify ? `align-items:${placement.justify};` : ''
  const vertical = placement.align ? `justify-content:${placement.align};` : ''
  return horizontal + vertical
}

function placementCss(
  selector: string,
  placement: Placement | undefined,
  { fullWidth = false }: { fullWidth?: boolean } = {},
) {
  if (!placement?.area) return ''
  const z = placement.zIndex === undefined ? '' : `z-index:${placement.zIndex};`
  /*
   * Document viewers keep their row but take the full content width. The
   * original cell was sized for a one-line "Download" link, and a PDF squeezed
   * into that is unreadable — the viewer is new, so it gets room to work.
   */
  const span = fullWidth
    ? `grid-column:2/-2;`
    : ''
  return `${selector}{grid-area:${placement.area};${span}${z}${alignmentCss(placement)}}`
}

/**
 * Rebuilds the CSS grid Squarespace generated for this section.
 *
 * The placements are reproduced rather than reinterpreted: the original site's
 * responsive behaviour is already encoded as an 8-column mobile grid and a
 * 24-column desktop one, so replaying both gives layout parity at every width
 * instead of an approximation of it.
 */
function sectionCss(gridId: string, grid: SectionGrid, blocks: PositionedBlock[]) {
  const mobile = grid.mobile ?? {}
  const desktop = grid.desktop ?? {}

  const mobileColumns = mobile.columns ?? 8
  const desktopColumns = desktop.columns ?? 24
  const mobileGap = mobile.columnGap ?? GAP_FALLBACK
  const desktopGap = desktop.columnGap ?? mobileGap

  const track = (columns: number, gap: string) =>
    `minmax(var(--fe-gutter),1fr) repeat(${columns},minmax(0,var(--fe-cell))) minmax(var(--fe-gutter),1fr)`
      .replace(/\s+/g, ' ') + `;--fe-gap:${gap}`

  const rules: string[] = []

  rules.push(
    `.${gridId}{` +
      `--fe-gutter:calc(var(--site-gutter-mobile) - ${mobileGap});` +
      `--fe-cell:calc((var(--site-max-width) - (${mobileGap} * (${mobileColumns} - 1))) / ${mobileColumns});` +
      'display:grid;position:relative;' +
      `grid-template-rows:repeat(${mobile.rows ?? 1},minmax(${mobile.rowMin ?? '24px'},auto));` +
      `grid-template-columns:${track(mobileColumns, mobileGap)};` +
      `row-gap:${mobile.rowGap ?? '8px'};column-gap:${mobileGap};` +
      'overflow-x:clip;' +
      '}',
  )

  rules.push(`.${gridId} > .fe-cell{display:flex;flex-direction:column;min-width:0;}`)

  blocks.forEach((block, i) => {
    rules.push(
      placementCss(`.${gridId} > [data-fe="${i}"]`, block.layout?.mobile, {
        fullWidth: block.type === 'document',
      }),
    )
  })

  const desktopRows = desktop.rows
    ? `grid-template-rows:repeat(${desktop.rows},minmax(calc(var(--fe-container) * ${
        desktop.rowScale ?? 0.0215
      }),auto));`
    : ''

  const desktopRules = [
    `.${gridId}{` +
      `--fe-gutter:calc(var(--site-gutter) - ${desktopGap});` +
      `--fe-cell:calc((var(--site-max-width) - (${desktopGap} * (${desktopColumns} - 1))) / ${desktopColumns});` +
      '--fe-container:min(var(--site-max-width),calc(100vw - var(--site-gutter) * 2));' +
      desktopRows +
      `grid-template-columns:${track(desktopColumns, desktopGap)};` +
      `column-gap:${desktopGap};` +
      '}',
    ...blocks.map((block, i) =>
      placementCss(`.${gridId} > [data-fe="${i}"]`, block.layout?.desktop, {
        fullWidth: block.type === 'document',
      }),
    ),
  ].filter(Boolean)

  rules.push(`@media (min-width:768px){${desktopRules.join('')}}`)

  return rules.filter(Boolean).join('')
}

export function FluidSection({
  id,
  grid,
  blocks,
  background,
  theme,
  minHeight,
}: {
  id: string
  grid: SectionGrid
  blocks: PositionedBlock[]
  background?: string
  theme?: string
  minHeight?: string
}) {
  const gridId = `fe-${id}`

  return (
    <section
      className="relative isolate"
      data-theme={theme ?? 'none'}
      data-has-background={background ? 'true' : undefined}
      style={minHeight ? { minHeight } : undefined}
    >
      {background ? (
        <Image
          src={background}
          alt=""
          aria-hidden
          fill
          sizes="100vw"
          className="-z-10 object-cover"
        />
      ) : null}

      <style>{sectionCss(gridId, grid, blocks)}</style>

      <div className={gridId}>
        {blocks.map((block, i) => (
          <div key={i} className="fe-cell" data-fe={i}>
            <BlockView block={block} />
          </div>
        ))}
      </div>
    </section>
  )
}
