import * as NodeStream from "@effect/platform-node/NodeStream"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import yazl from "yazl"
import { ArchiveError } from "../domain.js"

export interface ZipEntry {
  readonly name: string
  readonly data: Uint8Array | string
  readonly compress: boolean
}

export const zip = <E, R>(entries: Stream.Stream<ZipEntry, E, R>) =>
  Stream.suspend(() => {
    const file = new yazl.ZipFile()
    const feed = Stream.runForEach(entries, ({ name, data, compress }) =>
      Effect.try({
        try: () => {
          const buffer = typeof data === "string" ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
          file.addBuffer(buffer, name, { compress, mtime: EPOCH })
        },
        catch: (cause) => new ArchiveError({ entry: name, cause })
      })).pipe(Effect.andThen(Effect.sync(() => file.end())))

    return NodeStream.fromReadable({
      evaluate: () => file.outputStream,
      onError: (cause) => new ArchiveError({ cause })
    }).pipe(Stream.merge(Stream.fromEffectDrain(feed)))
  })

const EPOCH = new Date(Date.UTC(2020, 0, 1))
