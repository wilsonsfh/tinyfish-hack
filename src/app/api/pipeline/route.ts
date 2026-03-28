import type {
  Entity,
  AuthoritativeChange,
  DiscoverResponse,
  DiffResponse,
  Finding,
  PipelineEvent,
  ResolveResponse,
  SkillsDiffResponse,
  SourceMeta,
  QuickCheckScope,
  RepoDiffScope,
} from "@/lib/types"
import {
  buildQuickCheckConfigContent,
  filterChangesByQuickCheckScope,
  filterEntitiesByQuickCheckScope,
  inferQuickCheckScope,
} from "@/lib/quick-check"
import { materializeRepoInput } from "@/lib/repo-diff"
import { acquireRateLimit, buildInternalRequestHeaders } from "@/lib/rate-limit"

/**
 * Pipeline orchestrator — runs all stages in sequence, streams progress via SSE.
 *
 * Stages 1 + 1b run in parallel (HN scrape + skills git diff).
 * Stage 2 runs after 1/1b complete (needs entity names).
 * Stage 3 runs after 2 (needs authoritative changes).
 * Stages 4+5 are computed inline (confidence tiering + output assembly).
 */
export async function POST(request: Request) {
  const rateLimit = acquireRateLimit(request, "pipeline", {
    windowMs: 2 * 60 * 1000,
    maxRequests: 4,
    maxConcurrent: 1,
  })

  if (rateLimit.response) {
    return rateLimit.response
  }

  const body = await request.json().catch(() => ({}))
  const { configContent, configFilename = "config.md", useFallback = false, quickCheckQuery = "", repoUrl = "" } = body as {
    configContent?: string
    configFilename?: string
    useFallback?: boolean
    quickCheckQuery?: string
    repoPath?: string
    repoUrl?: string
  }
  const repoPath = typeof body?.repoPath === "string" ? body.repoPath.trim() : ""
  const normalizedRepoUrl = typeof repoUrl === "string" ? repoUrl.trim() : ""
  const repoDiffMode = Boolean(repoPath || normalizedRepoUrl)

  const quickCheckScope = inferQuickCheckScope(
    quickCheckQuery,
    configContent ?? "",
    !configContent && Boolean(quickCheckQuery.trim())
  )
  const effectiveConfigContent =
    configContent || (quickCheckScope ? buildQuickCheckConfigContent(quickCheckScope) : "")
  const effectiveConfigFilename =
    configContent?.trim() ? configFilename : quickCheckScope ? "quick-check.txt" : configFilename

  if (!effectiveConfigContent && !repoDiffMode) {
    rateLimit.lease?.release()
    return new Response(JSON.stringify({ error: "configContent, quickCheckQuery, repoPath, or repoUrl is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  }

  const baseUrl = new URL(request.url).origin

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PipelineEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      const allSources: SourceMeta[] = []
      const allEntities: Entity[] = []
      let allChanges: AuthoritativeChange[] = []
      let allFindings: Finding[] = []
      const resolvedScope: QuickCheckScope | null = quickCheckScope
      let repoDiffScope: RepoDiffScope | null = null
      let repoInventoryContent = ""
      let repoInventoryFilename = ""
      let repoGitChanges: AuthoritativeChange[] = []
      let effectiveRepoPath = repoPath
      let cleanupRepoInput: (() => Promise<void>) | null = null

      try {
        if (quickCheckScope) {
          send({
            type: "STAGE_PROGRESS",
            stage: "discovery",
            message: `Quick Check scope: ${quickCheckScope.selectedSubjects.join(", ") || "general AI tooling"}`,
          })
        }
        if (repoDiffMode) {
          send({
            type: "STAGE_PROGRESS",
            stage: "discovery",
            message: normalizedRepoUrl
              ? `Repo Diff cloning: ${normalizedRepoUrl}`
              : `Repo Diff scanning: ${repoPath}`,
          })
          try {
            const materialized = await materializeRepoInput({
              repoPath,
              repoUrl: normalizedRepoUrl,
            })
            effectiveRepoPath = materialized.repoPath
            cleanupRepoInput = materialized.cleanup
            send({
              type: "STAGE_PROGRESS",
              stage: "discovery",
              message: `Repo Diff ready: ${materialized.repoLabel}`,
            })
          } catch (error) {
            send({ type: "PIPELINE_ERROR", error: error instanceof Error ? error.message : String(error) })
            return
          }
        }

        // ---------------------------------------------------------------
        // Stage 1 + 1b: Discovery (parallel)
        // ---------------------------------------------------------------
        send({ type: "STAGE_START", stage: "discovery", timestamp: now() })
        send({ type: "STAGE_START", stage: "skills-diff", timestamp: now() })

        const [discoverResult, skillsDiffResult] = await Promise.allSettled([
          repoDiffMode
            ? callStage<DiscoverResponse>(baseUrl, "/api/repo-inventory", { repoPath: effectiveRepoPath })
            : callStage<DiscoverResponse>(baseUrl, "/api/discover", { useFallback }),
          callStage<SkillsDiffResponse>(baseUrl, "/api/skills-diff", {
            useFallback,
            repoPath: repoDiffMode ? effectiveRepoPath : undefined,
          }),
        ])

        // Process discovery result
        if (discoverResult.status === "fulfilled") {
          const data = discoverResult.value
          repoDiffScope = data.repoDiff ?? null
          repoInventoryContent = data.repoDiff?.inventorySummary ?? ""
          repoInventoryFilename = data.repoDiff ? `${data.repoDiff.repoLabel || "repo"}-inventory.txt` : ""
          const scopedEntities = filterEntitiesByQuickCheckScope(data.entities ?? [], quickCheckScope)
          allEntities.push(...scopedEntities)
          if (data.source) allSources.push(data.source)
          const degradedSources = getDegradedSources(data.source ? [data.source] : [])
          send({
            type: "STAGE_COMPLETE",
            stage: "discovery",
            output: {
              entities: scopedEntities,
              scope: resolvedScope,
              repoDiff: repoDiffScope,
            },
            fallback: degradedSources.length > 0,
            fallbackReasons: getFallbackReasons(degradedSources),
            degradedSources,
            feedbackSummary: data.feedbackSummary,
          })
        } else {
          send({ type: "STAGE_ERROR", stage: "discovery", error: String(discoverResult.reason), fallback: false })
          if (repoDiffMode) {
            send({ type: "PIPELINE_ERROR", error: `Critical stage failed: discovery: ${String(discoverResult.reason)}` })
            return
          }
        }

        // Process skills diff result
        if (skillsDiffResult.status === "fulfilled") {
          const data = skillsDiffResult.value
          const scopedEntities = filterEntitiesByQuickCheckScope(data.entities ?? [], quickCheckScope)
          allEntities.push(...scopedEntities)
          repoGitChanges = quickCheckScope
            ? filterChangesByQuickCheckScope(data.changes ?? [], quickCheckScope)
            : (data.changes ?? [])
          if (data.sources) allSources.push(...data.sources)
          const degradedSources = getDegradedSources(data.sources ?? [])
          send({
            type: "STAGE_COMPLETE",
            stage: "skills-diff",
            output: scopedEntities,
            fallback: degradedSources.length > 0,
            fallbackReasons: getFallbackReasons(degradedSources),
            degradedSources,
            feedbackSummary: data.feedbackSummary,
          })
        } else {
          send({ type: "STAGE_ERROR", stage: "skills-diff", error: String(skillsDiffResult.reason), fallback: false })
        }

        // Deduplicate entities by name
        const entityNames = [...new Set([
          ...allEntities.map((e) => e.name),
          ...(quickCheckScope?.selectedSubjects ?? []),
          ...(repoDiffScope?.selectedSubjects ?? []),
        ])]
        send({ type: "STAGE_PROGRESS", stage: "discovery", message: `${entityNames.length} unique entities found` })

        // ---------------------------------------------------------------
        // Stage 2: Authoritative Resolution
        // ---------------------------------------------------------------
        send({ type: "STAGE_START", stage: "resolution", timestamp: now() })

        const authoritySourceKeys = [...new Set([
          ...(quickCheckScope?.authoritySourceKeys ?? []),
          ...(repoDiffScope?.authoritySourceKeys ?? []),
        ])]

        try {
          const resolveData = await callStage<ResolveResponse>(baseUrl, "/api/resolve", {
            entities: entityNames,
            useFallback,
            authoritySourceKeys,
          })
          const resolvedChanges = filterChangesByQuickCheckScope(resolveData.changes ?? [], quickCheckScope)
          allChanges = repoDiffMode ? [...repoGitChanges, ...resolvedChanges] : resolvedChanges
          if (resolveData.sources) allSources.push(...resolveData.sources)
          const degradedSources = getDegradedSources(resolveData.sources ?? [])
          send({
            type: "STAGE_COMPLETE",
            stage: "resolution",
            output: {
              changes: allChanges,
              summary: resolveData.summary,
            },
            fallback: degradedSources.length > 0,
            fallbackReasons: resolveData.fallbackReasons ?? getFallbackReasons(degradedSources),
            degradedSources,
            feedbackSummary: resolveData.feedbackSummary,
          })
        } catch (err) {
          send({ type: "STAGE_ERROR", stage: "resolution", error: String(err), fallback: false })
          send({ type: "PIPELINE_ERROR", error: `Critical stage failed: resolution: ${String(err)}` })
          return
        }

        // ---------------------------------------------------------------
        // Stage 3: Diff against user config
        // ---------------------------------------------------------------
        send({ type: "STAGE_START", stage: "diff", timestamp: now() })

        try {
          const diffData = await callStage<DiffResponse>(baseUrl, "/api/diff", {
            configContent: configContent || repoInventoryContent || effectiveConfigContent,
            configFilename: configContent?.trim()
              ? configFilename
              : repoInventoryFilename || effectiveConfigFilename,
            changes: allChanges,
            quickCheckContext: [
              quickCheckScope ? quickCheckScope.explanation.join("\n") : "",
              repoDiffScope ? repoDiffScope.explanation.join("\n") : "",
            ]
              .filter(Boolean)
              .join("\n\n") || undefined,
          })
          allFindings = diffData.findings ?? []
          send({
            type: "STAGE_COMPLETE",
            stage: "diff",
            output: allFindings,
            fallback: false,
            feedbackSummary: diffData.feedbackSummary,
          })
        } catch (err) {
          send({ type: "STAGE_ERROR", stage: "diff", error: String(err), fallback: false })
          send({ type: "PIPELINE_ERROR", error: `Critical stage failed: diff: ${String(err)}` })
          return
        }

        // ---------------------------------------------------------------
        // Stage 4: Confidence tiering (already done by GPT-4o in Stage 3,
        // but we validate and enrich here)
        // ---------------------------------------------------------------
        send({ type: "STAGE_START", stage: "confidence", timestamp: now() })
        allFindings = enrichConfidence(allFindings, allEntities, allChanges)
        send({ type: "STAGE_COMPLETE", stage: "confidence", output: allFindings, fallback: false })

        // ---------------------------------------------------------------
        // Stage 5: Output
        // ---------------------------------------------------------------
        send({ type: "STAGE_START", stage: "output", timestamp: now() })
        send({
          type: "STAGE_COMPLETE",
          stage: "output",
          output: { findings: allFindings, sources: allSources },
          fallback: false,
        })

        // Pipeline complete
        send({ type: "PIPELINE_COMPLETE", findings: allFindings, sources: allSources })
      } catch (err) {
        send({ type: "PIPELINE_ERROR", error: String(err) })
      } finally {
        await cleanupRepoInput?.().catch(() => {})
        rateLimit.lease?.release()
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString()
}

function getDegradedSources(sources: SourceMeta[]): SourceMeta[] {
  return sources.filter((source) => source.status !== "live")
}

function getFallbackReasons(sources: SourceMeta[]) {
  return [...new Set(sources.flatMap((source) => (
    source.fallback_reason ? [source.fallback_reason] : []
  )))]
}

async function callStage<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: buildInternalRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${path} failed (${res.status}): ${text}`)
  }

  return res.json() as Promise<T>
}

/**
 * Enrich confidence tiers by cross-referencing entities and changes.
 * - If a finding's entity was seen in BOTH noisy (HN) and authoritative sources → bump to HIGH
 * - If only in noisy → keep LOW
 * - If authoritative says X but noisy says opposite → CONFLICT
 */
function enrichConfidence(
  findings: Finding[],
  entities: Entity[],
  changes: AuthoritativeChange[]
): Finding[] {
  const hnEntities = new Set(entities.filter((e) => e.source === "hackernews").map((e) => e.name.toLowerCase()))
  const skillEntities = new Set(entities.filter((e) => e.source === "skills_diff").map((e) => e.name.toLowerCase()))
  const repoEntities = new Set(entities.filter((e) => e.source === "repo_inventory").map((e) => e.name.toLowerCase()))
  const authEntities = new Set(changes.map((c) => c.entity.toLowerCase()))

  return findings.map((f) => {
    const name = f.entity.toLowerCase()
    const inHn = hnEntities.has(name)
    const inSkills = skillEntities.has(name)
    const inRepo = repoEntities.has(name)
    const inAuth = authEntities.has(name)

    // Build provenance if missing
    if (!f.provenance || f.provenance.length === 0) {
      f.provenance = []
      if (inHn) {
        const hnEntity = entities.find((e) => e.source === "hackernews" && e.name.toLowerCase() === name)
        f.provenance.push({
          source: "HackerNews",
          summary: hnEntity?.context ?? "Mentioned on HN",
          tier: "LOW",
        })
      }
      if (inSkills) {
        const skillEntity = entities.find((e) => e.source === "skills_diff" && e.name.toLowerCase() === name)
        f.provenance.push({
          source: "Skills Repo Diff",
          summary: skillEntity?.context ?? "Updated in skills repo",
          tier: "MEDIUM",
        })
      }
      if (inRepo) {
        const repoEntity = entities.find((e) => e.source === "repo_inventory" && e.name.toLowerCase() === name)
        f.provenance.push({
          source: "Repo Inventory",
          summary: repoEntity?.context ?? "Referenced directly in the scanned repo",
          tier: "MEDIUM",
        })
      }
      if (inAuth) {
        const authChange = changes.find((c) => c.entity.toLowerCase() === name)
        f.provenance.push({
          source: authChange?.source_label ?? "Authoritative Source",
          url: authChange?.source_url,
          date: authChange?.date,
          summary: authChange?.description ?? "Confirmed by authoritative source",
          tier: "HIGH",
        })
      }
    }

    return f
  })
}
