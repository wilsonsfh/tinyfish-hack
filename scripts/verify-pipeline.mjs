import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import process from "node:process"
import { setTimeout as delay } from "node:timers/promises"

const port = Number(process.env.VERIFY_PORT ?? 3100)
const host = "127.0.0.1"
const baseUrl = `http://${host}:${port}`
const requestedMode = process.env.VERIFY_MODE ?? "all"

const PARALLEL_STAGES = ["discovery", "skills-diff"]
const SEQUENTIAL_STAGES = ["resolution", "diff", "confidence", "output"]

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function hasLiveCredentials() {
  return Boolean(process.env.OPENAI_API_KEY && process.env.TINYFISH_API_KEY)
}

function shouldRunLive() {
  return requestedMode === "live" || requestedMode === "all"
}

function shouldRunFallback() {
  return requestedMode === "fallback" || requestedMode === "all"
}

async function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now()

  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {
      // Server is not ready yet.
    }

    await delay(1_000)
  }

  throw new Error(`Timed out waiting for dev server at ${url}`)
}

async function collectSseEvents(response) {
  assert(response.body, "Pipeline response body is missing")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events = []
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const raw = line.slice(6).trim()
      if (!raw) continue
      events.push(JSON.parse(raw))
    }
  }

  return events
}

function getStageEvent(events, type, stage) {
  return events.find((event) => event.type === type && event.stage === stage)
}

function getStageEventIndex(events, type, stage) {
  return events.findIndex((event) => event.type === type && event.stage === stage)
}

function getPipelineComplete(events) {
  return events.find((event) => event.type === "PIPELINE_COMPLETE")
}

function assertStageLifecycle(events, stage) {
  const startIndex = getStageEventIndex(events, "STAGE_START", stage)
  const completeIndex = getStageEventIndex(events, "STAGE_COMPLETE", stage)

  assert(startIndex >= 0, `Missing STAGE_START for ${stage}`)
  assert(completeIndex >= 0, `Missing STAGE_COMPLETE for ${stage}`)
  assert(startIndex < completeIndex, `${stage} completed before it started`)
}

function assertFeedbackSummary(events, stage) {
  const completeEvent = getStageEvent(events, "STAGE_COMPLETE", stage)

  assert(completeEvent, `Missing STAGE_COMPLETE for ${stage}`)
  assert(
    completeEvent.feedbackSummary && Array.isArray(completeEvent.feedbackSummary.details),
    `${stage} should include feedbackSummary details`
  )
}

function assertSseOrder(events) {
  for (const stage of [...PARALLEL_STAGES, ...SEQUENTIAL_STAGES]) {
    assertStageLifecycle(events, stage)
  }

  for (const stage of ["discovery", "skills-diff", "resolution", "diff"]) {
    assertFeedbackSummary(events, stage)
  }

  const discoveryCompleteIndex = getStageEventIndex(events, "STAGE_COMPLETE", "discovery")
  const skillsCompleteIndex = getStageEventIndex(events, "STAGE_COMPLETE", "skills-diff")
  const discoveryProgressIndex = getStageEventIndex(events, "STAGE_PROGRESS", "discovery")
  const resolutionStartIndex = getStageEventIndex(events, "STAGE_START", "resolution")
  const resolutionCompleteIndex = getStageEventIndex(events, "STAGE_COMPLETE", "resolution")
  const diffStartIndex = getStageEventIndex(events, "STAGE_START", "diff")
  const diffCompleteIndex = getStageEventIndex(events, "STAGE_COMPLETE", "diff")
  const confidenceStartIndex = getStageEventIndex(events, "STAGE_START", "confidence")
  const confidenceCompleteIndex = getStageEventIndex(events, "STAGE_COMPLETE", "confidence")
  const outputStartIndex = getStageEventIndex(events, "STAGE_START", "output")
  const outputCompleteIndex = getStageEventIndex(events, "STAGE_COMPLETE", "output")
  const pipelineCompleteIndex = events.findIndex((event) => event.type === "PIPELINE_COMPLETE")

  assert(
    discoveryProgressIndex > discoveryCompleteIndex && discoveryProgressIndex > skillsCompleteIndex,
    "Discovery progress should be emitted after both parallel stages complete"
  )
  assert(
    resolutionStartIndex > discoveryProgressIndex,
    "Resolution should start only after discovery progress is emitted"
  )
  assert(resolutionCompleteIndex < diffStartIndex, "Diff should start after resolution completes")
  assert(diffCompleteIndex < confidenceStartIndex, "Confidence should start after diff completes")
  assert(confidenceCompleteIndex < outputStartIndex, "Output should start after confidence completes")
  assert(outputCompleteIndex < pipelineCompleteIndex, "PIPELINE_COMPLETE should be the final pipeline event")

  const stageErrors = events.filter((event) => event.type === "STAGE_ERROR")
  const pipelineErrors = events.filter((event) => event.type === "PIPELINE_ERROR")
  assert(stageErrors.length === 0, `Expected no STAGE_ERROR events, saw ${stageErrors.length}`)
  assert(pipelineErrors.length === 0, `Expected no PIPELINE_ERROR events, saw ${pipelineErrors.length}`)
}

