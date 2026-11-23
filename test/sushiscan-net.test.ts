import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Provider } from "../src/provider/provider.js"
import { readerImages, SushiScanNet } from "../src/provider/sushiscan-net.js"
import { fakeFetcher } from "./helpers.js"

describe("sushiscan.net", () => {
  it("reads the first non-empty ts_reader source", () => {
    const html =
      `<script>ts_reader.run({"post_id":1,"sources":[{"source":"Server 1","images":[]},{"source":"Server 2","images":["https://c1/a.jpg","https://c1/b.jpg"]}]});</script>`
    expect(readerImages(html)).toEqual(["https://c1/a.jpg", "https://c1/b.jpg"])
  })

  it("survives escaped strings and braces inside the payload", () => {
    const html = String
      .raw`<script>ts_reader.run({"noimagehtml":"<center>{}<\/center>","sources":[{"images":["https:\/\/c1\/a.jpg"]}]});</script>`
    expect(readerImages(html)).toEqual(["https://c1/a.jpg"])
  })

  it("finds nothing without a complete payload", () => {
    expect(readerImages(`<div id="readerarea"></div>`)).toBeUndefined()
    expect(readerImages(`ts_reader.run({"sources":[{"images":[`)).toBeUndefined()
  })

  it.effect("lists chapters from the payload, newest last", () =>
    Effect.gen(function*() {
      const provider = yield* Provider
      const info = yield* provider.getMangaInfo("ghost")
      expect(info).toMatchObject({ name: "Ghost", coverUrl: "https://sushiscan.net/c.jpg", chapterCount: 2 })
      const chapters = yield* provider.getChapters(info)
      expect(chapters.map((c) => c.pages)).toEqual([["https://c1/1a.jpg"], ["https://c1/2a.jpg", "https://c1/2b.jpg"]])
    }).pipe(Effect.provide(SushiScanNet("https://sushiscan.net/").pipe(Layer.provide(fakeFetcher({
      "https://sushiscan.net/catalogue/ghost/":
        `<h1 class="entry-title"> Ghost </h1><div class="seriestucontl"><img src="https://sushiscan.net/c.jpg"></div>
         <div id="chapterlist"><ul><li><a href="https://sushiscan.net/ghost-2/">2</a></li><li><a href="https://sushiscan.net/ghost-1/">1</a></li></ul></div>`,
      "https://sushiscan.net/ghost-1/": `<script>ts_reader.run({"sources":[{"images":["https://c1/1a.jpg"]}]});</script>`,
      "https://sushiscan.net/ghost-2/":
        `<script>ts_reader.run({"sources":[{"images":["https://c1/2a.jpg","https://c1/2b.jpg"]}]});</script>`
    }))))))
})
