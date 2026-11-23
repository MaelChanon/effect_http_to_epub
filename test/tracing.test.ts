import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Stream, Tracer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { Chapter, MangaInfo } from "../src/domain.js"
import { EpubBuilder } from "../src/epub/epubBuilder.js"
import { Fetcher } from "../src/http/fetcher.js"
import { testBuilder } from "./helpers.js"

const recording = () => {
  const spans: Array<Tracer.NativeSpan> = []
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    }
  })
  const named = (name: string) => spans.filter((span) => span.name === name)
  const parentName = (span: Tracer.NativeSpan) =>
    Option.match(span.parent, { onNone: () => undefined, onSome: (p) => p._tag === "Span" ? p.name : undefined })
  return { tracer, named, parentName }
}

const scripted = (responses: Array<() => Response>) => {
  let calls = 0
  return Fetcher.layer({ retries: 3, retryBaseDelayMillis: 1 }).pipe(Layer.provide(Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => HttpClientResponse.fromWeb(request, responses[Math.min(calls++, responses.length - 1)]!()))
    )
  )))
}

describe("tracing", () => {
  it.live("Fetcher.request records the URL, the final status and the number of attempts", () => {
    const { tracer, named } = recording()
    return Effect.gen(function*() {
      yield* (yield* Fetcher).text("https://x/page")
      const [span] = named("http_to_epub.Fetcher.request")
      expect(Object.fromEntries(span!.attributes)).toMatchObject({
        "url.full": "https://x/page",
        "http.request.method": "GET",
        "http.response.status_code": 200,
        "http_to_epub.attempts": 3
      })
    }).pipe(
      Effect.provide(scripted([() => new Response("", { status: 503 }), () => new Response("", { status: 503 }), () => new Response("ok")])),
      Effect.withTracer(tracer)
    )
  })

  it.live("a failed request keeps its status code on the span", () => {
    const { tracer, named } = recording()
    return Effect.gen(function*() {
      yield* Effect.flip((yield* Fetcher).bytes("https://x/missing.jpg"))
      const [span] = named("http_to_epub.Fetcher.request")
      expect(span!.attributes.get("http.response.status_code")).toBe(404)
      expect(span!.attributes.get("http_to_epub.attempts")).toBe(1)
      expect(span!.status._tag === "Ended" && span!.status.exit._tag).toBe("Failure")
    }).pipe(Effect.provide(scripted([() => new Response("", { status: 404 })])), Effect.withTracer(tracer))
  })

  it.effect("a build reports its pages, and each encode (permit wait included) has its own span", () => {
    const { tracer, named, parentName } = recording()
    const info = new MangaInfo({ tag: "op", name: "op", coverUrl: "cover", chapterCount: 1 })
    const book = { info, creator: "me", lang: "fr-FR", chapters: [new Chapter({ number: 0, pages: ["a", "missing", "b"] })] }
    const files = { cover: "1x1", a: "800x1200", b: "1600x1200" }
    return Effect.gen(function*() {
      const builder = yield* EpubBuilder
      yield* Stream.runDrain(builder.build(book, { splitDoublePages: true }))

      const [entries] = named("http_to_epub.EpubBuilder.entries")
      expect(parentName(entries!)).toBe("http_to_epub.EpubBuilder.build")
      expect(Object.fromEntries(entries!.attributes)).toMatchObject({
        "http_to_epub.book.tag": "op",
        "http_to_epub.pages.source": 3,
        "http_to_epub.pages.produced": 3,
        "http_to_epub.pages.skipped": 1
      })

      const encodes = named("http_to_epub.EpubBuilder.encode")
      expect(encodes.map((span) => span.attributes.get("url.full")).sort()).toEqual(["a", "b"])
      expect(encodes.every((span) => parentName(span) === "http_to_epub.EpubBuilder.entries")).toBe(true)
      expect(named("http_to_epub.EpubBuilder.cover")).toHaveLength(1)
    }).pipe(Effect.provide(testBuilder(files)), Effect.withTracer(tracer))
  })
})
