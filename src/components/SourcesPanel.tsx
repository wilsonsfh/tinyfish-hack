"use client"

import { fallbackReasonLabel } from "@/lib/fallbacks"
import type { AuthoritativeChange, Finding, SourceMeta } from "@/lib/types"

interface SourcesPanelProps {
  sources: SourceMeta[]
  findings: Finding[]
  resolutionOutput?: unknown
}

const SOURCE_TYPE_LABELS: Record<SourceMeta["source_type"], string> = {
  tinyfish: "tinyfish",
  git_diff: "git_diff",
  fixture: "fixture",
  repo_inventory: "repo_inventory",
}

const SOURCE_TYPE_COLORS: Record<SourceMeta["source_type"], string> = {
  tinyfish: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  git_diff: "border-violet-400/30 bg-violet-400/10 text-violet-200",
  fixture: "border-white/10 bg-white/[0.04] text-slate-300",
  repo_inventory: "border-sky-400/30 bg-sky-400/10 text-sky-200",
}

function StatusDot({ status }: { status: SourceMeta["status"] }) {
  const styles =
    status === "live"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : status === "cached"
      ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
      : "border-rose-400/30 bg-rose-400/10 text-rose-200"
  const dotColor =
    status === "live" ? "bg-green-400" : status === "cached" ? "bg-yellow-400" : "bg-rose-400"

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium
        ${styles}
      `}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
        aria-hidden="true"
      />
      {status}
    </span>
  )
}

function SourceTypeBadge({ type }: { type: SourceMeta["source_type"] }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${SOURCE_TYPE_COLORS[type]}`}
    >
      {SOURCE_TYPE_LABELS[type]}
    </span>
  )
}

function StageBadge({ stage }: { stage: SourceMeta["stage"] }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs font-medium text-slate-300">
      {stage}
    </span>
  )
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString("en-US", {
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

function safeLower(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase() : ""
}

function getResolutionChanges(output: unknown): AuthoritativeChange[] {
  if (!output || typeof output !== "object") return []

  const maybeChanges = (output as { changes?: unknown }).changes
  return Array.isArray(maybeChanges) ? (maybeChanges as AuthoritativeChange[]) : []
}

function sourceImpactFor(
  source: SourceMeta,
  changes: AuthoritativeChange[],
  findings: Finding[]
): { changeCount: number; findingCount: number } {
  const normalizedUrl = safeLower(source.url)

  const changeCount = changes.filter((change) => {
    if (safeLower(change.source_url) === normalizedUrl) return true
    return (change.supporting_sources ?? []).some(
      (supportingSource) => safeLower(supportingSource.source_url) === normalizedUrl
    )
  }).length

  const findingCount = findings.filter((finding) => {
    if (safeLower(finding.source_url) === normalizedUrl) return true
    return (Array.isArray(finding.provenance) ? finding.provenance : []).some(
      (step) => safeLower(step?.url) === normalizedUrl
    )
  }).length

  return { changeCount, findingCount }
}

export default function SourcesPanel({ sources, findings, resolutionOutput }: SourcesPanelProps) {
  if (sources.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-[24px] border border-dashed border-white/10 bg-[#0a0f16]/80 px-6 py-10">
        <p className="text-sm text-slate-500">No sources scraped yet.</p>
      </div>
    )
  }

  const liveCount = sources.filter((s) => s.status === "live").length
  const cachedCount = sources.filter((s) => s.status === "cached").length
  const unavailableCount = sources.filter((s) => s.status === "unavailable").length
  const resolutionChanges = getResolutionChanges(resolutionOutput)
  const degradedStages = [...new Set(sources
    .filter((source) => source.status !== "live")
    .map((source) => source.stage))]

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="font-semibold text-slate-200">{sources.length} sources</span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
          {liveCount} live
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" aria-hidden="true" />
          {cachedCount} cached
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden="true" />
          {unavailableCount} unavailable
        </span>
        {degradedStages.length > 0 && (
          <span className="text-amber-300">
            degraded: {degradedStages.join(", ")}
          </span>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-[24px] border border-white/10 bg-[#0a0f16]/90">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/8 bg-white/[0.03]">
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400"
              >
                Label
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400"
              >
                URL
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400"
              >
                Stage
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap"
              >
                Scraped at
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400"
              >
                Type
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400"
              >
                Status
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400"
              >
                Impact
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 text-left font-semibold uppercase tracking-wider text-slate-400"
              >
                Fallback
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/6">
            {sources.map((source, idx) => {
              const impact = sourceImpactFor(source, resolutionChanges, findings)

              return (
                <tr
                  key={`${source.url}-${idx}`}
                  className="transition-colors duration-150 hover:bg-white/[0.03]"
                >
                {/* Label */}
                <td className="max-w-[160px] truncate px-4 py-3 font-medium text-slate-200">
                  <span title={source.label}>{source.label}</span>
                </td>

                {/* URL */}
                <td className="max-w-[260px] px-4 py-3">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-blue-400 underline underline-offset-2 hover:text-blue-300 transition-colors duration-150 cursor-pointer"
                    title={source.url}
                  >
                    {source.url}
                  </a>
                </td>

                <td className="px-4 py-3">
                  <StageBadge stage={source.stage} />
                </td>

                {/* Timestamp */}
                <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                  {formatTimestamp(source.scraped_at)}
                </td>

                {/* Type badge */}
                <td className="px-4 py-3">
                  <SourceTypeBadge type={source.source_type} />
                </td>

                {/* Status badge */}
                <td className="px-4 py-3">
                  <StatusDot status={source.status} />
                </td>

                <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                  <div className="space-y-1">
                    <p className="text-slate-200">
                      {impact.changeCount} {impact.changeCount === 1 ? "change" : "changes"}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {impact.findingCount} {impact.findingCount === 1 ? "finding" : "findings"}
                    </p>
                  </div>
                </td>

                <td className="max-w-[280px] px-4 py-3 text-slate-400">
                  {source.status === "live" ? (
                    <span className="text-slate-500">—</span>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-amber-300">
                        {source.fallback_reason ? fallbackReasonLabel(source.fallback_reason) : "cached fallback"}
                      </p>
                      {source.fallback_detail && (
                        <p className="line-clamp-3 break-words text-[11px] text-slate-500">
                          {source.fallback_detail}
                        </p>
                      )}
                    </div>
                  )}
                </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
