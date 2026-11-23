import * as Effect from "effect/Effect"
import { MangaInfo, type ParseError } from "../domain.js"
import {
  collectPages,
  type Document,
  fetchDocument,
  imageSrc,
  requireOne,
  resolveAll,
  scrapeChapters,
  site,
  tagsFrom
} from "./provider.js"

export const mangaStream = (name: string, pagesOf: (doc: Document) => Effect.Effect<ReadonlyArray<string>, ParseError>) =>
  site(name, (base) => {
    const getMangaInfo = Effect.fn(`http_to_epub.${name}.getMangaInfo`)(function*(tag: string) {
      const doc = yield* fetchDocument(`${base}/catalogue/${tag}/`)
      const title = yield* requireOne(doc, ".entry-title")
      const cover = yield* requireOne(doc, ".seriestucontl img")
      return new MangaInfo({
        tag,
        name: title.text.trim(),
        coverUrl: imageSrc(cover),
        chapterCount: doc.root.querySelector("#chapterlist>ul")?.childNodes.filter((n) => n.nodeType === 1).length ?? 0
      })
    })

    return {
      getMangaInfo,
      getChapters: Effect.fn(`http_to_epub.${name}.getChapters`)(function*(info: MangaInfo) {
        const doc = yield* fetchDocument(`${base}/catalogue/${info.tag}/`)
        const urls = doc.root.querySelectorAll("#chapterlist ul li a").map((a) => a.getAttribute("href") ?? "")
        return yield* scrapeChapters(urls, pagesOf)
      }),
      getAllMangas: () =>
        collectPages((page) =>
          Effect.map(
            fetchDocument(`${base}/catalogue/?page=${page}`),
            (doc) => tagsFrom(doc.root.querySelectorAll(".listupd>div>div>a"))
          )
        ).pipe(Effect.flatMap((tags) => resolveAll(tags, getMangaInfo)))
    }
  })

export const SushiScan = mangaStream(
  "sushiscan",
  (doc) => Effect.succeed(doc.root.querySelectorAll("#readerarea>p>img").map(imageSrc))
)
