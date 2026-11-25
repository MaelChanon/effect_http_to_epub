import * as Effect from "effect/Effect"
import { type MangaInfo, ParseError } from "../domain.js"
import {
  type ChapterRange,
  collectPages,
  fetchDocument,
  imageSrc,
  mangaInfo,
  requireOne,
  resolveAll,
  scrapeChapters,
  site,
  tagsFrom
} from "./provider.js"

const SEARCH_PAGE_SIZE = 32
// Crawl-delay of the site's robots.txt; a handful of parallel requests is enough to get a 429
const CRAWL_DELAY_MILLIS = 10_000

export const WeebCentral = site("weebcentral", (base) => {
  // The series page only lists the latest chapters
  const chapterIds = (tag: string) =>
    Effect.map(
      fetchDocument(`${base}/series/${tag}/full-chapter-list`),
      (doc) => tagsFrom(doc.root.querySelectorAll(`a[href*="/chapters/"]`))
    )

  const getMangaInfo = Effect.fn("http_to_epub.WeebCentral.getMangaInfo")(function*(tag: string) {
    const doc = yield* fetchDocument(`${base}/series/${tag}`)
    const title = yield* requireOne(doc, "h1")
    const cover = yield* requireOne(doc, `meta[property="og:image"]`)
    return mangaInfo({
      tag,
      name: title.text.trim(),
      coverUrl: cover.getAttribute("content") ?? "",
      chapterCount: (yield* chapterIds(tag)).length
    })
  })

  return {
    getMangaInfo,

    getChapters: Effect.fn("http_to_epub.WeebCentral.getChapters")(function*(info: MangaInfo, range?: ChapterRange) {
      const ids = yield* chapterIds(info.tag)
      return yield* scrapeChapters(
        ids.map((id) => `${base}/chapters/${id}/images?is_prev=False&current_page=1&reading_style=long_strip`),
        (doc) => {
          const pages = doc.root.querySelectorAll("#chapter-images img").map(imageSrc)
          return pages.length > 0 ? Effect.succeed(pages) : Effect.fail(new ParseError({ url: doc.url, what: "chapter images" }))
        },
        range
      )
    }),

    getAllMangas: () =>
      collectPages((page) => {
        const query = new URLSearchParams({
          limit: String(SEARCH_PAGE_SIZE),
          offset: String(page * SEARCH_PAGE_SIZE),
          sort: "Alphabet",
          order: "Ascending",
          official: "Any",
          anime: "Any",
          adult: "Any",
          display_mode: "Minimal Display"
        })
        return Effect.map(
          fetchDocument(`${base}/search/data?${query}`),
          (doc) => doc.root.querySelectorAll(`a[href*="/series/"]`).flatMap((a) => seriesId(a.getAttribute("href") ?? "") ?? [])
        )
      }, 0).pipe(Effect.flatMap((tags) => resolveAll(tags, getMangaInfo)))
  }
}, { crawlDelayMillis: CRAWL_DELAY_MILLIS })

// Series links end with an optional slug: /series/<id>/<slug>
const seriesId = (href: string) => /\/series\/([^/?#]+)/.exec(href)?.[1]
