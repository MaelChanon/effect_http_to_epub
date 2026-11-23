import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import { OutputError } from "./domain.js"

export const toFile = (target: string) =>
<E, R>(bytes: Stream.Stream<Uint8Array, E, R>) =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const fail = (cause: unknown) => new OutputError({ target, cause })
    yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.mapError(fail))
    yield* Stream.run(bytes, fs.sink(target).pipe(Sink.mapError(fail))).pipe(
      Effect.onExit((exit) => Exit.isSuccess(exit) ? Effect.void : Effect.ignore(fs.remove(target, { force: true })))
    )
  })
