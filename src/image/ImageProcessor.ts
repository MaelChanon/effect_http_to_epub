import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type { Sharp } from "sharp"
import { type EncodedPage, ImageError } from "../domain.js"

export interface ImageOptions {
  readonly width: number
  readonly height: number
  readonly splitDoublePages: boolean
  readonly jpegQuality: number
}

export class ImageProcessor extends Context.Service<ImageProcessor, {
  readonly process: (input: Uint8Array, options: ImageOptions) => Effect.Effect<ReadonlyArray<EncodedPage>, ImageError>
}>()("http_to_epub/ImageProcessor") {
  static readonly sharp = Layer.effect(
    ImageProcessor,
    Effect.gen(function*() {
      const sharp = (yield* Effect.promise(() => import("sharp"))).default
      sharp.cache(false)

      const encode = (pipeline: Sharp, { width, height, jpegQuality }: ImageOptions) =>
        Effect.tryPromise({
          try: () =>
            pipeline
              .resize({ width, height, fit: "inside" })
              .jpeg({ quality: jpegQuality, mozjpeg: false })
              .toBuffer({ resolveWithObject: true }),
          catch: (cause) => new ImageError({ cause })
        }).pipe(Effect.map(({ data, info }) => ({ data, width: info.width, height: info.height })))

      return {
        process: Effect.fn("http_to_epub.ImageProcessor.process")(function*(input: Uint8Array, options: ImageOptions) {
          const meta = yield* Effect.tryPromise({
            try: () => sharp(input).metadata(),
            catch: (cause) => new ImageError({ cause })
          })
          const w = meta.width ?? 0
          const h = meta.height ?? 0
          const split = options.splitDoublePages && w > h
          yield* Effect.annotateCurrentSpan({
            "http_to_epub.image.input_bytes": input.byteLength,
            "http_to_epub.image.width": w,
            "http_to_epub.image.height": h,
            "http_to_epub.image.split": split
          })
          if (!split) return [yield* encode(sharp(input), options)]

          const half = Math.floor(w / 2)
          return yield* Effect.all([
            encode(sharp(input).extract({ left: half, top: 0, width: w - half, height: h }), options),
            encode(sharp(input).extract({ left: 0, top: 0, width: half, height: h }), options)
          ], { concurrency: 2 })
        })
      }
    })
  )

  static readonly fake = Layer.succeed(ImageProcessor, {
    process: (input, options) =>
      Effect.try({
        try: () => {
          const [w, h] = new TextDecoder().decode(input).split("x").map(Number)
          if (!w || !h) throw new Error("bad fake image")
          return options.splitDoublePages && w > h
            ? [{ data: input, width: w / 2, height: h }, { data: input, width: w / 2, height: h }]
            : [{ data: input, width: w, height: h }]
        },
        catch: (cause) => new ImageError({ cause })
      })
  })
}
