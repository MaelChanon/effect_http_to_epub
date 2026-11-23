import { Effect, Layer } from "effect"
import { FetchError } from "../src/domain.js"
import { EpubBuilder } from "../src/epub/epubBuilder.js"
import { Fetcher, type RequestOptions } from "../src/http/fetcher.js"
import { ImageProcessor } from "../src/image/ImageProcessor.js"

export interface Call {
  readonly url: string
  readonly options: RequestOptions | undefined
}

export const fakeFetcher = (files: Record<string, Uint8Array | string>, calls: Array<Call> = []) => {
  const lookup = (url: string, options: RequestOptions | undefined) => {
    calls.push({ url, options })
    const file = files[url]
    return file === undefined ? Effect.fail(new FetchError({ url, status: 404 })) : Effect.succeed(file)
  }
  return Layer.succeed(Fetcher, {
    text: (url, options) => Effect.map(lookup(url, options), String),
    bytes: (url, options) =>
      Effect.map(lookup(url, options), (file) => typeof file === "string" ? new TextEncoder().encode(file) : file)
  })
}

export const testBuilder = (
  files: Record<string, Uint8Array | string>,
  images: Layer.Layer<ImageProcessor> = ImageProcessor.fake,
  calls: Array<Call> = []
) =>
  EpubBuilder.layer().pipe(Layer.provide(Layer.mergeAll(fakeFetcher(files, calls), images)))
