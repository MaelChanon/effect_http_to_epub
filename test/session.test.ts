import { describe, expect, it } from "@effect/vitest"
import { clearanceFromToken, headersFor, makeSession } from "../src/http/session.js"

describe("session", () => {
  it("always sends a Referer, and the clearance only when there is one", () => {
    expect(makeSession("https://www.sushiscan.net/catalogue/x/").headers).toEqual({ referer: "https://www.sushiscan.net/" })
    const clearance = clearanceFromToken(" abc.def-1 \n", "UA/1")
    expect(makeSession("https://sushiscan.net", clearance).headers).toEqual({
      referer: "https://sushiscan.net/",
      cookie: "cf_clearance=abc.def-1",
      "user-agent": "UA/1"
    })
  })

  it("scopes the headers to the site's domain and its subdomains", () => {
    const session = makeSession("https://www.sushiscan.net", clearanceFromToken("t", "UA/1"))
    expect(headersFor(session, "https://sushiscan.net/catalogue/")).toBe(session.headers)
    expect(headersFor(session, "https://c1.sushiscan.net/a.jpg")).toBe(session.headers)
    expect(headersFor(session, "https://cdn.example/a.jpg")).toBeUndefined()
    expect(headersFor(session, "https://notsushiscan.net/a.jpg")).toBeUndefined()
    expect(headersFor(undefined, "https://sushiscan.net/")).toBeUndefined()
  })
})
