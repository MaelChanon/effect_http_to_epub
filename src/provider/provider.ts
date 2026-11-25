import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import { type HTMLElement, parse } from "node-html-parser"
import { Chapter, type ClearanceRequired, type FetchError, MangaInfo, ParseError } from "../domain.js"
import { Fetcher, type RequestOptions } from "../http/fetcher.js"
import { type Clearance, headersFor, makeSession, type Session } from "../http/session.js"

export type ProviderError = FetchError | ClearanceRequired | ParseError

export interface ChapterRange {
  readonly from?: number | undefined
  readonly to?: number | undefined
}

export class Provider extends Context.Service<Provider, {
  readonly name: string
  readonly session: Session | undefined
  readonly getMangaInfo: (tag: string) => Effect.Effect<MangaInfo, ProviderError>
  readonly getChapters: (info: MangaInfo, range?: ChapterRange) => Effect.Effect<ReadonlyArray<Chapter>, ProviderError>
  readonly getAllMangas: () => Effect.Effect<ReadonlyArray<MangaInfo>, ProviderError>
}>()("http_to_epub/Provider") {
  static readonly fromManifest = (manifest: { info: MangaInfo; chapters: ReadonlyArray<Chapter> }) =>
    Layer.succeed(Provider, {
      name: "manifest",
      session: undefined,
      getMangaInfo: () => Effect.succeed(manifest.info),
      getChapters: (_info, range) => Effect.succeed(manifest.chapters.slice(range?.from, range?.to)),
      getAllMangas: () => Effect.succeed([manifest.info])
    })
}

export interface Site {
  readonly getMangaInfo: (tag: string) => Effect.Effect<MangaInfo, ProviderError, Fetcher>
  readonly getChapters: (
    info: MangaInfo,
    range?: ChapterRange
  ) => Effect.Effect<ReadonlyArray<Chapter>, ProviderError, Fetcher>
  readonly getAllMangas: () => Effect.Effect<ReadonlyArray<MangaInfo>, ProviderError, Fetcher>
}

export interface SiteOptions {
  readonly crawlDelayMillis?: number | undefined
}

export const site = (name: string, build: (base: string) => Site, options: SiteOptions = {}) =>
(baseUrl: string, clearance?: Clearance) =>
  Layer.effect(
    Provider,
    Effect.gen(function*() {
      const fetcher = yield* Fetcher
      const base = baseUrl.replace(/\/+$/, "")
      const session = makeSession(base, clearance)
      const withSession = (url: string, options: RequestOptions | undefined) => ({
        ...options,
        headers: { ...headersFor(session, url), ...options?.headers }
      })
      const paced = yield* makePacer(options.crawlDelayMillis ?? 0)
      const scoped = Fetcher.of({
        text: (url, options) => paced(fetcher.text(url, withSession(url, options))),
        bytes: (url, options) => fetcher.bytes(url, withSession(url, options))
      })
      const impl = build(base)
      const run = <A>(effect: Effect.Effect<A, ProviderError, Fetcher>) => Effect.provideService(effect, Fetcher, scoped)
      return {
        name,
        session,
        getMangaInfo: (tag) => run(impl.getMangaInfo(tag)),
        getChapters: (info, range) => run(impl.getChapters(info, range)),
        getAllMangas: () => run(impl.getAllMangas())
      }
    })
  )

const makePacer = Effect.fnUntraced(function*(delayMillis: number) {
  const semaphore = yield* Semaphore.make(1)
  let next = 0
  return <A, E, R>(request: Effect.Effect<A, E, R>) => {
    if (delayMillis <= 0) return request
    const turn = Effect.gen(function*() {
      const wait = next - (yield* Clock.currentTimeMillis)
      if (wait > 0) yield* Effect.sleep(wait)
    })
    const release = Effect.map(Clock.currentTimeMillis, (now) => {
      next = now + delayMillis
    })
    return semaphore.withPermit(Effect.andThen(turn, Effect.ensuring(request, release)))
  }
})

export const fetchText = (url: string, options?: RequestOptions) => Fetcher.use((fetcher) => fetcher.text(url, options))

export const fetchDocument = Effect.fn("http_to_epub.fetchDocument")(function*(url: string) {
  const html = yield* fetchText(url)
  return { url, html, root: parse(html) }
})

export type Document = Effect.Success<ReturnType<typeof fetchDocument>>

export const requireOne = (doc: Document, selector: string) => {
  const el = doc.root.querySelector(selector)
  return el ? Effect.succeed(el) : Effect.fail(new ParseError({ url: doc.url, what: `"${selector}"` }))
}

const detach = (text: string) => structuredClone(text)

export const mangaInfo = (fields: {
  readonly tag: string
  readonly name: string
  readonly coverUrl: string
  readonly chapterCount: number
}) =>
  new MangaInfo({
    tag: detach(fields.tag),
    name: detach(fields.name),
    coverUrl: detach(fields.coverUrl),
    chapterCount: fields.chapterCount
  })

export const imageSrc = (el: HTMLElement) => (el.getAttribute("data-src") ?? el.getAttribute("src") ?? "").trim()

export const tagsFrom = (elements: ReadonlyArray<HTMLElement>, attribute = "href") =>
  elements
    .map((el) => (el.getAttribute(attribute) ?? "").replace(/\/+$/, "").split("/").pop() ?? "")
    .filter((tag) => tag !== "")

export const scrapeChapters = (
  chapterUrls: ReadonlyArray<string>,
  pagesOf: (doc: Document) => Effect.Effect<ReadonlyArray<string>, ParseError>,
  range?: ChapterRange
) =>
  Effect.forEach(
    [...chapterUrls].reverse().map((url, number) => ({ url, number })).slice(range?.from, range?.to),
    ({ url, number }) =>
      fetchDocument(url).pipe(
        Effect.flatMap(pagesOf),
        Effect.map((pages) => new Chapter({ number, pages: pages.map(detach) }))
      ),
    { concurrency: 10 }
  )

export const collectPages = <E, R>(
  page: (index: number) => Effect.Effect<ReadonlyArray<string>, E, R>,
  first = 1
) =>
  Effect.gen(function*() {
    const seen = new Set<string>()
    for (let index = first;; index++) {
      const before = seen.size
      for (const tag of yield* page(index)) seen.add(detach(tag))
      if (seen.size === before) return [...seen]
    }
  })

export const resolveAll = <A, R>(tags: ReadonlyArray<string>, resolve: (tag: string) => Effect.Effect<A, ProviderError, R>) =>
  Effect.forEach(
    tags,
    (tag) =>
      resolve(tag).pipe(
        Effect.catchTag(["FetchError", "ParseError"], (e) => Effect.as(Effect.logWarning(`skipping ${tag}`, e), null))
      ),
    { concurrency: 10 }
  ).pipe(Effect.map((resolved) => resolved.filter((value) => value !== null)))
