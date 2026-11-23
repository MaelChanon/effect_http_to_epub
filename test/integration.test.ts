import * as NodeServices from "@effect/platform-node/NodeServices"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import sharp from "sharp"
import yauzl from "yauzl"
import { Chapter, MangaInfo } from "../src/domain.js"
import { EpubBuilder } from "../src/epub/epubBuilder.js"
import { ImageProcessor } from "../src/image/ImageProcessor.js"
import { toFile } from "../src/output.js"
import { testBuilder } from "./helpers.js"

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer()

type ListedEntry = { name: string; method: number; size: number }

const listEntries = (buffer: Buffer) =>
  new Promise<Array<ListedEntry>>((resolve, reject) =>
    yauzl.fromBuffer(buffer, { lazyEntries: false }, (err, zip) => {
      if (err) return reject(err)
      const out: Array<ListedEntry> = []
      zip.on("entry", (e) => out.push({ name: e.fileName, method: e.compressionMethod, size: e.uncompressedSize }))
      zip.on("end", () => resolve(out))
      zip.on("error", reject)
    })
  )

const realBuilder = (files: Record<string, Uint8Array | string>) => testBuilder(files, ImageProcessor.sharp)
const options = { width: 600, height: 800, splitDoublePages: true, onPageError: "fail" } as const

const info = new MangaInfo({ tag: "t", name: "T", coverUrl: "cover", chapterCount: 1 })
const book = (pages: Array<string>) => ({ info, creator: "me", lang: "fr", chapters: [new Chapter({ number: 0, pages })] })
const tmpTarget = (name: string) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "epub-")), name)

describe("EPUB stream (sharp + yazl)", () => {
  const withFs = Effect.provide(NodeServices.layer)

  it.live("streams a readable zip with mimetype first and stored, pages resized", () =>
    Effect.gen(function*() {
      const files = {
        cover: yield* Effect.promise(() => jpeg(300, 400)),
        p1: yield* Effect.promise(() => jpeg(1200, 1800)),
        spread: yield* Effect.promise(() => jpeg(2400, 1800))
      }
      const chunks = yield* Effect.provide(
        EpubBuilder.use((b) => Stream.runCollect(b.build(book(["p1", "spread"]), options))),
        realBuilder(files)
      )
      const entries = yield* Effect.promise(() => listEntries(Buffer.concat(chunks)))
      expect(entries[0]).toMatchObject({ name: "mimetype", method: 0 })
      expect(entries.filter((e) => e.name.startsWith("OEBPS/Images/t/"))).toHaveLength(3)
    }))

  it.live("toFile writes the stream on disk", () =>
    Effect.gen(function*() {
      const target = tmpTarget("book.epub")
      const files = { cover: yield* Effect.promise(() => jpeg(300, 400)), p1: yield* Effect.promise(() => jpeg(1200, 1800)) }
      yield* Effect.provide(EpubBuilder.use((b) => b.build(book(["p1"]), options).pipe(toFile(target))), realBuilder(files)).pipe(withFs)
      const entries = yield* Effect.promise(() => listEntries(fs.readFileSync(target)))
      expect(entries.map((e) => e.name)).toContain("OEBPS/content.opf")
    }))

  it.live("toFile removes the partial file when the build fails", () =>
    Effect.gen(function*() {
      const target = tmpTarget("broken.epub")
      const files = { cover: yield* Effect.promise(() => jpeg(300, 400)), p1: "not an image" }
      const error = yield* Effect.flip(Effect.provide(
        EpubBuilder.use((b) => b.build(book(["p1"]), options).pipe(toFile(target))),
        realBuilder(files)
      ).pipe(withFs))
      expect(error._tag).toBe("ImageError")
      expect(fs.existsSync(target)).toBe(false)
    }))
})
