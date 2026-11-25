import * as Effect from "effect/Effect"
import { parse } from "node-html-parser"
import { MangaInfo } from "../domain.js"
import {
  type ChapterRange,
  collectPages,
  fetchDocument,
  fetchText,
  imageSrc,
  requireOne,
  resolveAll,
  scrapeChapters,
  site,
  tagsFrom
} from "./provider.js"

export const MangaOrigins = site("manga-origins", (base) => {
  const getMangaInfo = Effect.fn("http_to_epub.MangaOrigins.getMangaInfo")(function*(tag: string) {
    const doc = yield* fetchDocument(`${base}/oeuvre/${tag}/`)
    const title = yield* requireOne(doc, ".post-title>h1")
    const cover = doc.root.querySelector(".ori-sr-cover img")
    return new MangaInfo({
      tag,
      name: title.text.trim(),
      coverUrl: cover ? imageSrc(cover) : "",
      chapterCount: doc.root.querySelectorAll(".ori-chl-row").length
    })
  })

  return {
    getMangaInfo,
    getChapters: Effect.fn("http_to_epub.MangaOrigins.getChapters")(function*(info: MangaInfo, range?: ChapterRange) {
      const doc = yield* fetchDocument(`${base}/oeuvre/${info.tag}/`)
      const urls = doc.root
        .querySelectorAll(".ori-chl-row a.ori-chl-corps")
        .map((a) => `${(a.getAttribute("href") ?? "").replace(/\/+$/, "")}/?style=list`)
      return yield* scrapeChapters(
        urls,
        (page) => Effect.succeed(page.root.querySelectorAll(".reading-content img").map(imageSrc)),
        range
      )
    }),
    getAllMangas: () =>
      collectPages((page) =>
        page === 0
          ? Effect.map(fetchDocument(`${base}/catalogues/`), (doc) => tagsFrom(doc.root.querySelectorAll(".item-thumb a")))
          : Effect.map(
            fetchText(`${base}/wp-admin/admin-ajax.php`, {
              headers: { "x-requested-with": "XMLHttpRequest" },
              form: {
                action: "madara_load_more",
                page: String(page),
                template: "madara-core/content/content-archive",
                "vars[paged]": "1",
                "vars[orderby]": "meta_value_num",
                "vars[template]": "archive",
                "vars[sidebar]": "full",
                "vars[post_type]": "wp-manga",
                "vars[post_status]": "publish",
                "vars[meta_key]": "_latest_update",
                "vars[order]": "desc",
                "vars[meta_query][relation]": "AND",
                "vars[manga_archives_item_layout]": "big_thumbnail",
                "vars[manga_archives_item_columns]": "0"
              }
            }),
            (html) => tagsFrom(parse(html).querySelectorAll(".item-thumb a"))
          ), 0).pipe(Effect.flatMap((tags) => resolveAll(tags, getMangaInfo)))
  }
})
