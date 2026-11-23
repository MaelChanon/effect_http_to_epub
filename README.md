# http_to_epub

Download manga chapters and build fixed-layout EPUB or Kobo KEPUB files:
right-to-left reading, optional double-page splitting, images resized for
e-readers. Usable as a CLI or as an [Effect](https://effect.website) library.

## Install

```sh
npm install -g effect_http_to_epub   # CLI, provides the `http_to_epub` command
npm install effect_http_to_epub effect @effect/platform-node   # library
```

Requires Node 22+.

## CLI

```sh
http_to_epub build --site sushiscan --tag kingdom --from 104 --to 105 -o out/kingdom.epub --split
http_to_epub build --site anime-sama --tag chainsaw-man --to 1 --cf-clearance <token> --user-agent "<UA>"
http_to_epub build --site sushiscan --tag kingdom --to 1 -o out/kingdom.epub --kepub   # writes out/kingdom.kepub.epub
http_to_epub manifest --manifest pages.json -o out/book.epub   # fixed list of page URLs
http_to_epub build --help
```

`--from` and `--to` select chapters by index, `to` excluded. Broken pages are
skipped unless `--strict` is set.

Supported sites: `sushiscan`, `sushiscan-net`, `manga-origins`, `anime-sama`.

### Cloudflare

Some sites sit behind a Cloudflare challenge. The tool does not solve it: get a
`cf_clearance` cookie from your browser and pass it with `--cf-clearance`,
together with that browser's `--user-agent`. Without it, a challenged request
fails with `ClearanceRequired`. These headers are only sent to the site's own
domain.

## Library

```ts
import { NodeHttpClient, NodeServices } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { AnimeSama, clearanceFromToken, EpubBuilder, Fetcher, ImageProcessor, Provider, toFile } from "effect_http_to_epub"

const program = Effect.gen(function*() {
  const provider = yield* Provider
  const builder = yield* EpubBuilder
  const info = yield* provider.getMangaInfo("chainsaw-man")
  const chapters = yield* provider.getChapters(info)
  const book = { info, chapters: chapters.slice(0, 2), creator: "me", lang: "fr-FR", session: provider.session }
  yield* builder.build(book, { width: 1072, height: 1448, splitDoublePages: true }).pipe(toFile("out/csm.epub"))
})

const AppLayer = Layer.mergeAll(
  EpubBuilder.layer({ encodeConcurrency: 8 }),
  AnimeSama("https://anime-sama.to", clearanceFromToken(token, userAgent))
).pipe(
  Layer.provide(Layer.mergeAll(Fetcher.layer(), ImageProcessor.sharp)),
  Layer.provide(NodeHttpClient.layerUndici),
  Layer.provideMerge(NodeServices.layer)
)

Effect.runPromise(program.pipe(Effect.provide(AppLayer)))
```

- `builder.build(book, options)` returns a `Stream<Uint8Array, BuildError>`.
  Nothing happens until it is consumed, so the bytes can go to a file
  (`toFile`, which removes partial output on failure), an HTTP response, S3, etc.
- Per-book options (`EpubOptions`): `width`, `height`, `splitDoublePages`,
  `jpegQuality`, `compressImages`, `kepub`, `onPageError`.
- Per-deployment options are given to the layers once:
  `Fetcher.layer({ retries, requestTimeoutMillis, ... })` and
  `EpubBuilder.layer({ fetchConcurrency, encodeConcurrency })`.
  `encodeConcurrency` is shared by all concurrent builds.
- Site layers: `SushiScan`, `SushiScanNet`, `MangaOrigins`, `AnimeSama`
  (`(baseUrl, clearance?)`), or `Provider.fromManifest` for a fixed page list.
  Building a layer does no I/O, so creating one per request is cheap.
- Errors are typed: `FetchError`, `ClearanceRequired`, `ParseError`,
  `ImageError`, `ArchiveError`, `OutputError`.
- Tracing spans, all prefixed with `http_to_epub.`, cover builds, HTTP
  requests and image encoding. They cost nothing until you provide a tracer,
  such as the Otlp layers from `effect/observability`.

With `kepub: true`, the output already contains what
[kepubify](https://pgaskin.net/kepubify/) would add. Kobo devices only use
the KEPUB renderer when the file name ends in `.kepub.epub`, so name it
accordingly.

## Development

```sh
pnpm install
pnpm test       # no network needed
pnpm build      # tsc + esbuild bundle -> dist/cli.bundle.mjs
pnpm cli build --help
```

## License

[MIT](LICENSE)
