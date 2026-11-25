import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { MangaOrigins } from "../src/provider/manga-origins.js"
import { Provider } from "../src/provider/provider.js"
import { type Call, fakeFetcher } from "./helpers.js"

describe("manga-origins", () => {
  // Without the slash before the query the site answers 301, which undici does not follow
  it.effect("requests chapters at their canonical URL, newest last", () => {
    const base = "https://mangas-origines.fr"
    const calls: Array<Call> = []
    return Effect.gen(function*() {
      const provider = yield* Provider
      const info = yield* provider.getMangaInfo("ghost")
      const chapters = yield* provider.getChapters(info)
      expect(chapters.map((c) => c.pages)).toEqual([["https://c1/1.jpg"], ["https://c1/2.jpg"]])
      expect(calls.slice(2).map((c) => c.url)).toEqual([
        `${base}/oeuvre/ghost/chapitre-1/?style=list`,
        `${base}/oeuvre/ghost/chapitre-2/?style=list`
      ])
    }).pipe(Effect.provide(MangaOrigins(base).pipe(Layer.provide(fakeFetcher({
      [`${base}/oeuvre/ghost/`]:
        `<div class="post-title"><h1>Ghost</h1></div>
         <div class="ori-chl-row"><a class="ori-chl-corps" href="${base}/oeuvre/ghost/chapitre-2/">2</a></div>
         <div class="ori-chl-row"><a class="ori-chl-corps" href="${base}/oeuvre/ghost/chapitre-1">1</a></div>`,
      [`${base}/oeuvre/ghost/chapitre-1/?style=list`]: `<div class="reading-content"><img data-src=" https://c1/1.jpg"></div>`,
      [`${base}/oeuvre/ghost/chapitre-2/?style=list`]: `<div class="reading-content"><img src="https://c1/2.jpg"></div>`
    }, calls)))))
  })
})
