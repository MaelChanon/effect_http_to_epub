import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ParseError } from "../domain.js"
import { mangaStream } from "./sushiscan.js"

const decodeTsReader = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ sources: Schema.Array(Schema.Struct({ images: Schema.Array(Schema.String) })) }))
)

export const readerImages = (html: string) => {
  const payload = /ts_reader\.run\((\{.*\})\);/.exec(html)?.[1]
  if (payload === undefined) return undefined
  const reader = decodeTsReader(payload)
  return reader._tag === "Some" ? reader.value.sources.find((source) => source.images.length > 0)?.images : undefined
}

export const SushiScanNet = mangaStream("sushiscan-net", (doc) => {
  const pages = readerImages(doc.html)
  return pages ? Effect.succeed(pages) : Effect.fail(new ParseError({ url: doc.url, what: "the ts_reader payload" }))
})
