import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import { randomUUID } from "node:crypto"
import { zip, type ZipEntry } from "../archive/zip.js"
import type { ArchiveError, Book, ClearanceRequired, FetchError, ImageError } from "../domain.js"
import { Fetcher } from "../http/fetcher.js"
import { headersFor } from "../http/session.js"
import { type ImageOptions, ImageProcessor } from "../image/ImageProcessor.js"
import * as Layout from "./layout.js"
import * as T from "./templates.js"

export type PageError = FetchError | ClearanceRequired | ImageError
export type BuildError = PageError | ArchiveError

export interface EpubOptions extends ImageOptions {
  readonly onPageError: "skip" | "fail"
  readonly compressImages: boolean
  /** Kobo KEPUB markup (what kepubify adds); name the file `.kepub.epub` for Kobo to use it */
  readonly kepub: boolean
}

export const defaultEpubOptions: EpubOptions = {
  width: 1264,
  height: 1680,
  splitDoublePages: false,
  jpegQuality: 75,
  onPageError: "skip",
  compressImages: false,
  kepub: false
}

export const defaultBuilderOptions = { fetchConcurrency: 10, encodeConcurrency: 10 }
export type BuilderOptions = typeof defaultBuilderOptions

export class EpubBuilder extends Context.Service<EpubBuilder, {
  readonly entries: (book: Book, options?: Partial<EpubOptions>) => Stream.Stream<ZipEntry, PageError>
  readonly build: (book: Book, options?: Partial<EpubOptions>) => Stream.Stream<Uint8Array, BuildError>
}>()("http_to_epub/EpubBuilder") {
  static readonly layer = (options: Partial<BuilderOptions> = {}) => Layer.effect(EpubBuilder, make(options))
}

const make = (overrides: Partial<BuilderOptions>) =>
  Effect.gen(function*() {
    const { fetchConcurrency, encodeConcurrency } = { ...defaultBuilderOptions, ...overrides }
    const fetcher = yield* Fetcher
    const images = yield* ImageProcessor
    // shared by every build of this layer: caps sharp's CPU use process-wide
    const encodeSlots = yield* Semaphore.make(encodeConcurrency)

    const entries = (book: Book, overrides: Partial<EpubOptions> = {}) => {
      const options = { ...defaultEpubOptions, ...overrides }
      const image = (name: string, data: Uint8Array) => ({ name, data, compress: options.compressImages })
      const download = (url: string) => fetcher.bytes(url, { headers: headersFor(book.session, url) })
      const sources = book.chapters.flatMap((chapter, i) => chapter.pages.map((url) => ({ volume: i + 1, url })))

      const run = Effect.sync(() => {
        let produced = 0
        let skipped = 0
        const skip = skipOnError(options, () => skipped++)

        const cover = Stream.fromEffect(
          download(book.info.coverUrl).pipe(Effect.withSpan("http_to_epub.EpubBuilder.cover"))
        ).pipe(Stream.map((data) => image("OEBPS/Images/cover.jpg", data)))

        const pages = Stream.fromIterable(sources).pipe(
          Stream.mapEffect(
            ({ url, volume }) => download(url).pipe(Effect.map((bytes) => ({ url, volume, bytes })), skip(url)),
            { concurrency: fetchConcurrency }
          ),
          Stream.filter((page) => page !== null),
          // one source image can give two pages (split spreads)
          Stream.mapEffect(
            ({ url, volume, bytes }) =>
              images.process(bytes, options).pipe(
                Semaphore.withPermits(encodeSlots, 1),
                Effect.withSpan("http_to_epub.EpubBuilder.encode", { attributes: { "url.full": url } }),
                Effect.map((encoded) => encoded.map((page) => ({ volume, ...page }))),
                skip(url)
              ),
            { concurrency: encodeConcurrency }
          ),
          Stream.filter((encoded) => encoded !== null),
          Stream.flattenIterable,
          Stream.mapAccum(() => Layout.empty(book.info.tag, options.kepub), (layout, page) => {
            produced++
            const [next, placed] = Layout.addPage(layout, page.volume, page.width, page.height)
            return [next, [image(placed.imagePath, page.data), deflated(placed.xhtmlPath, placed.xhtml)]]
          }, { onHalt: (layout) => metadata(book, layout) })
        )

        const summary = Stream.fromEffectDrain(Effect.suspend(() =>
          Effect.annotateCurrentSpan({ "http_to_epub.pages.produced": produced, "http_to_epub.pages.skipped": skipped })
        ))

        return Stream.fromIterable(skeleton).pipe(Stream.concat(cover), Stream.concat(pages), Stream.concat(summary))
      })

      return Stream.unwrap(run).pipe(
        Stream.withSpan("http_to_epub.EpubBuilder.entries", {
          attributes: {
            "http_to_epub.book.tag": book.info.tag,
            "http_to_epub.book.chapters": book.chapters.length,
            "http_to_epub.pages.source": sources.length
          }
        })
      )
    }

    const build = (book: Book, options?: Partial<EpubOptions>) =>
      zip(entries(book, options)).pipe(Stream.withSpan("http_to_epub.EpubBuilder.build"))

    return { entries, build }
  })

/** In "skip" mode, a page that fails to download or decode is logged and replaced by `null` */
const skipOnError = (options: EpubOptions, onSkip: () => void) =>
(url: string) =>
<A>(effect: Effect.Effect<A, PageError>) =>
  options.onPageError === "fail" ? effect : effect.pipe(
    Effect.catchTag(
      ["FetchError", "ImageError"],
      (e) => Effect.as(Effect.andThen(Effect.sync(onSkip), Effect.logWarning(`skipping page ${url}`, e)), null)
    )
  )

const deflated = (name: string, data: Uint8Array | string) => ({ name, data, compress: true })

const skeleton = [
  { name: "mimetype", data: T.MIMETYPE, compress: false },
  deflated("META-INF/container.xml", T.containerXml),
  deflated("kte-css/stylehacks.css", T.styleHacksCss),
  deflated("OEBPS/Text/style.css", T.styleCss)
]

const metadata = (book: Book, layout: Layout.LayoutState) => {
  const uuid = randomUUID()
  const nav = Layout.join(layout.nav)
  return [
    deflated("OEBPS/toc.ncx", T.tocNcx(uuid, book.info.name, Layout.join(layout.toc))),
    deflated("OEBPS/nav.xhtml", T.navXhtml(book.info.name, nav, nav, layout.kepub)),
    deflated(
      "OEBPS/content.opf",
      T.contentOpf({
        title: book.info.name,
        creator: book.creator,
        uuid,
        uuid2: randomUUID(),
        lang: book.lang,
        manifest: Layout.join(layout.manifest) + T.manifestFooter,
        spine: Layout.join(layout.spine),
        modified: new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
      })
    )
  ]
}
