import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { setFlagsFromString } from "node:v8"
import { runInNewContext } from "node:vm"
import { Fetcher } from "../src/http/fetcher.js"
import { AnimeSama } from "../src/provider/anime-sama.js"
import { MangaOrigins } from "../src/provider/manga-origins.js"
import { Provider } from "../src/provider/provider.js"
import { SushiScan } from "../src/provider/sushiscan.js"

setFlagsFromString("--expose-gc")
const gc: () => void = runInNewContext("gc")

const COUNT = 40
const PADDING = `<!--${"x".repeat(1_000_000)}-->`
const base = "https://site.test"
const slugs = Array.from({ length: COUNT }, (_, i) => `a-rather-long-series-name-${i}`)
const lastSegment = (url: string) => url.replace(/\/(\?.*)?$/, "").split("/").pop() ?? ""

// Every response is a string of its own, as over the network
const serve = (render: (url: string) => string) =>
  Layer.succeed(Fetcher, {
    text: (url) =>
      Effect.sync(() => {
        const body = render(url)
        return body.startsWith("<") ? Buffer.from(body + PADDING).toString() : body
      }),
    bytes: () => Effect.die("unused")
  })

const heapUsed = () => {
  gc()
  return process.memoryUsage().heapUsed
}

const expectSmall = <A, E, R>(effect: Effect.Effect<ReadonlyArray<A>, E, R>) =>
  Effect.gen(function*() {
    const before = heapUsed()
    const result = yield* effect
    const retained = heapUsed() - before
    expect(result).toHaveLength(COUNT)
    expect(retained).toBeLessThan(COUNT * PADDING.length / 4)
  })

const catalog = Provider.use((site) => site.getAllMangas())

describe("results do not retain the pages they were scraped from", () => {
  const sushiscanSeries = (slug: string) =>
    `<h1 class="entry-title">${slug}</h1><div class="seriestucontl"><img src="${base}/covers/${slug}.jpg"></div>`
  const sushiscanListing = (listed: ReadonlyArray<string>) =>
    `<div class="listupd">${listed.map((slug) => `<div><div><a href="${base}/catalogue/${slug}/">x</a></div></div>`).join("")}</div>`

  it.effect("series pages", () =>
    expectSmall(catalog).pipe(Effect.provide(SushiScan(base).pipe(Layer.provide(serve((url) =>
      url.includes("?page=") ? sushiscanListing(slugs) : sushiscanSeries(lastSegment(url))
    ))))))

  it.effect("listing pages", () =>
    expectSmall(catalog).pipe(Effect.provide(SushiScan(base).pipe(Layer.provide(serve((url) => {
      const page = /\?page=(\d+)/.exec(url)?.[1]
      return page ? sushiscanListing(slugs.slice(Number(page) - 1, Number(page))) : sushiscanSeries("x")
    }))))))

  it.effect("anime-sama work and reader pages", () =>
    expectSmall(catalog).pipe(Effect.provide(AnimeSama(base).pipe(Layer.provide(serve((url) => {
      if (url.includes("get_nb_chap_et_img")) return `{"1":3}`
      if (url.includes("?type")) {
        return slugs.map((slug) => `<div class="as-carte-oeuvre" data-url="/catalogue/${slug}/"><i class="as-badge-scan"></i></div>`).join("")
      }
      return url.endsWith("/vf/")
        ? `<h1 id="titreOeuvre">${slugs[0]}</h1><img id="imgOeuvre" src="${base}/covers/${slugs[0]}.jpg">`
        : `<script>panneauScan("Scans", "scan/vf")</script>`
    }))))))

  it.effect("chapter pages", () =>
    expectSmall(Provider.use((site) => Effect.flatMap(site.getMangaInfo("x"), (info) => site.getChapters(info)))).pipe(
      Effect.provide(MangaOrigins(base).pipe(Layer.provide(serve((url) =>
        lastSegment(url) === "x"
          ? `<div class="post-title"><h1>x</h1></div>${
            slugs.map((slug) => `<div class="ori-chl-row"><a class="ori-chl-corps" href="${base}/oeuvre/x/${slug}/">x</a></div>`).join("")
          }`
          : `<div class="reading-content"><img src="${base}/pages/${lastSegment(url)}/1.jpg"></div>`
      ))))
    ))
})
