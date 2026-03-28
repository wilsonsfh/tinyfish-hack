"use client"

import { useState } from "react"
import { feedbackLoopStatusLabel } from "@/lib/feedback-loops"
import { fallbackReasonLabel } from "@/lib/fallbacks"
import type { Finding, StageId, StageState } from "@/lib/types"

interface StageDetailProps {
  stage: StageState
}

const STAGE_COPY: Record<
  StageId,
  {
    purpose: string
    inputLabel: string
    outputLabel: string
  }
> = {
  discovery: {
    purpose: "Builds the candidate subject set. In live web mode this starts from TinyFish noisy discovery; in repo mode it starts from deterministic repo inventory.",
    inputLabel: "HN scrape or repo inventory",
    outputLabel: "Candidate entities and run scope",
  },
  "skills-diff": {
    purpose: "Adds supplemental git evidence from tracked or repo-local submodules. This is supportive context, not the primary truth source.",
    inputLabel: "Git diffs from curated skills repos or repo-local submodules",
    outputLabel: "Supplemental entities and repo drift evidence",
  },
  resolution: {
    purpose: "Uses TinyFish to inspect authoritative sources and OpenAI to normalize them into one merged change set.",
    inputLabel: "Candidate entities from discovery plus repo/git support",
    outputLabel: "Authoritative changes plus normalization summary",
  },
  diff: {
    purpose: "Uses OpenAI to compare your local config or repo inventory against the authoritative change set.",
    inputLabel: "Local state and normalized authoritative changes",
    outputLabel: "Drift findings tied to lines and suggested edits",
  },
  confidence: {
    purpose: "Enriches findings with provenance and validates the trust signal shown in the UI.",
    inputLabel: "Raw findings plus source evidence",
    outputLabel: "Findings with provenance and final trust tiers",
  },
  output: {
    purpose: "Packages the run into the final UI payload.",
    inputLabel: "Final findings and source metadata",
    outputLabel: "Rendered findings, diff data, and source traceability",
  },
}

const STATUS_STYLES: Record<StageState["status"], string> = {
  idle: "border-slate-600 bg-slate-800 text-slate-400",
  running: "border-blue-600 bg-blue-900/40 text-blue-300",
  complete: "border-green-700 bg-green-900/40 text-green-300",
  error: "border-red-700 bg-red-900/40 text-red-300",
}

function formatTimestamp(iso?: string): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  } catch {
    return iso
  }
}

function durationMs(start?: string, end?: string): string | null {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (isNaN(ms)) return null
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function StatusBadge({ status }: { status: StageState["status"] }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  )
}

function RunningSpinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-blue-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

function summarizeOutput(stage: StageState): string[] {
  const output = stage.output

  if (!output || typeof output !== "object") {
    return []
  }

  if (stage.id === "resolution") {
    const resolution = output as {
      changes?: unknown[]
      summary?: {
        raw_change_count?: number
        normalized_change_count?: number
        duplicates_collapsed?: number
      }
    }

    return [
      Array.isArray(resolution.changes)
        ? `${resolution.changes.length} normalized authoritative changes returned`
        : "No authoritative changes returned",
      resolution.summary?.raw_change_count !== undefined
        ? `${resolution.summary.raw_change_count} raw changes inspected`
        : "Raw change count unavailable",
      resolution.summary?.duplicates_collapsed !== undefined
        ? `${resolution.summary.duplicates_collapsed} duplicate changes collapsed`
        : "Duplicate collapse summary unavailable",
    ]
  }

  if (stage.id === "diff" || stage.id === "confidence") {
    const findings = Array.isArray(output) ? (output as Finding[]) : []
    const highCount = findings.filter((finding) => finding.tier === "HIGH").length
    return [
      `${findings.length} findings produced`,
      `${highCount} HIGH-confidence findings`,
    ]
  }

  if (stage.id === "output") {
    const finalOutput = output as { findings?: unknown[]; sources?: unknown[] }
    return [
      Array.isArray(finalOutput.findings)
        ? `${finalOutput.findings.length} findings shipped to the UI`
        : "Findings payload unavailable",
      Array.isArray(finalOutput.sources)
        ? `${finalOutput.sources.length} sources shipped to the UI`
        : "Source payload unavailable",
    ]
  }

  if (Array.isArray(output)) {
    return [`${output.length} records emitted by this stage`]
  }

  return ["Structured output available below"]
}

