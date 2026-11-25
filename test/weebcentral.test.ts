import { describe, expect, it } from "@effect/vitest"
import { Clock, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { FetchError, MangaInfo } from "../src/domain.js"
import { Provider } from "../src/provider/provider.js"
import { WeebCentral } from "../src/provider/weebcentral.js"
import { Fetcher } from "../src/http/fetcher.js"
import { type Call, fakeFetcher } from "./helpers.js"

const base = "https://weebcentral.com"
const images = (id: string) => `${base}/chapters/${id}/images?is_prev=False&current_page=1&reading_style=long_strip`
const search = (offset: number) =>
  `${base}/search/data?limit=32&offset=${offset}&sort=Alphabet&order=Ascending&official=Any&anime=Any&adult=Any&display_mode=Minimal+Display`

const series = (name: string) =>
  `<head><meta property="og:image" content="https://c1/cover.jpg"></head>
   <h1 class="md:hidden">${name}</h1><a href="/chapters/B">latest</a><h1 class="hidden">${name}</h1>`

const manga = new MangaInfo({ tag: "01X", name: "", coverUrl: "", chapterCount: 1 })

const provide = (files: Record<string, string>, calls: Array<Call> = []) =>
  Effect.provide(WeebCentral(`${base}/`).pipe(Layer.provide(fakeFetcher(files, calls))))

// Requests are spaced by the crawl delay, which only elapses when the test clock moves
const crawl = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(effect)
    for (let i = 0; i < 20; i++) yield* TestClock.adjust("10 seconds")
    return yield* Fiber.join(fiber)
  })

describe("weebcentral", () => {
  it.effect("reads every chapter from the full list, newest last", () =>
    Effect.gen(function*() {
      const provider = yield* Provider
      const info = yield* crawl(provider.getMangaInfo("01X"))
      expect(info).toMatchObject({ tag: "01X", name: `"Ghost" & co`, coverUrl: "https://c1/cover.jpg", chapterCount: 2 })
      const chapters = yield* crawl(provider.getChapters(info))
      expect(chapters.map((c) => c.pages)).toEqual([["https://c1/1a.png"], ["https://c1/2a.png", "https://c1/2b.png"]])
    }).pipe(provide({
      [`${base}/series/01X`]: series("&#34;Ghost&#34; &amp; co"),
      [`${base}/series/01X/full-chapter-list`]:
        `<div><a href="/chapters/B">Chapter 2</a></div><div><a href="${base}/chapters/A">Chapter 1</a></div><a href="#top"></a>`,
      [images("A")]: `<section id="chapter-images"><img src="https://c1/1a.png"></section>`,
      [images("B")]: `<section id="chapter-images"><img src="https://c1/2a.png"><img src="https://c1/2b.png"></section>`
    })))

  it.effect("fails on a chapter without images", () =>
    Effect.gen(function*() {
      const provider = yield* Provider
      const error = yield* Effect.flip(crawl(provider.getChapters(manga)))
      expect(error).toMatchObject({ _tag: "ParseError", url: images("A") })
    }).pipe(provide({
      [`${base}/series/01X/full-chapter-list`]: `<a href="/chapters/A">Chapter 1</a>`,
      [images("A")]: `<section id="chapter-images"></section>`
    })))

  it.effect("pages through the search results, with or without a slug", () =>
    Effect.gen(function*() {
      const provider = yield* Provider
      const mangas = yield* crawl(provider.getAllMangas())
      expect(mangas.map((m) => [m.tag, m.name])).toEqual([["01X", "Ghost"], ["01Y", "Yawn"]])
    }).pipe(provide({
      [search(0)]: `<article><a href="${base}/series/01X/Ghost">Ghost</a></article>`,
      [search(32)]: `<article><a href="/series/01Y">Yawn</a></article>`,
      [search(64)]: `<div role="alert">No results found</div>`,
      [`${base}/series/01X`]: series("Ghost"),
      [`${base}/series/01X/full-chapter-list`]: "",
      [`${base}/series/01Y`]: series("Yawn"),
      [`${base}/series/01Y/full-chapter-list`]: ""
    })))

  it.effect("only requests the chapters in range", () => {
    const calls: Array<Call> = []
    return Effect.gen(function*() {
      const provider = yield* Provider
      const chapters = yield* crawl(provider.getChapters(manga, { from: 1, to: 2 }))
      expect(chapters).toMatchObject([{ number: 1, pages: ["https://c1/2.png"] }])
      expect(calls.map((call) => call.url)).toEqual([`${base}/series/01X/full-chapter-list`, images("B")])
    }).pipe(provide({
      [`${base}/series/01X/full-chapter-list`]: ["C", "B", "A"].map((id) => `<a href="/chapters/${id}"></a>`).join(""),
      [images("B")]: `<section id="chapter-images"><img src="https://c1/2.png"></section>`
    }, calls))
  })

  it.effect("leaves the crawl delay between requests, even across concurrent calls and failures", () => {
    const times: Array<number> = []
    const fetcher = Layer.succeed(Fetcher, {
      text: (url) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) => {
          times.push(now)
          return Effect.fail(new FetchError({ url, status: 500 }))
        }),
      bytes: () => Effect.die("unused")
    })
    return Effect.gen(function*() {
      const provider = yield* Provider
      const fetchInfo = Effect.exit(provider.getMangaInfo("01X"))
      yield* crawl(Effect.all([fetchInfo, fetchInfo, fetchInfo], { concurrency: "unbounded" }))
      expect(times.map((time) => time - times[0]!)).toEqual([0, 10_000, 20_000])
    }).pipe(Effect.provide(WeebCentral(base).pipe(Layer.provide(fetcher))))
  })
})
