"use client"

import { useState, useCallback } from "react"
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
    outputLabel: "Drift findings and recommended updates",
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
  idle: "border-neutral-200 bg-neutral-100 text-neutral-500",
  running: "border-blue-200 bg-blue-50 text-blue-700",
  complete: "border-emerald-200 bg-emerald-50 text-emerald-700",
  error: "border-red-200 bg-red-50 text-red-700",
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
  const [copied, setCopied] = useState(false)

  const copyOutput = useCallback((json: string) => {
    void navigator.clipboard.writeText(json).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [])

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
    <div className="space-y-4 text-sm">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-neutral-900">{stage.label}</h2>
        <StatusBadge status={stage.status} />
        {stage.status === "running" && <RunningSpinner />}
        {stage.usedFallback && (
          <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            degraded
          </span>
        )}
      </div>

      {/* ── What it does ── */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
          What this stage does
        </p>
        <p className="text-xs leading-relaxed text-neutral-600">{copy.purpose}</p>
      </div>

      {/* ── I/O ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Input
          </p>
          <p className="text-xs leading-relaxed text-neutral-600">{copy.inputLabel}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Output
          </p>
          <p className="text-xs leading-relaxed text-neutral-600">{copy.outputLabel}</p>
        </div>
      </div>

      {/* ── Performance ── */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
          Performance
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
          <dt className="text-neutral-400">Started</dt>
          <dd className="text-neutral-700">{formatTimestamp(stage.startedAt)}</dd>
          <dt className="text-neutral-400">Completed</dt>
          <dd className="text-neutral-700">{formatTimestamp(stage.completedAt)}</dd>
          {duration && (
            <>
              <dt className="text-neutral-400">Duration</dt>
              <dd className="text-emerald-700 font-semibold">{duration}</dd>
            </>
          )}
        </dl>
      </div>

      {/* ── Data quality ── */}
      {summaryLines.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Data quality
          </p>
          <div className="space-y-1 text-xs text-neutral-600">
            {summaryLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── Feedback loop ── */}
      {feedbackSummary && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-sky-600">
              Feedback Loop
            </p>
            <span className="rounded border border-sky-200 bg-sky-100 px-2 py-0.5 text-[11px] text-sky-700">
              {feedbackLoopStatusLabel(feedbackSummary.status)}
            </span>
          </div>
          <div className="space-y-1 text-xs text-sky-800">
            {feedbackSummary.details.map((detail) => (
              <p key={detail}>{detail}</p>
            ))}
          </div>
        </div>
      )}

      {/* ── Degradation ── */}
      {stage.usedFallback && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-amber-600">
            Degradation
          </p>
          <div className="space-y-2 text-xs text-amber-800">
            <p>This stage completed with non-live source data or excluded sources.</p>
            {fallbackReasons.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {fallbackReasons.map((reason) => (
                  <span
                    key={reason}
                    className="rounded border border-amber-200 bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700"
                  >
                    {fallbackReasonLabel(reason)}
                  </span>
                ))}
              </div>
            )}
            {degradedSources.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-white/60 px-3 py-2 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-amber-500">Affected sources</p>
                {degradedSources.map((source, index) => (
                  <div key={`${source.url}-${index}`} className="space-y-0.5">
                    <p className="text-neutral-800 font-medium">{source.label}</p>
                    <p className="text-neutral-500">
                      {source.fallback_reason ? fallbackReasonLabel(source.fallback_reason) : "cached fallback"}
                    </p>
                    {source.fallback_detail && (
                      <p className="whitespace-pre-wrap break-words text-neutral-400">
                        {source.fallback_detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {stage.status === "error" && stage.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-red-600">
            Error
          </p>
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-red-700">
            {stage.error}
          </p>
        </div>
      )}

      {/* ── Raw output ── */}
      {hasOutput && outputJson && (
        <div className="rounded-xl border border-neutral-200 overflow-hidden">
          <div className="flex items-center border-b border-neutral-200 bg-neutral-50">
            <button
              type="button"
              onClick={() => setIsOutputExpanded((v) => !v)}
              className="flex flex-1 items-center justify-between px-4 py-2.5 text-[10px] font-semibold uppercase tracking-widest text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 cursor-pointer transition-colors duration-150 focus:outline-none"
              aria-expanded={isOutputExpanded}
            >
              <span>Raw output</span>
              <span className="flex items-center gap-1.5">
                <span className="normal-case tracking-normal font-normal text-neutral-400">
                  {outputJson.length > 1024
                    ? `${(outputJson.length / 1024).toFixed(1)} KB`
                    : `${outputJson.length} B`}
                </span>
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
            <button
              type="button"
              onClick={() => copyOutput(outputJson)}
              className="px-3 py-2.5 text-[10px] text-neutral-400 hover:text-neutral-700 transition-colors duration-150 cursor-pointer border-l border-neutral-200 hover:bg-neutral-100 focus:outline-none shrink-0"
              aria-label="Copy raw output"
              title="Copy to clipboard"
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
          </div>
          {isOutputExpanded && (
            <div className="overflow-x-auto bg-neutral-950">
              <pre className="p-4 text-xs leading-relaxed text-neutral-300 whitespace-pre">
                {outputJson}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ── */}
      {!hasOutput && stage.status !== "error" && (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-8">
          <p className="text-xs text-neutral-400">
            {stage.status === "idle" ? "Stage has not run yet." : "Waiting for output…"}
          </p>
        </div>
      )}
    </div>
  )
}
