export interface Clearance {
  readonly cookie: string
  readonly userAgent: string
}

export const clearanceFromToken = (token: string, userAgent: string) => ({
  cookie: `cf_clearance=${token.trim()}`,
  userAgent
})

export interface Session {
  readonly domain: string
  readonly headers: Readonly<Record<string, string>>
}

export const makeSession = (baseUrl: string, clearance?: Clearance) => {
  const url = new URL(baseUrl)
  return {
    domain: url.hostname.replace(/^www\./, ""),
    headers: {
      referer: `${url.origin}/`,
      ...(clearance ? { cookie: clearance.cookie, "user-agent": clearance.userAgent } : {})
    }
  }
}

export const headersFor = (session: Session | undefined, url: string) => {
  if (!session) return undefined
  const host = URL.canParse(url) ? new URL(url).hostname : ""
  return host === session.domain || host.endsWith(`.${session.domain}`) ? session.headers : undefined
}
