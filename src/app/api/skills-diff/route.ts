import { NextResponse } from "next/server"
import { GIT_SOURCES } from "@/lib/sources"
import {
  buildAuthoritativeChangesFromDiffs,
  diffAllSubmodules,
  diffAllSubmodulesAtRoot,
  formatDiffsForExtraction,
} from "@/lib/skills-git"
import { summarizeFeedbackLoops } from "@/lib/feedback-loops"
import { extractEntities } from "@/lib/openai"
import { acquireRateLimit } from "@/lib/rate-limit"
import { discoverRepoSubmodules } from "@/lib/repo-diff"
import type { Entity, SourceMeta, AuthoritativeSourceGit } from "@/lib/types"

function buildSourceMetas(
  sources: AuthoritativeSourceGit[],
  status: "live" | "cached",
  fallbackReason?: SourceMeta["fallback_reason"],
  fallbackDetail?: string
): SourceMeta[] {
  return sources.map((s) => ({
    stage: "skills-diff",
    url: `https://github.com/${s.repo}`,
    label: s.label,
    scraped_at: new Date().toISOString(),
    source_type: status === "live" ? "git_diff" : "fixture",
    status,
    fallback_reason: fallbackReason,
    fallback_detail: fallbackDetail,
  }))
}

async function loadFixture() {
  const fixture = await import("@/fixtures/sample-skills-diff.json")
  const content = formatDiffsForExtraction(fixture.default as Parameters<typeof formatDiffsForExtraction>[0])
  return extractEntities(content, "skills_diff")
}

function buildSourceMetasFromOutcomes(
  outcomes: Awaited<ReturnType<typeof diffAllSubmodules>>
): SourceMeta[] {
  return outcomes.map((outcome) => {
    const base = {
      stage: "skills-diff" as const,
      url: `https://github.com/${outcome.source.repo}`,
      label: outcome.source.label,
      scraped_at: new Date().toISOString(),
      source_type: "git_diff" as const,
    }

    if (outcome.status === "error") {
      return {
        ...base,
        status: "unavailable" as const,
        fallback_reason: "git_diff_failure" as const,
        fallback_detail: outcome.error,
      }
    }

    if (outcome.status === "no_change") {
      return {
        ...base,
        status: "live" as const,
        fallback_detail: `No upstream drift detected (${outcome.pinnedSha.slice(0, 7)} == ${outcome.latestSha.slice(0, 7)}).`,
      }
    }

    return {
      ...base,
      status: "live" as const,
      fallback_detail: `${outcome.commits.length} commits ahead (${outcome.pinnedSha.slice(0, 7)} -> ${outcome.latestSha.slice(0, 7)}).`,
    }
  })
}

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimit = acquireRateLimit(request, "skills-diff", {
    windowMs: 2 * 60 * 1000,
    maxRequests: 10,
    maxConcurrent: 1,
  })

  if (rateLimit.response) {
    return rateLimit.response as NextResponse
  }

  const body = await request.json().catch(() => ({}))
  const useFallback = body?.useFallback === true
  const repoPath = typeof body?.repoPath === "string" ? body.repoPath.trim() : ""

  const gitSources = Object.values(GIT_SOURCES)

  try {
    if (repoPath) {
      const localSources = await discoverRepoSubmodules(repoPath)

      if (localSources.length === 0) {
        return NextResponse.json({
          entities: [] as Entity[],
          changes: [],
          sources: [] as SourceMeta[],
          feedbackSummary: summarizeFeedbackLoops(
            [],
            "No git submodules were detected in the requested repo."
          ),
        })
      }

      const outcomes = await diffAllSubmodulesAtRoot(localSources, repoPath)
      const updatedOutcomes = outcomes.filter((outcome) => outcome.status === "updated")
      const sources = buildSourceMetasFromOutcomes(outcomes)

      if (updatedOutcomes.length === 0) {
        return NextResponse.json({
          entities: [] as Entity[],
          changes: [],
          sources,
          feedbackSummary: summarizeFeedbackLoops(
            [],
            "No repo submodule had upstream drift, so entity extraction was skipped."
          ),
        })
      }

      const content = formatDiffsForExtraction(updatedOutcomes)
      const extraction = await extractEntities(content, "skills_diff")

      return NextResponse.json({
        entities: extraction.entities,
        changes: buildAuthoritativeChangesFromDiffs(updatedOutcomes),
        sources,
        feedbackSummary: summarizeFeedbackLoops([extraction.feedbackLoop]),
      })
    }

    if (useFallback) {
      const fixture = await loadFixture()
      return NextResponse.json({
        entities: fixture.entities,
        changes: [],
        sources: buildSourceMetas(
          gitSources,
          "cached",
          "forced_fallback",
          "Forced fallback requested for Stage 1b."
        ),
        feedbackSummary: summarizeFeedbackLoops([fixture.feedbackLoop]),
      })
    }

    try {
      const outcomes = await diffAllSubmodules(gitSources)
      const liveOutcomes = outcomes.filter((outcome) => outcome.status !== "error")
      const updatedOutcomes = outcomes.filter((outcome) => outcome.status === "updated")
      const sources = buildSourceMetasFromOutcomes(outcomes)

      if (liveOutcomes.length === 0) {
        const fixture = await loadFixture()
        return NextResponse.json({
          entities: fixture.entities,
          changes: [],
          sources: buildSourceMetas(
            gitSources,
            "cached",
            "git_diff_failure",
            "Every tracked repo diff failed; using cached skills diff fixture."
          ),
          feedbackSummary: summarizeFeedbackLoops([fixture.feedbackLoop]),
        })
      }

      if (updatedOutcomes.length === 0) {
        return NextResponse.json({
          entities: [] as Entity[],
          changes: [],
          sources,
          feedbackSummary: summarizeFeedbackLoops(
            [],
            "No entity extraction was needed because no tracked repo had upstream drift."
          ),
        })
      }

      const content = formatDiffsForExtraction(updatedOutcomes)
      const extraction = await extractEntities(content, "skills_diff")

      return NextResponse.json({
        entities: extraction.entities,
        changes: [],
        sources,
        feedbackSummary: summarizeFeedbackLoops([extraction.feedbackLoop]),
      })
    } catch (error) {
      const fixture = await loadFixture()
      return NextResponse.json({
        entities: fixture.entities,
        changes: [],
        sources: buildSourceMetas(
          gitSources,
          "cached",
          "git_diff_failure",
          error instanceof Error ? error.message : String(error)
        ),
        feedbackSummary: summarizeFeedbackLoops([fixture.feedbackLoop]),
      })
    }
  } finally {
    rateLimit.lease?.release()
  }
}