function assertStageCoverage(sources) {
  const stages = new Set(sources.map((source) => source.stage))

  assert(stages.has("discovery"), "Expected discovery sources in PIPELINE_COMPLETE payload")
  assert(stages.has("skills-diff"), "Expected skills-diff sources in PIPELINE_COMPLETE payload")
  assert(stages.has("resolution"), "Expected resolution sources in PIPELINE_COMPLETE payload")
}

function assertResolutionOutput(events) {
  const resolutionComplete = getStageEvent(events, "STAGE_COMPLETE", "resolution")

  assert(resolutionComplete, "Expected resolution STAGE_COMPLETE event")
  assert(Array.isArray(resolutionComplete.output?.changes), "Resolution output missing changes array")
  assert(
    typeof resolutionComplete.output?.summary?.duplicates_collapsed === "number",
    "Resolution output missing duplicate-collapse summary"
  )
  assert(
    typeof resolutionComplete.output?.summary?.normalized_change_count === "number",
    "Resolution output missing normalized_change_count"
  )

  return resolutionComplete
}

function summarizeCase(mode, events) {
  assertSseOrder(events)

  const pipelineComplete = getPipelineComplete(events)
  assert(pipelineComplete, "Expected PIPELINE_COMPLETE event")

  const resolutionComplete = assertResolutionOutput(events)
  const findings = Array.isArray(pipelineComplete.findings) ? pipelineComplete.findings : []
  const sources = Array.isArray(pipelineComplete.sources) ? pipelineComplete.sources : []
  const cachedSources = sources.filter((source) => source.status === "cached")
  const unavailableSources = sources.filter((source) => source.status === "unavailable")
  const liveSources = sources.filter((source) => source.status === "live")

  assert(findings.length > 0, "Expected at least one finding in the golden path")
  assert(sources.length > 0, "Expected source metadata in PIPELINE_COMPLETE payload")
  assertStageCoverage(sources)
  assert(
    cachedSources.length + unavailableSources.length + liveSources.length === sources.length,
    "Source status accounting does not add up"
  )

  if (mode === "fallback") {
    for (const stage of ["discovery", "skills-diff", "resolution"]) {
      const event = getStageEvent(events, "STAGE_COMPLETE", stage)
      assert(event?.fallback === true, `${stage} should be marked as fallback in forced fallback mode`)
      assert(
        event?.fallbackReasons?.includes("forced_fallback"),
        `${stage} should report forced_fallback in forced fallback mode`
      )
    }

    assert(liveSources.length === 0, "Forced fallback run should not include live sources")
    assert(cachedSources.length === sources.length, "Forced fallback run should mark every source as cached")
    assert(
      cachedSources.every((source) => source.fallback_reason === "forced_fallback"),
      "Forced fallback run should mark every cached source with forced_fallback"
    )
  }

  if (mode === "live") {
    assert(liveSources.length > 0, "Live verification should surface at least one live source")
    assert(
      [...cachedSources, ...unavailableSources].every(
        (source) => typeof source.fallback_reason === "string" && source.fallback_reason.length > 0
      ),
      "Every non-live source in live mode should include fallback_reason metadata"
    )
  }

  return {
    mode,
    findings: findings.length,
    sources: sources.length,
    liveSources: liveSources.length,
    cachedSources: cachedSources.length,
    unavailableSources: unavailableSources.length,
    duplicatesCollapsed: resolutionComplete.output.summary.duplicates_collapsed,
    normalizedChanges: resolutionComplete.output.summary.normalized_change_count,
  }
}

async function runCase(mode, configContent) {
  const response = await fetch(`${baseUrl}/api/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": mode === "fallback" ? "198.51.100.10" : "198.51.100.11",
    },
    body: JSON.stringify({
      configContent,
      configFilename: "sample-config.txt",
      useFallback: mode === "fallback",
    }),
  })

  assert(response.ok, `${mode} pipeline request failed with status ${response.status}`)

  const events = await collectSseEvents(response)
  return summarizeCase(mode, events)
}

async function run() {
  const runLive = shouldRunLive()
  const runFallback = shouldRunFallback()

  assert(runLive || runFallback, `Unsupported VERIFY_MODE: ${requestedMode}`)

  if (requestedMode === "live") {
    assert(hasLiveCredentials(), "VERIFY_MODE=live requires OPENAI_API_KEY and TINYFISH_API_KEY")
  }

  const configContent = await readFile(new URL("../src/fixtures/sample-config.txt", import.meta.url), "utf8")
  const server = spawn(
    "npm",
    ["run", "start", "--", "--hostname", host, "--port", String(port)],
    {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    }
  )

  let serverOutput = ""
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString()
  })
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString()
  })

  try {
    await waitForServer(baseUrl)

    const results = []

    if (runFallback) {
      results.push(await runCase("fallback", configContent))
    }

    if (runLive) {
      if (hasLiveCredentials()) {
        results.push(await runCase("live", configContent))
      } else if (requestedMode === "all") {
        results.push({
          mode: "live",
          skipped: true,
          reason: "OPENAI_API_KEY and/or TINYFISH_API_KEY not set",
        })
      }
    }

    console.log(JSON.stringify({ baseUrl, results }, null, 2))
  } finally {
    server.kill("SIGTERM")
    await delay(1_000)

    if (!server.killed) {
      server.kill("SIGKILL")
    }

    if (serverOutput.trim()) {
      console.error(serverOutput.split("\n").slice(-20).join("\n"))
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
