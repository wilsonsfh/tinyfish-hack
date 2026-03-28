"use client"

import { useState, useCallback } from "react"
import type { Finding, ConfidenceTier, ImpactType } from "@/lib/types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DiffViewProps {
  configContent: string
  configFilename: string
  findings: Finding[]
}

interface ParsedLine {
  lineNumber: number
  content: string
  type: "unchanged" | "removed" | "added" | "context"
  finding?: Finding
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildLineMap(findings: Finding[]): Map<number, Finding> {
  const map = new Map<number, Finding>()
  for (const f of findings) {
    if (f.affected_line != null) {
      map.set(f.affected_line, f)
    }
  }
  return map
}

function parseOriginalLines(content: string, lineMap: Map<number, Finding>): ParsedLine[] {
  return content.split("\n").map((raw, idx) => {
    const lineNumber = idx + 1
    const finding = lineMap.get(lineNumber)
    return {
      lineNumber,
      content: raw,
      type: finding ? "removed" : "unchanged",
      finding,
    }
  })
}

function buildSuggestedLines(originalLines: ParsedLine[]): ParsedLine[] {
  const result: ParsedLine[] = []
  let suggestedLineNumber = 1

  for (const line of originalLines) {
    if (line.type === "removed" && line.finding) {
      // Show the suggested change as an added line
      result.push({
        lineNumber: suggestedLineNumber++,
        content: line.finding.suggested_change,
        type: "added",
        finding: line.finding,
      })
    } else {
      result.push({
        lineNumber: suggestedLineNumber++,
        content: line.content,
        type: "unchanged",
      })
    }
  }

  return result
}

function buildSuggestedContent(lines: ParsedLine[]): string {
  return lines.map((line) => line.content).join("\n")
}

function buildSuggestedFilename(filename: string): string {
  if (!filename) return "suggested-config.txt"

  const lastDot = filename.lastIndexOf(".")
  if (lastDot === -1) return `${filename}.suggested`

  return `${filename.slice(0, lastDot)}.suggested${filename.slice(lastDot)}`
}

// ---------------------------------------------------------------------------
// Confidence badge config
// ---------------------------------------------------------------------------

const BADGE_CONFIG: Record<
  ConfidenceTier,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  HIGH: {
    label: "HIGH",
    bg: "bg-emerald-500/15",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    dot: "bg-emerald-400",
  },
  MEDIUM: {
    label: "MED",
    bg: "bg-amber-500/15",
    text: "text-amber-400",
    border: "border-amber-500/40",
    dot: "bg-amber-400",
  },
  LOW: {
    label: "LOW",
    bg: "bg-slate-500/15",
    text: "text-slate-400",
    border: "border-slate-500/40",
    dot: "bg-slate-400",
  },
  CONFLICT: {
    label: "CONFLICT",
    bg: "bg-rose-500/10",
    text: "text-rose-400",
    border: "border-rose-500/60",
    dot: "bg-rose-400",
  },
}

