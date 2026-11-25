import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { clearanceFromToken } from "../src/http/session.js"
import { AnimeSama, parseChapterSizes, scanPanels, splitTag } from "../src/provider/anime-sama.js"
import { Provider } from "../src/provider/provider.js"
import { type Call, fakeFetcher } from "./helpers.js"

const WORK_PAGE = `<html><body>
<script>
/* Cartes des saisons / scans :
   panneauAnime("nom", "saison1/vostfr"); panneauScan("nom", "scan/vf"); */
function panneauScan(nom, url) { oePanneau(nom, url, true); }
</script>
<script>
    panneauAnime("Saison 1", "saison1/vostfr");
</script>
<script>
    /*panneauScan("nom", "url"); -> on en met autant qu'on veut à la ligne*/
    panneauScan("Scans (couleur)", "scan/vf");
    // panneauScan("Scans (ancienne trad)", "scan_old/vf");
    <!--panneauScan("Cachés", "scan_cache/vf");-->
    panneauScan('Scans (noir et blanc)', "scan_noir-et-blanc/vf/");
    var x = "http://not-a-comment"; panneauScan("Après URL", "scan_apres/vf");
</script>
</body></html>`

describe("anime-sama parsing", () => {
  it("finds the visible scan panels only", () => {
    expect(scanPanels(WORK_PAGE)).toEqual(["scan/vf", "scan_noir-et-blanc/vf", "scan_apres/vf"])
  })

  it("finds no panel on an anime-only page", () => {
    expect(scanPanels(`<script>panneauAnime("Saison 1", "saison1/vostfr");
      /*panneauScan("nom", "url");*/</script>`)).toEqual([])
  })

  it("does not mistake comment markers inside strings for comments", () => {
    expect(scanPanels(`<script>var s = "/* not a comment", t = '//'; panneauScan("a", "scan/vf"); /* gone */</script>`))
      .toEqual(["scan/vf"])
  })

  it("splits tags, without mistaking dotted slugs for versions", () => {
    expect(splitTag("one-piece")).toEqual({ slug: "one-piece", version: undefined })
    expect(splitTag("one-piece.scan_noir-et-blanc.vf")).toEqual({ slug: "one-piece", version: "scan_noir-et-blanc/vf" })
    const slug = "2.43-seiin-koukou-danshi-volley-bu"
    expect(splitTag(slug)).toEqual({ slug, version: undefined })
    expect(splitTag(`${slug}.scan.vf`)).toEqual({ slug, version: "scan/vf" })
  })

  it("sorts chapter sizes numerically and treats an unknown work as empty", () => {
    expect(parseChapterSizes(`{"10": 19, "2": "25", "1": 53, "extra": 4, "3": -1}`)).toEqual(Option.some([
      { chapter: 1, pages: 53 },
      { chapter: 2, pages: 25 },
      { chapter: 10, pages: 19 }
    ]))
    expect(parseChapterSizes(`{"error":"Oeuvre '07 Ghost' not found"}`)).toEqual(Option.some([]))
    expect(parseChapterSizes("<html>")).toEqual(Option.none())
  })
})

const base = "https://anime-sama.to"
const files = {
  [`${base}/catalogue/x/`]: WORK_PAGE.replace("scan_noir-et-blanc/vf/", "scan_nb/vf"),
  [`${base}/catalogue/x/scan_apres/vf/`]: `<h1 id="titreOeuvre">X Apres</h1>`,
  [`${base}/s2/scans/get_nb_chap_et_img.php?oeuvre=X+Apres`]: `{}`,
  [`${base}/catalogue/x/scan/vf/`]: `<h1 id="titreOeuvre">X Name</h1><img id="imgOeuvre" src="https://cdn.example/x.jpg">`,
  [`${base}/catalogue/x/scan_nb/vf/`]: `<h1 id="titreOeuvre">X NB</h1>`,
  [`${base}/s2/scans/get_nb_chap_et_img.php?oeuvre=X+Name`]: `{"1": 2, "2": 3}`,
  [`${base}/s2/scans/get_nb_chap_et_img.php?oeuvre=X+Name+pp`]: `{"2": 1}`,
  [`${base}/s2/scans/get_nb_chap_et_img.php?oeuvre=X+NB`]: `{"1": 4}`,
  [`${base}/catalogue/?type%5B%5D=Scans&page=1`]: `
    <div class="as-carte-oeuvre" data-url="/catalogue/x/"><span class="as-badge-scan"></span></div>
    <div class="as-carte-oeuvre" data-url="/catalogue/anime-only/"></div>`,
  [`${base}/catalogue/?type%5B%5D=Scans&page=2`]: `
    <div class="as-carte-oeuvre" data-url="/catalogue/x/"><span class="as-badge-scan"></span></div>`
}

const animeSama = (calls: Array<Call>) =>
  AnimeSama(base, clearanceFromToken("good-token", "browser/1.0")).pipe(Layer.provide(fakeFetcher(files, calls)))

describe("AnimeSama provider", () => {
  it.effect("resolves a work, preferring the single-page folder when it has the chapter", () => {
    const calls: Array<Call> = []
    return Effect.gen(function*() {
      const provider = yield* Provider
      const info = yield* provider.getMangaInfo("x")
      expect(info).toMatchObject({ tag: "x", name: "X Name", coverUrl: "https://cdn.example/x.jpg", chapterCount: 2 })
      const chapters = yield* provider.getChapters(info)
      expect(chapters.map((c) => c.pages)).toEqual([
        [`${base}/s2/scans/X%20Name/1/1.jpg`, `${base}/s2/scans/X%20Name/1/2.jpg`],
        [`${base}/s2/scans/X%20Name%20pp/2/1.jpg`]
      ])
      expect(yield* provider.getChapters(info, { from: 1 })).toEqual(chapters.slice(1))
      expect(calls.every((call) => call.options?.headers?.["cookie"] === "cf_clearance=good-token")).toBe(true)
      expect(calls.every((call) => call.options?.headers?.["user-agent"] === "browser/1.0")).toBe(true)
    }).pipe(Effect.provide(animeSama(calls)))
  })

  it.effect("lists every version of every work with scans, the first one under the bare slug, skipping empty ones", () =>
    Effect.gen(function*() {
      const mangas = yield* (yield* Provider).getAllMangas()
      expect(mangas.map((m) => m.tag)).toEqual(["x", "x.scan_nb.vf"])
    }).pipe(Effect.provide(animeSama([]))))
})
