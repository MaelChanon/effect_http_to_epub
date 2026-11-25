import { describe, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http"
import { Fetcher } from "../src/http/fetcher.js"

const scripted = (responses: Array<() => Response>, calls: Array<HttpClientRequest.HttpClientRequest>) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        calls.push(request)
        const next = responses[Math.min(calls.length - 1, responses.length - 1)]!
        return HttpClientResponse.fromWeb(request, next())
      })
    )
  )

const fetcherWith = (responses: Array<() => Response>, calls: Array<HttpClientRequest.HttpClientRequest>) =>
  Fetcher.layer({ retries: 3, retryBaseDelayMillis: 1 }).pipe(Layer.provide(scripted(responses, calls)))

const ok = () => new Response("ok", { status: 200 })

describe("Fetcher", () => {
  it.live("retries transient failures (503) then succeeds", () => {
    const calls: Array<HttpClientRequest.HttpClientRequest> = []
    return Effect.gen(function*() {
      const body = yield* (yield* Fetcher).text("https://x/page")
      expect(body).toBe("ok")
      expect(calls).toHaveLength(3)
    }).pipe(Effect.provide(fetcherWith([
      () => new Response("down", { status: 503 }),
      () => new Response("down", { status: 503 }),
      ok
    ], calls)))
  })

  it.live("does not retry a 404 and reports it as a typed FetchError", () => {
    const calls: Array<HttpClientRequest.HttpClientRequest> = []
    return Effect.gen(function*() {
      const error = yield* Effect.flip((yield* Fetcher).bytes("https://x/missing.jpg"))
      expect(error).toMatchObject({ _tag: "FetchError", status: 404 })
      expect(calls).toHaveLength(1)
    }).pipe(Effect.provide(fetcherWith([() => new Response("nope", { status: 404 })], calls)))
  })

  it.live.each([
    { name: "403 with cf-mitigated", status: 403, headers: { "cf-mitigated": "challenge" } },
    { name: "503 from the cloudflare server", status: 503, headers: { server: "cloudflare" } }
  ])("turns a Cloudflare challenge ($name) into ClearanceRequired, without retrying", ({ status, headers }) => {
    const calls: Array<HttpClientRequest.HttpClientRequest> = []
    return Effect.gen(function*() {
      const error = yield* Effect.flip((yield* Fetcher).text("https://x/"))
      expect(error._tag).toBe("ClearanceRequired")
      expect(calls).toHaveLength(1)
    }).pipe(Effect.provide(fetcherWith([() => new Response("challenge", { status, headers })], calls)))
  })

  it.live("keeps a hotlink 403 a plain FetchError", () => {
    const calls: Array<HttpClientRequest.HttpClientRequest> = []
    return Effect.gen(function*() {
      const error = yield* Effect.flip((yield* Fetcher).bytes("https://x/a.jpg"))
      expect(error).toMatchObject({ _tag: "FetchError", status: 403 })
      expect(calls).toHaveLength(1)
    }).pipe(Effect.provide(fetcherWith([() => new Response("no", { status: 403, headers: { server: "cloudflare" } })], calls)))
  })

  it.live("sends the default User-Agent unless the caller overrides it", () => {
    const calls: Array<HttpClientRequest.HttpClientRequest> = []
    return Effect.gen(function*() {
      const fetcher = yield* Fetcher
      yield* fetcher.text("https://x/a")
      yield* fetcher.text("https://x/b", { headers: { "user-agent": "browser/1.0", cookie: "cf_clearance=t" } })
      expect(calls[0]?.headers["user-agent"]).toContain("Mozilla/5.0")
      expect(calls[1]?.headers).toMatchObject({ "user-agent": "browser/1.0", cookie: "cf_clearance=t" })
    }).pipe(Effect.provide(fetcherWith([ok], calls)))
  })

  it.live("always sends an Accept header, which the caller can override", () => {
    const calls: Array<HttpClientRequest.HttpClientRequest> = []
    return Effect.gen(function*() {
      const fetcher = yield* Fetcher
      yield* fetcher.text("https://x/a")
      yield* fetcher.text("https://x/b", { headers: { accept: "text/html" } })
      expect(calls.map((call) => call.headers["accept"])).toEqual(["*/*", "text/html"])
    }).pipe(Effect.provide(fetcherWith([ok], calls)))
  })

  it.live("posts a form when one is given", () => {
    const calls: Array<HttpClientRequest.HttpClientRequest> = []
    return Effect.gen(function*() {
      yield* (yield* Fetcher).text("https://x/ajax", { form: { action: "load", page: "2" } })
      expect(calls[0]?.method).toBe("POST")
      const body = calls[0]?.body
      expect(body?._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : undefined).toBe("action=load&page=2")
    }).pipe(Effect.provide(fetcherWith([ok], calls)))
  })
})
