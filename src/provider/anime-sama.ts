import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { parse } from "node-html-parser"
import { Chapter, MangaInfo, ParseError } from "../domain.js"
import { collectPages, fetchDocument, fetchText, requireOne, resolveAll, site, tagsFrom } from "./provider.js"

const SINGLE_PAGES_SUFFIX = " pp"
const JS_STRING_OR_COMMENT = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?(?:\*\/|$)|\/\/.*|<!--.*/g
const SCAN_PANEL_CALL = /panneauScan\s*\(\s*(["'])(?:\\.|(?!\1)[^\\])*\1\s*,\s*(["'])((?:\\.|(?!\2)[^\\])*)\2/g

export const AnimeSama = site("anime-sama", (base) => {
  const chapterSizes = Effect.fnUntraced(function*(name: string) {
    const url = `${base}/s2/scans/get_nb_chap_et_img.php?${new URLSearchParams({ oeuvre: name })}`
    const sizes = parseChapterSizes(yield* fetchText(url))
    if (Option.isNone(sizes)) return yield* Effect.fail(new ParseError({ url, what: "a JSON chapter list" }))
    return sizes.value
  })

  const scanVersions = (slug: string) =>
    Effect.map(fetchDocument(`${base}/catalogue/${slug}/`), (doc) => scanPanels(doc.html))

  const readerPage = Effect.fnUntraced(function*(slug: string, version: string) {
    const doc = yield* fetchDocument(`${base}/catalogue/${slug}/${version}/`)
    const title = yield* requireOne(doc, "#titreOeuvre")
    return {
      scanName: title.innerHTML,
      name: title.text.trim(),
      coverUrl: doc.root.querySelector("#imgOeuvre")?.getAttribute("src") ?? ""
    }
  })

  const resolveVersion = Effect.fnUntraced(function*(tag: string) {
    const { slug, version } = splitTag(tag)
    if (version) return { slug, version }
    const [first] = yield* scanVersions(slug)
    if (!first) {
      return yield* Effect.fail(new ParseError({ url: `${base}/catalogue/${slug}/`, what: "a scan version (anime only?)" }))
    }
    return { slug, version: first }
  })

  const mangaFor = Effect.fnUntraced(function*(slug: string, version: string, tag: string) {
    const page = yield* readerPage(slug, version)
    const sizes = yield* chapterSizes(page.scanName)
    return new MangaInfo({ tag, name: page.name, coverUrl: page.coverUrl, chapterCount: sizes.length })
  })

  return {
    getMangaInfo: Effect.fn("http_to_epub.AnimeSama.getMangaInfo")(function*(tag: string) {
      const { slug, version } = yield* resolveVersion(tag)
      return yield* mangaFor(slug, version, tag)
    }),

    getChapters: Effect.fn("http_to_epub.AnimeSama.getChapters")(function*(info: MangaInfo) {
      const { slug, version } = yield* resolveVersion(info.tag)
      const { scanName } = yield* readerPage(slug, version)
      const main = yield* chapterSizes(scanName)
      if (main.length === 0) {
        return yield* Effect.fail(new ParseError({ url: base, what: `scans hosted for "${scanName}"` }))
      }
      const singleName = scanName + SINGLE_PAGES_SUFFIX
      const single = yield* chapterSizes(singleName).pipe(
        Effect.catchTag(["FetchError", "ParseError"], () => Effect.succeed([]))
      )
      const singlePages = new Map(single.map(({ chapter, pages }) => [chapter, pages]))

      return main.map(({ chapter, pages }, number) => {
        const singleCount = singlePages.get(chapter) ?? 0
        const name = encodeURIComponent(singleCount > 0 ? singleName : scanName)
        return new Chapter({
          number,
          pages: Array.from(
            { length: singleCount > 0 ? singleCount : pages },
            (_, i) => `${base}/s2/scans/${name}/${chapter}/${i + 1}.jpg`
          )
        })
      })
    }),

    getAllMangas: () =>
      collectPages((page) =>
        Effect.map(
          fetchDocument(`${base}/catalogue/?type%5B%5D=Scans&page=${page}`),
          (doc) =>
            tagsFrom(
              doc.root.querySelectorAll(".as-carte-oeuvre").filter((card) =>
                card.querySelector(".as-badge-scan, .as-badge-webtoon")
              ),
              "data-url"
            )
        )
      ).pipe(
        Effect.flatMap((slugs) =>
          resolveAll(slugs, (slug) =>
            Effect.flatMap(
              scanVersions(slug),
              (versions) =>
                Effect.forEach(
                  versions,
                  (version, i) => mangaFor(slug, version, i === 0 ? slug : `${slug}.${version.replaceAll("/", ".")}`)
                )
            ))
        ),
        Effect.map((mangas) => mangas.flat().filter((manga) => manga.chapterCount > 0))
      )
  }
})

export const splitTag = (tag: string) => {
  const match = /^(.+)\.(scan[^.]*)\.([^.]+)$/.exec(tag)
  return match ? { slug: match[1] ?? tag, version: `${match[2]}/${match[3]}` } : { slug: tag, version: undefined }
}

const decodeChapterList = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))
const decodeCount = Schema.decodeUnknownOption(
  Schema.Union([Schema.Int, Schema.NumberFromString.pipe(Schema.check(Schema.isInt()))]).pipe(
    Schema.check(Schema.isGreaterThanOrEqualTo(0))
  )
)

export const parseChapterSizes = (body: string) =>
  Option.map(decodeChapterList(body), (list) =>
    "error" in list
      ? []
      : Object.entries(list)
        .flatMap(([key, size]) => {
          const chapter = decodeCount(key)
          const pages = decodeCount(size)
          return Option.isSome(chapter) && Option.isSome(pages) ? [{ chapter: chapter.value, pages: pages.value }] : []
        })
        .sort((a, b) => a.chapter - b.chapter))

export const scanPanels = (html: string) => {
  const panels = new Set<string>()
  for (const script of parse(html).querySelectorAll("script")) {
    const code = script.text.replace(JS_STRING_OR_COMMENT, (match, literal) => literal ?? (match.startsWith("/*") ? " " : ""))
    for (const [, , , path = ""] of code.matchAll(SCAN_PANEL_CALL)) {
      const panel = path.replace(/\\(.)/g, "$1").replace(/^\/+|\/+$/g, "")
      if (panel) panels.add(panel)
    }
  }
  return [...panels]
}
