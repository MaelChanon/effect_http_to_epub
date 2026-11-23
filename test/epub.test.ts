import { describe, expect, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import type { ZipEntry } from "../src/archive/zip.js"
import { Chapter, MangaInfo } from "../src/domain.js"
import { EpubBuilder, type EpubOptions } from "../src/epub/epubBuilder.js"
import { clearanceFromToken, makeSession } from "../src/http/session.js"
import { type Call, testBuilder } from "./helpers.js"

const info = new MangaInfo({ tag: "op", name: "One Piece & co", coverUrl: "cover", chapterCount: 2 })
const book = (chapters: Array<Array<string>>) => ({
  info,
  creator: "me",
  lang: "fr-FR",
  chapters: chapters.map((pages, number) => new Chapter({ number, pages }))
})
const files = { cover: "1x1", a: "800x1200", b: "1600x1200", c: "800x1200", d: "800x1200" }
const text = (e: ZipEntry | undefined) => typeof e?.data === "string" ? e.data : new TextDecoder().decode(e?.data)
const pageImages = (entries: ReadonlyArray<ZipEntry>) =>
  entries.filter((e) => e.name.endsWith(".jpg") && !e.name.includes("cover")).map((e) => e.name)

const entriesOf = (chapters: Array<Array<string>>, options: Partial<EpubOptions> = {}) =>
  EpubBuilder.use((b) => Stream.runCollect(b.entries(book(chapters), { splitDoublePages: true, ...options })))

describe("EpubBuilder", () => {
  it.effect("writes a valid skeleton, pages in order, spreads split in two", () =>
    Effect.gen(function*() {
      const entries = yield* entriesOf([["a", "b"], ["c", "d"]])
      expect(entries[0]).toMatchObject({ name: "mimetype", compress: false })
      expect(text(entries[0])).toBe("application/epub+zip")
      expect(pageImages(entries)).toEqual([
        "OEBPS/Images/op/volume-0001/kcc-0000-kcc.jpg",
        "OEBPS/Images/op/volume-0001/kcc-0001-kcc.jpg",
        "OEBPS/Images/op/volume-0001/kcc-0002-kcc.jpg",
        "OEBPS/Images/op/volume-0002/kcc-0000-kcc.jpg",
        "OEBPS/Images/op/volume-0002/kcc-0001-kcc.jpg"
      ])
      expect(entries.at(-1)?.name).toBe("OEBPS/content.opf")
      const opf = text(entries.at(-1))
      expect(opf).toContain("<dc:title id=\"id\">One Piece &amp; co</dc:title>")
      expect(opf).toMatch(/dcterms:modified">\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ</)
    }).pipe(Effect.provide(testBuilder(files))))

  it.effect("skips a missing page by default", () =>
    Effect.gen(function*() {
      const entries = yield* entriesOf([["a", "missing", "c"]])
      expect(pageImages(entries)).toHaveLength(2)
    }).pipe(Effect.provide(testBuilder(files))))

  it.effect("fails with a typed FetchError in strict mode", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(entriesOf([["a", "missing"]], { onPageError: "fail" }))
      expect(error._tag).toBe("FetchError")
      expect(error).toMatchObject({ url: "missing", status: 404 })
    }).pipe(Effect.provide(testBuilder(files))))

  it.effect("takes its options per call, with one builder", () =>
    Effect.gen(function*() {
      const split = yield* entriesOf([["b"]])
      const whole = yield* entriesOf([["b"]], { splitDoublePages: false })
      expect(pageImages(split)).toHaveLength(2)
      expect(pageImages(whole)).toHaveLength(1)
    }).pipe(Effect.provide(testBuilder(files))))

  it.effect("adds the kepubify markup to every page in kepub mode only", () =>
    Effect.gen(function*() {
      const xhtml = (entries: ReadonlyArray<ZipEntry>) => entries.filter((e) => e.name.endsWith("kcc.xhtml")).map(text)
      const nav = (entries: ReadonlyArray<ZipEntry>) => text(entries.find((e) => e.name === "OEBPS/nav.xhtml"))
      const plainEntries = yield* entriesOf([["a", "c"], ["d"]])
      const kepubEntries = yield* entriesOf([["a", "c"], ["d"]], { kepub: true })
      const plain = xhtml(plainEntries)
      const kepub = xhtml(kepubEntries)
      expect(kepub).toHaveLength(3)
      expect(nav(plainEntries)).not.toContain("koboSpan")
      expect(nav(kepubEntries)).toContain("<span><span class=\"koboSpan\" id=\"kobo.1.2\">Volume 2</span></span>")
      expect(nav(kepubEntries)).toContain("<span><span class=\"koboSpan\" id=\"kobo.2.1\">Volume 1</span></span>")
      for (const page of plain) expect(page).not.toMatch(/koboSpan|kobostylehacks|book-inner/)
      for (const page of kepub) {
        expect(page).toContain("<style type=\"text/css\" class=\"kobostylehacks\">")
        expect(page).toMatch(/<\/style>\s*<\/head>/)
        expect(page).toMatch(/<body[^>]*><div id="book-columns"><div id="book-inner">[\s\S]*<\/div><\/div><\/body>/)
        expect(page).toMatch(/<span class="koboSpan" id="kobo\.1\.1"><img [^>]*\/><\/span>/)
      }
    }).pipe(Effect.provide(testBuilder(files))))
})

describe("EpubBuilder session", () => {
  it.effect("sends the site's headers to its own domain only", () => {
    const calls: Array<Call> = []
    const session = makeSession("https://site.test", clearanceFromToken("t", "UA/1"))
    const sessionFiles = { "https://cdn.example/cover": "1x1", "https://img.site.test/a": "800x1200" }
    return Effect.gen(function*() {
      yield* EpubBuilder.use((b) =>
        Stream.runDrain(b.entries({ ...book([["https://img.site.test/a"]]), info: new MangaInfo({ ...info, coverUrl: "https://cdn.example/cover" }), session }))
      )
      expect(calls.find((c) => c.url === "https://cdn.example/cover")?.options?.headers).toBeUndefined()
      expect(calls.find((c) => c.url === "https://img.site.test/a")?.options?.headers).toBe(session.headers)
    }).pipe(Effect.provide(testBuilder(sessionFiles, undefined, calls)))
  })
})
