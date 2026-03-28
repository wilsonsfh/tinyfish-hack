type RateLimitPolicy = {
  windowMs: number
  maxRequests: number
  maxConcurrent?: number
}

type RateLimitRecord = {
  timestamps: number[]
  concurrent: number
}

type RateLimitLease = {
  release: () => void
  remaining: number
  retryAfterSeconds: number
}

const INTERNAL_REQUEST_HEADER = "x-driftcheck-internal"
const rateLimitStore = new Map<string, RateLimitRecord>()

function now(): number {
  return Date.now()
}

function getClientId(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim()
  }

  const realIp = request.headers.get("x-real-ip")
  if (realIp) {
    return realIp.trim()
  }

  return "local-single-user"
}

function getRecord(key: string, windowMs: number): RateLimitRecord {
  const existing = rateLimitStore.get(key)
  const cutoff = now() - windowMs

  if (!existing) {
    const created: RateLimitRecord = { timestamps: [], concurrent: 0 }
    rateLimitStore.set(key, created)
    return created
  }

  existing.timestamps = existing.timestamps.filter((timestamp) => timestamp >= cutoff)
  return existing
}

function buildRateLimitResponse(policy: RateLimitPolicy, retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({
      error: "Rate limit exceeded. Wait before starting another run.",
      retryAfterSeconds,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(policy.maxRequests),
      },
    }
  )
}

export function isInternalRequest(request: Request): boolean {
  return request.headers.get(INTERNAL_REQUEST_HEADER) === "1"
}

export function buildInternalRequestHeaders(
  headers: Record<string, string> = {}
): Record<string, string> {
  return {
    ...headers,
    [INTERNAL_REQUEST_HEADER]: "1",
  }
}

export function acquireRateLimit(
  request: Request,
  routeKey: string,
  policy: RateLimitPolicy
): { lease: RateLimitLease | null; response: Response | null } {
  if (isInternalRequest(request)) {
    return { lease: null, response: null }
  }

  const clientId = getClientId(request)
  const key = `${routeKey}:${clientId}`
  const record = getRecord(key, policy.windowMs)
  const currentTime = now()
  const retryAfterSeconds = Math.max(1, Math.ceil(policy.windowMs / 1000))

  if (record.timestamps.length >= policy.maxRequests) {
    const oldestTimestamp = record.timestamps[0] ?? currentTime
    const retryAfter = Math.max(1, Math.ceil((oldestTimestamp + policy.windowMs - currentTime) / 1000))
    return {
      lease: null,
      response: buildRateLimitResponse(policy, retryAfter),
    }
  }

  if (policy.maxConcurrent !== undefined && record.concurrent >= policy.maxConcurrent) {
    return {
      lease: null,
      response: buildRateLimitResponse(policy, retryAfterSeconds),
    }
  }

  record.timestamps.push(currentTime)
  record.concurrent += 1

  let released = false
  return {
    lease: {
      remaining: Math.max(policy.maxRequests - record.timestamps.length, 0),
      retryAfterSeconds,
      release: () => {
        if (released) return
        released = true
        const current = rateLimitStore.get(key)
        if (!current) return
        current.concurrent = Math.max(0, current.concurrent - 1)
      },
    },
    response: null,
  }
}
