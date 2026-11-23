import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { type HTMLElement, parse } from "node-html-parser"
import { Chapter, type ClearanceRequired, type FetchError, type MangaInfo, ParseError } from "../domain.js"
import { Fetcher, type RequestOptions } from "../http/fetcher.js"
import { type Clearance, headersFor, makeSession, type Session } from "../http/session.js"

export type ProviderError = FetchError | ClearanceRequired | ParseError

export class Provider extends Context.Service<Provider, {
  readonly name: string
  readonly session: Session | undefined
  readonly getMangaInfo: (tag: string) => Effect.Effect<MangaInfo, ProviderError>
  readonly getChapters: (info: MangaInfo) => Effect.Effect<ReadonlyArray<Chapter>, ProviderError>
  readonly getAllMangas: () => Effect.Effect<ReadonlyArray<MangaInfo>, ProviderError>
}>()("http_to_epub/Provider") {
  static readonly fromManifest = (manifest: { info: MangaInfo; chapters: ReadonlyArray<Chapter> }) =>
    Layer.succeed(Provider, {
      name: "manifest",
      session: undefined,
      getMangaInfo: () => Effect.succeed(manifest.info),
      getChapters: () => Effect.succeed(manifest.chapters),
      getAllMangas: () => Effect.succeed([manifest.info])
    })
}

export interface Site {
  readonly getMangaInfo: (tag: string) => Effect.Effect<MangaInfo, ProviderError, Fetcher>
  readonly getChapters: (info: MangaInfo) => Effect.Effect<ReadonlyArray<Chapter>, ProviderError, Fetcher>
  readonly getAllMangas: () => Effect.Effect<ReadonlyArray<MangaInfo>, ProviderError, Fetcher>
}

export const site = (name: string, build: (base: string) => Site) => (baseUrl: string, clearance?: Clearance) =>
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
      const scoped = Fetcher.of({
        text: (url, options) => fetcher.text(url, withSession(url, options)),
        bytes: (url, options) => fetcher.bytes(url, withSession(url, options))
      })
      const impl = build(base)
      const run = <A>(effect: Effect.Effect<A, ProviderError, Fetcher>) => Effect.provideService(effect, Fetcher, scoped)
      return {
        name,
        session,
        getMangaInfo: (tag) => run(impl.getMangaInfo(tag)),
        getChapters: (info) => run(impl.getChapters(info)),
        getAllMangas: () => run(impl.getAllMangas())
      }
    })
  )

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

export const imageSrc = (el: HTMLElement) => (el.getAttribute("data-src") ?? el.getAttribute("src") ?? "").trim()

export const tagsFrom = (elements: ReadonlyArray<HTMLElement>, attribute = "href") =>
  elements
    .map((el) => (el.getAttribute(attribute) ?? "").replace(/\/+$/, "").split("/").pop() ?? "")
    .filter((tag) => tag !== "")

export const scrapeChapters = (
  chapterUrls: ReadonlyArray<string>,
  pagesOf: (doc: Document) => Effect.Effect<ReadonlyArray<string>, ParseError>
) =>
  Effect.forEach(
    [...chapterUrls].reverse(),
    (url, number) =>
      fetchDocument(url).pipe(
        Effect.flatMap(pagesOf),
        Effect.map((pages) => new Chapter({ number, pages }))
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
      for (const tag of yield* page(index)) seen.add(tag)
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
