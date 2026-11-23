import * as Chunk from "effect/Chunk"
import * as T from "./templates.js"

export interface LayoutState {
  readonly tag: string
  readonly kepub: boolean
  readonly manifest: Chunk.Chunk<string>
  readonly spine: Chunk.Chunk<string>
  readonly toc: Chunk.Chunk<string>
  readonly nav: Chunk.Chunk<string>
  readonly pagesInVolume: ReadonlyMap<number, number>
  readonly nextSideRight: boolean
  readonly isFirstContentPage: boolean
}

export const empty = (tag: string, kepub = false): LayoutState => ({
  tag,
  kepub,
  manifest: Chunk.empty(),
  spine: Chunk.empty(),
  toc: Chunk.empty(),
  nav: Chunk.empty(),
  pagesInVolume: new Map(),
  nextSideRight: true,
  isFirstContentPage: true
})

export interface PlacedPage {
  readonly volume: number
  readonly name: string
  readonly imagePath: string
  readonly xhtmlPath: string
  readonly xhtml: string
}

export const addPage = (
  state: LayoutState,
  volume: number,
  width: number,
  height: number
): readonly [LayoutState, PlacedPage] => {
  const index = state.pagesInVolume.get(volume) ?? 0
  const { tag } = state
  const vol = `volume-${String(volume).padStart(4, "0")}`
  const name = `kcc-${String(index).padStart(4, "0")}-kcc`
  const id = `page_Images_${tag}_${vol}_${name}`
  const isSpread = width > height
  const spread = isSpread
    ? "rendition:page-spread-center"
    : state.isFirstContentPage
    ? undefined
    : state.nextSideRight
    ? "page-spread-right"
    : "page-spread-left"
  const firstPage = `Text/${tag}/${vol}/kcc-0000-kcc.xhtml`
  const isNewVolume = index === 0
  const next = {
    ...state,
    manifest: Chunk.append(
      state.manifest,
      `<item id="${id}" href="Text/${tag}/${vol}/${name}.xhtml" media-type="application/xhtml+xml"/>\n`
    ),
    spine: Chunk.append(
      state.spine,
      spread ? `<itemref idref="${id}" properties="${spread}"/>\n` : `<itemref idref="${id}"/>\n`
    ),
    toc: isNewVolume
      ? Chunk.append(
        state.toc,
        `<navPoint id="Text_${tag}_${vol}" playOrder="${volume}"><navLabel><text>Volume ${volume}</text></navLabel><content src="${firstPage}"/></navPoint>\n`
      )
      : state.toc,
    nav: isNewVolume
      ? Chunk.append(state.nav, `<li><a href="${firstPage}"><span>Volume ${volume}</span></a></li>\n`)
      : state.nav,
    pagesInVolume: new Map(state.pagesInVolume).set(volume, index + 1),
    nextSideRight: isSpread || (state.isFirstContentPage ? state.nextSideRight : !state.nextSideRight),
    isFirstContentPage: false
  }
  return [next, {
    volume,
    name,
    imagePath: `OEBPS/Images/${state.tag}/${vol}/${name}.jpg`,
    xhtmlPath: `OEBPS/Text/${state.tag}/${vol}/${name}.xhtml`,
    xhtml: T.pageXhtml(name, width, height, state.tag, vol, state.kepub)
  }]
}

export const join = (lines: Chunk.Chunk<string>) => Chunk.toReadonlyArray(lines).join("")
