import { NextResponse } from "next/server"
import { PARSED_AUTHORITATIVE_FIXTURES } from "@/fixtures/parsed-authoritative"
import { scrapeParallel } from "@/lib/tinyfish"
import { parseAuthoritative } from "@/lib/openai"
import { summarizeFeedbackLoops } from "@/lib/feedback-loops"
import {
  classifyOpenAIFallbackReason,
  classifyTinyFishFallbackReason,
  normalizeAuthoritativeChanges,
} from "@/lib/fallbacks"
import { acquireRateLimit } from "@/lib/rate-limit"
import { WEB_SOURCES } from "@/lib/sources"
import type {
  AuthoritativeChange,
  FeedbackLoopMeta,
  FallbackReason,
  ResolveResponse,
  ResolutionSummary,
  SourceMeta,
  TinyFishRequest,
} from "@/lib/types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildGoal = (entityNames: string[]): string =>
  `Extract all changelog/release entries from the last 30 days related to these topics: ${entityNames.join(", ")}. Return as JSON array.`

const resultToString = (result: unknown): string =>
  typeof result === "string" ? result : JSON.stringify(result)

type WebSourceKey = keyof typeof PARSED_AUTHORITATIVE_FIXTURES
const RESOLUTION_LIVE_TIMEOUT_MS = 30_000

async function loadFixtureForSource(sourceKey: WebSourceKey): Promise<{
  changes: AuthoritativeChange[]
}> {
  const source = WEB_SOURCES[sourceKey]
  const parsed = PARSED_AUTHORITATIVE_FIXTURES[sourceKey] ?? []
  return {
    changes: applySourceDefaults(parsed, source),
  }
}

function buildSourceMeta(
  source: (typeof WEB_SOURCES)[WebSourceKey],
  status: SourceMeta["status"],
  sourceType: SourceMeta["source_type"],
  fallbackReason?: FallbackReason,
  fallbackDetail?: string
): SourceMeta {
  return {
    stage: "resolution",
    url: source.url,
    label: source.label,
    scraped_at: new Date().toISOString(),
    source_type: sourceType,
    status,
    fallback_reason: fallbackReason,
    fallback_detail: fallbackDetail,
  }
}

function applySourceDefaults(
  changes: AuthoritativeChange[],
  source: (typeof WEB_SOURCES)[WebSourceKey]
): AuthoritativeChange[] {
  return changes.map((change) => ({
    ...change,
    source_url: change.source_url?.trim() || source.url,
    source_label: change.source_label?.trim() || source.label,
  }))
}

function buildSummary(sources: SourceMeta[], rawChangeCount: number, changes: AuthoritativeChange[]): ResolutionSummary {
  const liveSources = sources.filter((source) => source.status === "live").length
  const cachedSources = sources.length - liveSources

  return {
    total_sources: sources.length,
    live_sources: liveSources,
    cached_sources: cachedSources,
    raw_change_count: rawChangeCount,
    normalized_change_count: changes.length,
    duplicates_collapsed: Math.max(0, rawChangeCount - changes.length),
  }
}

