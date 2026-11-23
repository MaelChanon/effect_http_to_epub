#!/usr/bin/env node
import "./env.js"

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as ByteSize from "effect/ByteSize"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import * as FileSystem from "effect/FileSystem"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Command from "effect/cli/Command"
import * as Flag from "effect/cli/Flag"
import { Chapter, MangaInfo } from "../domain.js"
import { defaultBuilderOptions, defaultEpubOptions, EpubBuilder, type EpubOptions } from "../epub/epubBuilder.js"
import { Fetcher } from "../http/fetcher.js"
import { ImageProcessor } from "../image/ImageProcessor.js"
import { toFile } from "../output.js"
import { Provider } from "../provider/provider.js"
import { clearanceFromToken } from "../http/session.js"
import { sites } from "../provider/sites.js"

interface Concurrency {
  readonly fetchConcurrency: number
  readonly encodeConcurrency: number
}

const appLayer = (provider: Layer.Layer<Provider, never, Fetcher>, concurrency: Concurrency) =>
  Layer.mergeAll(EpubBuilder.layer(concurrency), provider).pipe(
    Layer.provide(Layer.mergeAll(Fetcher.layer(), ImageProcessor.sharp)),
    Layer.provide(NodeHttpClient.layerUndici)
  )

const fetchAndBuild = (tag: string, from: number, to: number | undefined, out: string, options: EpubOptions) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const provider = yield* Provider
    const builder = yield* EpubBuilder
    const info = yield* provider.getMangaInfo(tag)
    const chapters = yield* provider.getChapters(info)
    const selected = chapters.slice(from, to)
    yield* Console.log(`${info.name}: ${chapters.length} chapters, building ${selected.length} (${provider.name})`)
    const started = performance.now()
    yield* builder.build({ info, chapters: selected, creator: "http_to_epub", lang: "fr-FR", session: provider.session }, options).pipe(toFile(out))
    const { size } = yield* fs.stat(out)
    const megabytes = (Number(ByteSize.toBigInt(size)) / 1024 / 1024).toFixed(1)
    yield* Console.log(`${out} (${megabytes} MB) in ${((performance.now() - started) / 1000).toFixed(2)}s`)
  })

const optionFlags = {
  width: Flag.Int("width").pipe(Flag.withDefault(defaultEpubOptions.width)),
  height: Flag.Int("height").pipe(Flag.withDefault(defaultEpubOptions.height)),
  split: Flag.Boolean("split").pipe(Flag.withDefault(false), Flag.withDescription("split double pages in two")),
  compressImages: Flag.Boolean("compress-images").pipe(Flag.withDefault(false), Flag.withDescription("deflate JPEGs (Rust parity)")),
  strict: Flag.Boolean("strict").pipe(Flag.withDefault(false), Flag.withDescription("fail on the first broken page instead of skipping it")),
  kepub: Flag.Boolean("kepub").pipe(
    Flag.withDefault(false),
    Flag.withDescription("Kobo KEPUB (like kepubify); the output is renamed to .kepub.epub")
  ),
  fetchConcurrency: Flag.Int("fetch-concurrency").pipe(Flag.withDefault(defaultBuilderOptions.fetchConcurrency)),
  encodeConcurrency: Flag.Int("encode-concurrency").pipe(Flag.withDefault(defaultBuilderOptions.encodeConcurrency))
}

const toOptions = (f: {
  width: number
  height: number
  split: boolean
  compressImages: boolean
  strict: boolean
  kepub: boolean
}): EpubOptions => ({
  ...defaultEpubOptions,
  width: f.width,
  height: f.height,
  splitDoublePages: f.split,
  compressImages: f.compressImages,
  onPageError: f.strict ? "fail" : "skip",
  kepub: f.kepub
})

// Kobo only opens a file with its KEPUB renderer when it is named *.kepub.epub
const outputPath = (out: string, kepub: boolean) =>
  !kepub || out.endsWith(".kepub.epub") ? out : `${out.replace(/\.epub$/, "")}.kepub.epub`

const out = Flag.String("out").pipe(Flag.withAlias("o"), Flag.withDefault("out/book.epub"))

const build = Command.make(
  "build",
  {
    site: Flag.Literals("site", ["sushiscan", "sushiscan-net", "manga-origins", "anime-sama"]),
    cfClearance: Flag.String("cf-clearance").pipe(
      Flag.optional,
      Flag.withDescription("cf_clearance token, when the site is behind a Cloudflare challenge")
    ),
    userAgent: Flag.String("user-agent").pipe(
      Flag.optional,
      Flag.withDescription("User-Agent of the browser that obtained the cf_clearance token")
    ),
    baseUrl: Flag.String("base-url").pipe(Flag.optional),
    tag: Flag.String("tag"),
    from: Flag.Int("from").pipe(Flag.withDefault(0)),
    to: Flag.Int("to").pipe(Flag.optional),
    out,
    ...optionFlags
  },
  (f) => {
    const site = sites[f.site]
    const baseUrl = f.baseUrl._tag === "Some" ? f.baseUrl.value : site.defaultUrl
    if (!baseUrl) return Effect.fail(new Error(`--base-url is required for ${f.site}`))
    if (f.cfClearance._tag === "Some" && f.userAgent._tag === "None") {
      return Effect.fail(new Error("--cf-clearance needs the --user-agent it was issued to"))
    }
    const clearance = f.cfClearance._tag === "Some" && f.userAgent._tag === "Some"
      ? clearanceFromToken(f.cfClearance.value, f.userAgent.value)
      : undefined
    const to = f.to._tag === "Some" ? f.to.value : undefined
    return fetchAndBuild(f.tag, f.from, to, outputPath(f.out, f.kepub), toOptions(f)).pipe(
      Effect.provide(appLayer(site.make(baseUrl, clearance), f))
    )
  }
).pipe(Command.withDescription("scrape a site and build an EPUB of chapters [from, to)"))

const Manifest = Schema.Struct({ info: MangaInfo, chapters: Schema.Array(Chapter) })

const manifest = Command.make(
  "manifest",
  { manifest: Flag.String("manifest"), out, ...optionFlags },
  (f) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const json = yield* fs.readFileString(f.manifest)
      const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))(json)
      yield* fetchAndBuild(decoded.info.tag, 0, undefined, outputPath(f.out, f.kepub), toOptions(f)).pipe(
        Effect.provide(appLayer(Provider.fromManifest(decoded), f))
      )
    })
).pipe(Command.withDescription("build an EPUB from a JSON list of page URLs (used by the bench)"))

const cli = Command.make("http_to_epub").pipe(Command.withSubcommands([build, manifest]))

Command.run(cli, { version: "0.1.0" }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
