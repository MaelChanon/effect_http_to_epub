import * as Data from "effect/Data"
import * as Schema from "effect/Schema"
import type { Session } from "./http/session.js"

export class MangaInfo extends Schema.Class<MangaInfo>("MangaInfo")({
  tag: Schema.String,
  name: Schema.String,
  coverUrl: Schema.String,
  chapterCount: Schema.Number
}) {}

export class Chapter extends Schema.Class<Chapter>("Chapter")({
  number: Schema.Number,
  pages: Schema.Array(Schema.String)
}) {}

export interface Book {
  readonly info: MangaInfo
  readonly chapters: ReadonlyArray<Chapter>
  readonly creator: string
  readonly lang: string
  readonly session?: Session | undefined
}

export interface EncodedPage {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

export class FetchError extends Data.TaggedError("FetchError")<{
  readonly url: string
  readonly status?: number | undefined
  readonly cause?: unknown
}> {
  override get message() {
    return `fetch failed for ${this.url}${this.status ? ` (HTTP ${this.status})` : ""}`
  }
}

export class ClearanceRequired extends Data.TaggedError("ClearanceRequired")<{
  readonly url: string
}> {}

export class ParseError extends Data.TaggedError("ParseError")<{
  readonly url: string
  readonly what: string
}> {
  override get message() {
    return `could not find ${this.what} in ${this.url}`
  }
}

export class ImageError extends Data.TaggedError("ImageError")<{
  readonly cause: unknown
}> {}

export class ArchiveError extends Data.TaggedError("ArchiveError")<{
  readonly entry?: string | undefined
  readonly cause: unknown
}> {}

export class OutputError extends Data.TaggedError("OutputError")<{
  readonly target: string
  readonly cause: unknown
}> {}