// ---------------------------------------------------------------------------
// POST /api/resolve
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse<ResolveResponse>> {
  const rateLimit = acquireRateLimit(request, "resolve", {
    windowMs: 2 * 60 * 1000,
    maxRequests: 10,
    maxConcurrent: 2,
  })

  if (rateLimit.response) {
    return rateLimit.response as NextResponse<ResolveResponse>
  }

  const body = await request.json().catch(() => ({}))
  const entities: string[] = Array.isArray(body?.entities) ? body.entities : []
  const useFallback: boolean = body?.useFallback === true
  const authoritySourceKeys = Array.isArray(body?.authoritySourceKeys)
    ? body.authoritySourceKeys.filter((key: unknown): key is WebSourceKey => typeof key === "string" && key in WEB_SOURCES)
    : []

  const goal = buildGoal(entities.length > 0 ? entities : ["AI tooling changes"])

  const allWebSourceEntries = Object.entries(WEB_SOURCES) as [WebSourceKey, (typeof WEB_SOURCES)[WebSourceKey]][]
  const webSourceEntries = authoritySourceKeys.length > 0
    ? allWebSourceEntries.filter(([key]) => authoritySourceKeys.includes(key))
    : allWebSourceEntries
  const webSources = webSourceEntries.map(([, source]) => source)

  // Force fixture path when requested
  try {
    if (useFallback) {
      const fixtureResults = await Promise.all(
        webSourceEntries.map(async ([sourceKey]) => loadFixtureForSource(sourceKey))
      )
      const rawChanges = fixtureResults.flatMap((result) => result.changes)
      const changes = normalizeAuthoritativeChanges(rawChanges)
      const sources: SourceMeta[] = webSources.map((source) =>
        buildSourceMeta(
          source,
          "cached",
          "fixture",
          "forced_fallback",
          "Forced fallback requested for Stage 2."
        )
      )
      const summary = buildSummary(sources, rawChanges.length, changes)

      return NextResponse.json({
        changes,
        sources,
        degraded: true,
        fallbackReasons: ["forced_fallback"],
        summary,
        feedbackSummary: summarizeFeedbackLoops(
          [],
          "Cached authoritative fixtures were used; no model feedback loop was needed for Stage 2."
        ),
      })
    }

    // Build one TinyFishRequest per web source
    const requests: TinyFishRequest[] = webSources.map((s) => ({
      url: s.url,
      goal,
      browser_profile: s.browser_profile,
    }))

    // Scrape all sources in parallel — failures come back as status: "FAILED"
    const scrapeResults = await scrapeParallel(requests, {
      timeoutMs: RESOLUTION_LIVE_TIMEOUT_MS,
    })

    const allChanges: AuthoritativeChange[] = []
    const allSources: SourceMeta[] = []
    const feedbackLoops: FeedbackLoopMeta[] = []

    await Promise.all(
      scrapeResults.map(async (scrapeResult, index) => {
        const [sourceKey, source] = webSourceEntries[index]
        if (scrapeResult.status === "COMPLETED") {
          try {
            const content = resultToString(scrapeResult.result)
            const parsed = await parseAuthoritative(content, source.url, source.label)
            const changes = applySourceDefaults(parsed.changes, source)
            allChanges.push(...changes)
            feedbackLoops.push(parsed.feedbackLoop)
            allSources.push(buildSourceMeta(source, "live", "tinyfish"))
          } catch (error) {
            // OpenAI parse failed — fall back to fixture for this source
            const fallback = await loadFixtureForSource(sourceKey)
            allChanges.push(...fallback.changes)
            allSources.push(
              buildSourceMeta(
                source,
                "cached",
                "fixture",
                classifyOpenAIFallbackReason(error instanceof Error ? error.message : String(error)),
                error instanceof Error ? error.message : String(error)
              )
            )
          }
        } else {
          // TinyFish scrape failed — fall back to fixture for this source
          const fallback = await loadFixtureForSource(sourceKey)
          allChanges.push(...fallback.changes)
          allSources.push(
            buildSourceMeta(
              source,
              "cached",
              "fixture",
              classifyTinyFishFallbackReason(scrapeResult.error),
              scrapeResult.error ?? undefined
            )
          )
        }
      })
    )

    const changes = normalizeAuthoritativeChanges(allChanges)
    const cachedSources = allSources.filter((source) => source.status === "cached")
    const fallbackReasons = [...new Set(cachedSources.flatMap((source) => (
      source.fallback_reason ? [source.fallback_reason] : []
    )))]
    const summary = buildSummary(allSources, allChanges.length, changes)

    return NextResponse.json({
      changes,
      sources: allSources,
      degraded: cachedSources.length > 0,
      fallbackReasons,
      summary,
      feedbackSummary: summarizeFeedbackLoops(
        feedbackLoops,
        cachedSources.length > 0
          ? "Cached authoritative fixtures were used for degraded Stage 2 sources; no model feedback loop was needed for those fallback payloads."
          : "No model feedback loop was needed for this stage."
      ),
    })
  } finally {
    rateLimit.lease?.release()
  }
}
