import Image from 'next/image'

import { BlockView } from '@/components/BlockRenderer'
import { pairDocumentDescriptions } from '@/lib/pairDocuments'
import type { PositionedBlock, Placement, SectionGrid, SectionDivider } from '@/lib/content'

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
  const span = fullWidth ? `grid-column:2/-2;` : ''
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
/** `"6/2/17/10"` → `[rowStart, colStart, rowEnd, colEnd]`, or null if not a grid area. */
function parseArea(area: string | undefined) {
  if (!area) return null
  const parts = area.split('/').map((n) => Number.parseInt(n.trim(), 10))
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null
}

function overlaps(a: number[], b: number[]) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
}

/** Rough perceived lightness of an `hsl(h s% l% / a)` fill, 0–100. */
function lightnessOf(colour: string) {
  const match = colour.match(/hsla?\([^)]*?([\d.]+)%\s*\/?[^)]*\)$/)
  return match ? Number.parseFloat(match[1]) : 100
}

/** Indices of blocks that sit on top of a dark `shape` block in the same grid. */
function cellsOverDarkShape(blocks: PositionedBlock[]) {
  const panels = blocks
    .filter((b) => b.type === 'shape' && lightnessOf(String(b.fill ?? '')) < 50)
    .map((b) => parseArea(b.layout?.desktop?.area ?? b.layout?.mobile?.area))
    .filter((a): a is number[] => a !== null)

  if (!panels.length) return []

  return blocks.flatMap((block, index) => {
    if (block.type === 'shape') return []
    const area = parseArea(block.layout?.desktop?.area ?? block.layout?.mobile?.area)
    if (!area) return []
    return panels.some((panel) => overlaps(area, panel)) ? [index] : []
  })
}

function sectionCss(gridId: string, grid: SectionGrid, blocks: PositionedBlock[]) {
  const mobile = grid.mobile ?? {}
  const desktop = grid.desktop ?? {}

  const mobileColumns = mobile.columns ?? 8
  const desktopColumns = desktop.columns ?? 24
  const mobileGap = mobile.columnGap ?? GAP_FALLBACK
  const desktopGap = desktop.columnGap ?? mobileGap

  const track = (columns: number, gap: string) =>
    `minmax(var(--fe-gutter),1fr) repeat(${columns},minmax(0,var(--fe-cell))) minmax(var(--fe-gutter),1fr)`.replace(
      /\s+/g,
      ' ',
    ) + `;--fe-gap:${gap}`

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

  /*
   * Rich text fills its cell. Squarespace lays a block out as a row flex
   * container whose child stretches to the full width, so `text-align` inside
   * the text does the centring. Our cell is a column, where the placement's
   * horizontal alignment becomes `align-items` — and `flex-start` there shrinks
   * the text to its own width, which silently cancelled every `text-align:
   * center` in the content.
   */
  rules.push(`.${gridId} > .fe-cell > .prose-eurosense{width:100%;}`)

  /*
   * A cell sitting on a dark shape panel takes the light-on-dark colours, not
   * the section's. On /resources the three cards are text blocks laid over a
   * purple-deep shape block, so they read as gold on purple while the section's
   * own heading a row above is on cream — one theme, two backgrounds. The panel
   * is a sibling in the grid rather than an ancestor, so the cascade cannot work
   * this out and the overlap has to be computed.
   */
  for (const index of cellsOverDarkShape(blocks)) {
    rules.push(
      `.${gridId} > [data-fe="${index}"]{` +
        `--sec-heading:var(--color-gold);--sec-text:var(--color-gold);` +
        `color:var(--color-gold);}`,
    )
  }

  /*
   * A block can carry its own background, radius and padding — the white pills
   * behind the numbered steps are text blocks styled this way. It goes on the
   * cell because that is the element Squarespace paints (`.sqs-block`), and the
   * cell is what the grid sizes.
   */
  blocks.forEach((block, i) => {
    const surface = block.surface
    if (!surface) return
    const declarations = [
      surface.background ? `background-color:${surface.background};` : '',
      surface.radius ? `border-radius:${surface.radius};` : '',
      surface.padding ? `padding:${surface.padding};justify-content:center;` : '',
    ].join('')
    if (declarations) rules.push(`.${gridId} > [data-fe="${i}"]{${declarations}}`)
  })

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
  blocks: rawBlocks,
  background,
  theme,
  minHeight,
  verticalAlign,
  divider,
  nextTheme,
}: {
  id: string
  grid: SectionGrid
  blocks: PositionedBlock[]
  background?: string
  theme?: string
  minHeight?: string
  verticalAlign?: 'start' | 'center' | 'end'
  divider?: SectionDivider
  /**
   * The theme of the section below. A divider cuts a shape out of this section,
   * and what shows through the cut is the next section's background — that is
   * what makes a wedge read as a join between two panels rather than a hole.
   */
  nextTheme?: string
}) {
  const gridId = `fe-${id}`
  const blocks = pairDocumentDescriptions(rawBlocks)
  const clipId = `divider-${id}`

  return (
    <section
      className="relative isolate"
      data-theme={theme ?? 'none'}
      data-has-background={background ? 'true' : undefined}
      data-divider={divider ? 'true' : undefined}
      /*
       * The grid is centred in a section taller than itself, which is how the
       * original lays these out. Left at the top, every hero sat jammed under
       * the header.
       */
      style={{
        ...(minHeight ? { minHeight } : {}),
        ...(divider ? { ['--divider-height' as string]: divider.height } : {}),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: verticalAlign ?? 'start',
      }}
    >
      {divider ? (
        <>
          {/*
           * clipPathUnits="objectBoundingBox" makes the path coordinates
           * fractions of the element, which is how the measured path is
           * expressed — so one path works at every viewport width.
           */}
          <svg width="0" height="0" aria-hidden className="absolute">
            <clipPath id={clipId} clipPathUnits="objectBoundingBox">
              <path d={divider.path} />
            </clipPath>
          </svg>
          {/*
           * What the divider cuts away shows the next section, so that colour is
           * painted underneath. Relying on the page background instead only
           * looked right where the two happened to agree: on /newsletter the
           * wedge came out purple over a white footer.
           */}
          <div className="section-under" data-theme={nextTheme ?? 'none'} />
        </>
      ) : null}

      {/*
       * The colour and the background image are one clipped layer, not two.
       * Keeping them separate put the fill above the image and painted cream
       * over the whole of /newsletter's blue panel, leaving its white headings
       * on cream — in the DOM and invisible. The divider has to cut the image
       * too, or it spills into the wedge the shape carves out.
       */}
      {divider || background ? (
        <div
          className="section-fill"
          style={divider ? { clipPath: `url(#${clipId})` } : undefined}
        >
          {background ? (
            <Image
              src={background}
              alt=""
              aria-hidden
              fill
              sizes="100vw"
              className="object-cover"
            />
          ) : null}
        </div>
      ) : null}

      <style>{sectionCss(gridId, grid, blocks)}</style>

      <div className={`${gridId} w-full`}>
        {blocks.map((block, i) => (
          <div key={i} className="fe-cell" data-fe={i}>
            <BlockView block={block} />
          </div>
        ))}
      </div>
    </section>
  )
}
