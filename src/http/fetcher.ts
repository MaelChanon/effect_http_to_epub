import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import * as HttpClient from "effect/http/HttpClient"
import * as HttpClientError from "effect/http/HttpClientError"
import * as HttpClientRequest from "effect/http/HttpClientRequest"
import type * as HttpClientResponse from "effect/http/HttpClientResponse"
import { ClearanceRequired, FetchError } from "../domain.js"

export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export const defaultFetcherOptions = {
  retries: 3,
  retryBaseDelayMillis: 500,
  requestTimeoutMillis: 60_000
}

export type FetcherOptions = typeof defaultFetcherOptions

export interface RequestOptions {
  readonly headers?: Readonly<Record<string, string>> | undefined
  readonly form?: Readonly<Record<string, string>> | undefined
}

export class Fetcher extends Context.Service<Fetcher, {
  readonly text: (url: string, options?: RequestOptions) => Effect.Effect<string, FetchError | ClearanceRequired>
  readonly bytes: (url: string, options?: RequestOptions) => Effect.Effect<Uint8Array, FetchError | ClearanceRequired>
}>()("http_to_epub/Fetcher") {
  static readonly layer = (options: Partial<FetcherOptions> = {}) => Layer.effect(Fetcher, make(options))
}

const make = (overrides: Partial<FetcherOptions>) =>
  Effect.gen(function*() {
    const config = { ...defaultFetcherOptions, ...overrides }
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk)
    const retryPolicy = Schedule.exponential(Duration.millis(config.retryBaseDelayMillis)).pipe(Schedule.jittered)

    const request = <A>(
      url: string,
      options: RequestOptions | undefined,
      read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, HttpClientError.HttpClientError>
    ) =>
      Effect.suspend(() => {
        let attempts = 0
        const attempt = Effect.suspend(() => {
          attempts++
          return client.execute(buildRequest(url, options)).pipe(
            Effect.tap((response) => Effect.annotateCurrentSpan("http.response.status_code", response.status)),
            Effect.flatMap(read),
            Effect.timeoutOrElse({
              duration: Duration.millis(config.requestTimeoutMillis),
              orElse: () => Effect.fail(new FetchError({ url, cause: "timeout" }))
            })
          )
        })
        return attempt.pipe(
          Effect.retry({ schedule: retryPolicy, times: config.retries, while: isTransient }),
          Effect.catchIf(HttpClientError.isHttpClientError, (error) => {
            const status = statusOf(error)
            return Effect.andThen(
              status === undefined ? Effect.void : Effect.annotateCurrentSpan("http.response.status_code", status),
              Effect.fail(toFetchError(url, error))
            )
          }),
          Effect.ensuring(Effect.suspend(() => Effect.annotateCurrentSpan("http_to_epub.attempts", attempts))),
          Effect.withSpan("http_to_epub.Fetcher.request", {
            kind: "client",
            attributes: { "url.full": url, "http.request.method": options?.form ? "POST" : "GET" }
          })
        )
      })

    return Fetcher.of({
      text: (url, options) => request(url, options, (res) => res.text),
      bytes: (url, options) => request(url, options, (res) => Effect.map(res.arrayBuffer, (buf) => new Uint8Array(buf)))
    })
  })

const buildRequest = (url: string, options: RequestOptions | undefined) => {
  const headers = { "user-agent": USER_AGENT, ...options?.headers }
  return options?.form
    ? HttpClientRequest.post(url, { headers }).pipe(HttpClientRequest.bodyUrlParams(options.form))
    : HttpClientRequest.get(url, { headers })
}

const toFetchError = (url: string, error: HttpClientError.HttpClientError) =>
  isChallenge(error)
    ? new ClearanceRequired({ url })
    : new FetchError({ url, status: statusOf(error), cause: error })

const statusOf = (error: HttpClientError.HttpClientError) =>
  error.reason._tag === "StatusCodeError" ? error.reason.response.status : undefined

export const isTransient = (error: unknown) => {
  if (error instanceof FetchError) return true
  if (!HttpClientError.isHttpClientError(error)) return false
  if (error.reason._tag === "TransportError") return true
  const status = statusOf(error)
  return status !== undefined && (status >= 500 || status === 429 || status === 408) && !isChallenge(error)
}

const isChallenge = (error: HttpClientError.HttpClientError) => {
  if (error.reason._tag !== "StatusCodeError") return false
  const { status, headers } = error.reason.response
  if (status !== 403 && status !== 503) return false
  return "cf-mitigated" in headers || (status === 503 && headers["server"]?.toLowerCase() === "cloudflare")
}