export default function StageDetail({ stage }: StageDetailProps) {
  const [isOutputExpanded, setIsOutputExpanded] = useState(true)

  const duration = durationMs(stage.startedAt, stage.completedAt)
  const hasOutput = stage.output !== undefined && stage.output !== null
  const outputJson = hasOutput
    ? JSON.stringify(stage.output, null, 2)
    : null
  const degradedSources = stage.degradedSources ?? []
  const fallbackReasons = stage.fallbackReasons ?? []
  const feedbackSummary = stage.feedbackSummary
  const copy = STAGE_COPY[stage.id]
  const summaryLines = summarizeOutput(stage)

  return (
    <div className="space-y-4 font-mono text-sm">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-slate-100">{stage.label}</h2>

        <StatusBadge status={stage.status} />

        {stage.status === "running" && <RunningSpinner />}

        {stage.usedFallback && (
          <span className="rounded border border-yellow-700 bg-yellow-900/30 px-2 py-0.5 text-xs font-medium text-yellow-300">
            [degraded]
          </span>
        )}
      </div>

      {stage.usedFallback && (
        <div className="rounded-lg border border-amber-700 bg-amber-950/20 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-400">
            Degradation
          </p>

          <div className="space-y-2 text-xs text-amber-100/90">
            <p>This stage completed with non-live source data or excluded sources.</p>

            {fallbackReasons.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fallbackReasons.map((reason) => (
                  <span
                    key={reason}
                    className="rounded border border-amber-700 bg-amber-900/40 px-2 py-0.5 text-[11px] text-amber-200"
                  >
                    {fallbackReasonLabel(reason)}
                  </span>
                ))}
              </div>
            )}

            {degradedSources.length > 0 && (
              <div className="rounded border border-amber-900/70 bg-slate-950/40 px-3 py-2">
                <p className="mb-2 text-[11px] uppercase tracking-wider text-amber-300/80">
                  Affected sources
                </p>
                <div className="space-y-2">
                  {degradedSources.map((source, index) => (
                    <div key={`${source.url}-${index}`} className="space-y-1">
                      <p className="text-slate-100">{source.label}</p>
                      <p className="text-slate-400">
                        {source.fallback_reason ? fallbackReasonLabel(source.fallback_reason) : "cached fallback"}
                      </p>
                      {source.fallback_detail && (
                        <p className="whitespace-pre-wrap break-words text-slate-500">
                          {source.fallback_detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stage ID pill */}
      <p className="text-xs text-slate-500">
        id:{" "}
        <span className="font-semibold text-slate-400">{stage.id}</span>
      </p>

      {feedbackSummary && (
        <div className="rounded-lg border border-sky-800/70 bg-sky-950/20 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-300">
              Feedback Loop
            </p>
            <span className="rounded border border-sky-700/70 bg-sky-900/30 px-2 py-0.5 text-[11px] text-sky-200">
              {feedbackLoopStatusLabel(feedbackSummary.status)}
            </span>
          </div>
          <div className="mt-2 space-y-1 text-xs text-sky-100/85">
            {feedbackSummary.details.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            What This Stage Does
          </p>
          <p className="text-xs leading-relaxed text-slate-300">{copy.purpose}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Expected Input
          </p>
          <p className="text-xs leading-relaxed text-slate-300">{copy.inputLabel}</p>
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Expected Output
          </p>
          <p className="text-xs leading-relaxed text-slate-300">{copy.outputLabel}</p>
        </div>
      </div>

      {/* Timing block */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Timing
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
          <dt className="text-slate-500">Started</dt>
          <dd className="text-slate-300">{formatTimestamp(stage.startedAt)}</dd>

          <dt className="text-slate-500">Completed</dt>
          <dd className="text-slate-300">{formatTimestamp(stage.completedAt)}</dd>

          {duration && (
            <>
              <dt className="text-slate-500">Duration</dt>
              <dd className="text-green-400 font-semibold">{duration}</dd>
            </>
          )}
        </dl>
      </div>

      {summaryLines.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Run Summary
          </p>
          <div className="space-y-1 text-xs text-slate-300">
            {summaryLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* Error block */}
      {stage.status === "error" && stage.error && (
        <div className="rounded-lg border border-red-700 bg-red-900/20 px-4 py-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-red-500">
            Error
          </p>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-red-300">
            {stage.error}
          </p>
        </div>
      )}

      {/* Output block */}
      {hasOutput && outputJson && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 overflow-hidden">
          {/* Collapsible header */}
          <button
            type="button"
            onClick={() => setIsOutputExpanded((v) => !v)}
            className="
              flex w-full items-center justify-between px-4 py-2.5
              border-b border-slate-700 bg-slate-800/80
              text-xs font-semibold uppercase tracking-wider text-slate-400
              hover:bg-slate-800 hover:text-slate-200
              cursor-pointer transition-colors duration-150
              focus:outline-none focus:ring-1 focus:ring-inset focus:ring-green-500/40
            "
            aria-expanded={isOutputExpanded}
          >
            <span>Output</span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-500 normal-case tracking-normal font-normal">
                {outputJson.length > 1024
                  ? `${(outputJson.length / 1024).toFixed(1)} KB`
                  : `${outputJson.length} B`}
              </span>
              {/* Chevron */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-3.5 w-3.5 transition-transform duration-200 ${isOutputExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </span>
          </button>

          {/* JSON body */}
          {isOutputExpanded && (
            <div className="overflow-x-auto">
              <pre className="p-4 text-xs leading-relaxed text-slate-300 whitespace-pre">
                {outputJson}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Empty state for no output yet */}
      {!hasOutput && stage.status !== "error" && (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-6 py-8">
          <p className="text-xs text-slate-500">
            {stage.status === "idle" ? "Stage has not run yet." : "Waiting for output…"}
          </p>
        </div>
      )}
    </div>
  )
}