const IMPACT_COLORS: Record<ImpactType, string> = {
  breaking: "text-rose-400",
  deprecation: "text-amber-400",
  additive: "text-emerald-400",
  best_practice: "text-sky-400",
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConfidenceBadge({ tier }: { tier: ConfidenceTier }) {
  const cfg = BADGE_CONFIG[tier]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function ToastNotification({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 shadow-2xl shadow-black/40 animate-in slide-in-from-bottom-2 duration-200">
      <svg className="h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
      </svg>
      <span className="text-sm text-slate-200">{message}</span>
      <button
        onClick={onClose}
        className="ml-2 text-slate-500 transition-colors duration-150 hover:text-slate-300 cursor-pointer"
        aria-label="Dismiss toast"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function FindingTooltip({ finding, onApply }: { finding: Finding; onApply: (f: Finding) => void }) {
  const impactColor = IMPACT_COLORS[finding.impact]

  return (
    <div
      className="absolute left-full top-0 z-40 ml-3 w-80 rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl shadow-black/60"
      role="tooltip"
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-semibold text-slate-100 leading-snug break-all">
          {finding.entity}
        </span>
        <ConfidenceBadge tier={finding.tier} />
      </div>

      {/* Claim */}
      <p className="mb-2 text-xs text-slate-300 leading-relaxed">{finding.claim}</p>

      {/* Impact badge */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">Impact</span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${impactColor}`}>
          {finding.impact.replace("_", " ")}
        </span>
      </div>

      {/* Justification */}
      <div className="mb-3 rounded border border-slate-700/60 bg-slate-800/60 px-3 py-2">
        <p className="text-[11px] leading-relaxed text-slate-400 italic">
          &ldquo;{finding.justification}&rdquo;
        </p>
      </div>

      {/* Source */}
      <div className="mb-3 flex items-center gap-1.5 truncate">
        <svg className="h-3 w-3 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 015.656 0l4-4a4 4 0 01-5.656-5.656l-1.1 1.1" />
        </svg>
        <a
          href={finding.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate text-[10px] text-sky-400 hover:text-sky-300 transition-colors duration-150 cursor-pointer"
        >
          {finding.source_url}
        </a>
      </div>

      {/* Apply button for HIGH only */}
      {finding.tier === "HIGH" && (
        <button
          onClick={() => onApply(finding)}
          className="mt-1 w-full rounded bg-emerald-600/20 border border-emerald-500/40 px-3 py-1.5 text-[11px] font-semibold text-emerald-400 transition-all duration-150 hover:bg-emerald-600/30 hover:border-emerald-400/60 cursor-pointer"
        >
          Mock Apply Fix
        </button>
      )}

      {/* Arrow pointer */}
      <div className="absolute -left-1.5 top-4 h-3 w-3 rotate-45 border-l border-b border-slate-700 bg-slate-900" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Line row components
// ---------------------------------------------------------------------------

function LineRow({
  line,
  onApply,
}: {
  line: ParsedLine
  onApply: (f: Finding) => void
}) {
  const [tooltipOpen, setTooltipOpen] = useState(false)

  const bgClass =
    line.type === "removed"
      ? "bg-rose-500/8 border-l-2 border-rose-500/50"
      : line.type === "added"
      ? "bg-emerald-500/8 border-l-2 border-emerald-500/50"
      : "border-l-2 border-transparent"

  const prefixChar =
    line.type === "removed" ? "-" : line.type === "added" ? "+" : " "

  const prefixColor =
    line.type === "removed"
      ? "text-rose-400"
      : line.type === "added"
      ? "text-emerald-400"
      : "text-slate-600"

  const hasFinding = !!line.finding

  return (
    <div
      className={`group relative flex items-start gap-0 ${bgClass} ${hasFinding ? "cursor-pointer" : ""}`}
      onMouseEnter={() => hasFinding && setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onClick={() => hasFinding && setTooltipOpen((v) => !v)}
      role={hasFinding ? "button" : undefined}
      aria-label={hasFinding ? `View finding for line ${line.lineNumber}` : undefined}
      tabIndex={hasFinding ? 0 : undefined}
      onKeyDown={(e) => {
        if (hasFinding && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          setTooltipOpen((v) => !v)
        }
      }}
    >
      {/* Line number gutter */}
      <span className="select-none w-10 shrink-0 py-0.5 pr-3 text-right font-mono text-[11px] text-slate-600 tabular-nums">
        {line.lineNumber}
      </span>

      {/* Diff prefix */}
      <span className={`select-none w-4 shrink-0 py-0.5 font-mono text-[11px] ${prefixColor}`}>
        {prefixChar}
      </span>

      {/* Content */}
      <span
        className={`flex-1 py-0.5 pr-2 font-mono text-[12px] leading-5 whitespace-pre-wrap break-all ${
          line.type === "removed"
            ? "text-rose-200/80"
            : line.type === "added"
            ? "text-emerald-200/90"
            : "text-slate-300"
        }`}
      >
        {line.content || " "}
      </span>

      {/* Confidence badge (right gutter) */}
      {hasFinding && line.finding && (
        <span className="shrink-0 py-0.5 pr-2 flex items-center">
          <ConfidenceBadge tier={line.finding.tier} />
        </span>
      )}

      {/* Tooltip */}
      {tooltipOpen && hasFinding && line.finding && (
        <FindingTooltip finding={line.finding} onApply={onApply} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pane header
// ---------------------------------------------------------------------------

function PaneHeader({
  title,
  subtitle,
  icon,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-700/60 bg-slate-800/60 px-4 py-2.5">
      <span className="text-slate-400">{icon}</span>
      <div className="min-w-0">
        <p className="font-mono text-xs font-semibold text-slate-200 truncate">{title}</p>
        <p className="font-mono text-[10px] text-slate-500 truncate">{subtitle}</p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Findings summary bar
// ---------------------------------------------------------------------------

function FindingsSummaryBar({ findings }: { findings: Finding[] }) {
  const counts = findings.reduce(
    (acc, f) => {
      acc[f.tier] = (acc[f.tier] ?? 0) + 1
      return acc
    },
    {} as Record<ConfidenceTier, number>
  )

  const tiers: ConfidenceTier[] = ["HIGH", "MEDIUM", "LOW", "CONFLICT"]

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-700/60 bg-slate-800/40 px-4 py-2">
      <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
        Findings
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {tiers.map((tier) => {
          const count = counts[tier]
          if (!count) return null
          const cfg = BADGE_CONFIG[tier]
          return (
            <span
              key={tier}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
              {count} {tier}
            </span>
          )
        })}
      </div>
      <span className="ml-auto font-mono text-[10px] text-slate-600">
        {findings.length} total
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mobile toggle
// ---------------------------------------------------------------------------

type PaneView = "original" | "suggested"

function MobileToggle({
  active,
  onChange,
}: {
  active: PaneView
  onChange: (v: PaneView) => void
}) {
  return (
    <div className="flex md:hidden border-b border-slate-700/60 bg-slate-800/60">
      {(["original", "suggested"] as PaneView[]).map((view) => (
        <button
          key={view}
          onClick={() => onChange(view)}
          className={`flex-1 py-2 font-mono text-xs font-semibold uppercase tracking-wider transition-colors duration-150 cursor-pointer ${
            active === view
              ? "border-b-2 border-sky-500 text-sky-400 bg-sky-500/5"
              : "text-slate-500 hover:text-slate-400"
          }`}
        >
          {view === "original" ? "Original" : "Suggested"}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
      <svg
        className="mb-4 h-10 w-10 text-slate-700"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M4 5l16 14M5 5l14 14" />
      </svg>
      <p className="font-mono text-sm text-slate-500">No config content to display</p>
      <p className="mt-1 font-mono text-xs text-slate-600">Upload a config file to see the diff</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DiffView({ configContent, configFilename, findings }: DiffViewProps) {
  const [mobileView, setMobileView] = useState<PaneView>("original")
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3500)
  }, [])

  const handleApply = useCallback(() => {
    showToast("Mock only. DriftCheck does not rewrite your file automatically.")
  }, [showToast])

  if (!configContent) {
    return (
      <section className="rounded-xl border border-slate-700/60 bg-slate-900 overflow-hidden">
        <EmptyState />
      </section>
    )
  }

  const lineMap = buildLineMap(findings)
  const originalLines = parseOriginalLines(configContent, lineMap)
  const suggestedLines = buildSuggestedLines(originalLines)
  const suggestedContent = buildSuggestedContent(suggestedLines)

  const highFindings = findings.filter((f) => f.tier === "HIGH")

  function handleDownload() {
    const blob = new Blob([suggestedContent], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = buildSuggestedFilename(configFilename)
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section
      className="rounded-xl border border-slate-700/60 bg-slate-900 overflow-hidden"
      aria-label="Config diff viewer"
    >
      {/* Summary bar */}
      <FindingsSummaryBar findings={findings} />

      {/* Mobile toggle */}
      <MobileToggle active={mobileView} onChange={setMobileView} />

      {/* Quick-apply toolbar (HIGH findings only) */}
      {highFindings.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-700/60 bg-emerald-500/5 px-4 py-2">
          <svg className="h-3.5 w-3.5 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-mono text-[11px] text-emerald-400 font-semibold">
            {highFindings.length} HIGH-confidence {highFindings.length === 1 ? "fix" : "fixes"} available
          </span>
          <span className="text-[10px] text-slate-500">
            review and download only, no automatic file mutation
          </span>
          <button
            onClick={handleDownload}
            className="rounded border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-sky-300 transition-all duration-150 hover:bg-sky-500/20 hover:border-sky-400/60 cursor-pointer"
          >
            Download Suggested File
          </button>
          <button
            onClick={() => showToast("Mock only. Review the suggested pane or download the suggested file.")}
            className="ml-auto flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-600/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-emerald-400 transition-all duration-150 hover:bg-emerald-600/25 hover:border-emerald-400/60 cursor-pointer"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Mock Apply All HIGH
          </button>
        </div>
      )}

      {/* Split-pane grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-700/60">

        {/* LEFT PANE — Original */}
        <div
          className={`flex flex-col overflow-hidden ${
            mobileView === "suggested" ? "hidden md:flex" : "flex"
          }`}
        >
          <PaneHeader
            title="Original Config"
            subtitle={findings.length > 0 ? `${findings.filter(f => f.affected_line != null).length} drift lines detected` : "No drift detected"}
            icon={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            }
          />
          <div className="overflow-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            <div className="min-w-0 py-1">
              {originalLines.map((line) => (
                <LineRow key={`orig-${line.lineNumber}`} line={line} onApply={handleApply} />
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT PANE — Suggested */}
        <div
          className={`flex flex-col overflow-hidden ${
            mobileView === "original" ? "hidden md:flex" : "flex"
          }`}
        >
          <PaneHeader
            title="Suggested Changes"
            subtitle="Manual review output. Download to inspect as a candidate updated file."
            icon={
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            }
          />
          <div className="overflow-auto max-h-[60vh] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            <div className="min-w-0 py-1">
              {suggestedLines.map((line) => (
                <LineRow key={`sugg-${line.lineNumber}`} line={line} onApply={handleApply} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 border-t border-slate-700/60 bg-slate-800/30 px-4 py-2">
        <LegendItem color="bg-rose-500/30 border-rose-500/50" label="Removed / outdated" />
        <LegendItem color="bg-emerald-500/30 border-emerald-500/50" label="Added / suggested" />
        <span className="text-[10px] text-slate-600 ml-auto font-mono">
          Click highlighted lines to inspect findings
        </span>
      </div>

      {/* Toast */}
      {toast && (
        <ToastNotification message={toast} onClose={() => setToast(null)} />
      )}
    </section>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-3 w-5 rounded-sm border ${color}`} />
      <span className="font-mono text-[10px] text-slate-500">{label}</span>
    </div>
  )
}
