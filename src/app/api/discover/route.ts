import { NextResponse } from "next/server"
import { scrapePage } from "@/lib/tinyfish"
import { extractEntities } from "@/lib/openai"
import { summarizeFeedbackLoops } from "@/lib/feedback-loops"
import { classifyDiscoveryFallbackReason } from "@/lib/fallbacks"
import { acquireRateLimit } from "@/lib/rate-limit"
import { NOISY_SOURCES } from "@/lib/sources"
import type { SourceMeta } from "@/lib/types"

const HN_SOURCE = NOISY_SOURCES.hn
const DISCOVERY_LIVE_TIMEOUT_MS = 20_000

const HN_SCRAPE_GOAL =
  "Extract all story titles, URLs, point counts, and comment counts from the front page as a JSON array"

async function loadFixture() {
  const fixture = await import("@/fixtures/sample-hn-scrape.json")
  const content = JSON.stringify(fixture.default.result)
  return extractEntities(content, "hackernews")
}

function buildSourceMeta(
  status: "live" | "cached",
  fallbackReason?: SourceMeta["fallback_reason"],
  fallbackDetail?: string
): SourceMeta {
  return {
    stage: "discovery",
    url: HN_SOURCE.url,
    label: HN_SOURCE.label,
    scraped_at: new Date().toISOString(),
    source_type: status === "live" ? "tinyfish" : "fixture",
    status,
    fallback_reason: fallbackReason,
    fallback_detail: fallbackDetail,
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimit = acquireRateLimit(request, "discover", {
    windowMs: 2 * 60 * 1000,
    maxRequests: 12,
    maxConcurrent: 2,
  })

  if (rateLimit.response) {
    return rateLimit.response as NextResponse
  }

  const body = await request.json().catch(() => ({}))
  const useFallback = body?.useFallback === true

  try {
    if (useFallback) {
      const fixture = await loadFixture()
      return NextResponse.json({
        entities: fixture.entities,
        source: buildSourceMeta("cached", "forced_fallback", "Forced fallback requested for Stage 1."),
        feedbackSummary: summarizeFeedbackLoops([fixture.feedbackLoop]),
      })
    }

    try {
      const scrapeResult = await scrapePage({
        url: HN_SOURCE.url,
        goal: HN_SCRAPE_GOAL,
        browser_profile: HN_SOURCE.browser_profile,
      }, { timeoutMs: DISCOVERY_LIVE_TIMEOUT_MS })

      const content =
        typeof scrapeResult.result === "string"
          ? scrapeResult.result
          : JSON.stringify(scrapeResult.result)

      const extraction = await extractEntities(content, "hackernews")
      return NextResponse.json({
        entities: extraction.entities,
        source: buildSourceMeta("live"),
        feedbackSummary: summarizeFeedbackLoops([extraction.feedbackLoop]),
      })
    } catch (error) {
      const isTimeout =
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      const errorMsg = isTimeout
        ? `TinyFish timeout: ${error instanceof Error ? error.message : String(error)}`
        : error instanceof Error ? error.message : String(error)

      const fixture = await loadFixture()
      return NextResponse.json({
        entities: fixture.entities,
        source: buildSourceMeta(
          "cached",
          classifyDiscoveryFallbackReason(errorMsg),
          errorMsg
        ),
        feedbackSummary: summarizeFeedbackLoops([fixture.feedbackLoop]),
      })
    }
  } finally {
    rateLimit.lease?.release()
  }
}
