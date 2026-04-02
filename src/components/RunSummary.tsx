"use client"

import type { Finding, SourceMeta } from "@/lib/types"

interface RunSummaryProps {
  findings: Finding[]
  sources: SourceMeta[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function impactOrder(impact: string): number {
  return { breaking: 0, deprecation: 1, additive: 2, best_practice: 3 }[impact] ?? 4
}

function tierOrder(tier: string): number {
  return { HIGH: 0, MEDIUM: 1, LOW: 2, CONFLICT: 3 }[tier] ?? 4
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const impactDiff = impactOrder(a.impact) - impactOrder(b.impact)
    if (impactDiff !== 0) return impactDiff
    return tierOrder(a.tier) - tierOrder(b.tier)
  })
}

function groupByImpact(findings: Finding[]): Map<string, Finding[]> {
  const groups = new Map<string, Finding[]>()
  for (const f of sortFindings(findings)) {
    const key = f.impact ?? "best_practice"
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(f)
  }
  return groups
}

function headlineSentence(findings: Finding[]): string {
  if (findings.length === 0) return "No findings returned in this run."
  const breaking = findings.filter((f) => f.impact === "breaking").length
  const deprecations = findings.filter((f) => f.impact === "deprecation").length
  const high = findings.filter((f) => f.tier === "HIGH").length

  if (breaking > 0) {
    return `${breaking} breaking ${breaking === 1 ? "change" : "changes"} found — immediate attention needed.`
  }
  if (deprecations > 0) {
    return `${deprecations} ${deprecations === 1 ? "deprecation" : "deprecations"} found — plan to update soon.`
  }
  if (high > 0) {
    return `${high} high-confidence ${high === 1 ? "finding" : "findings"} returned — review recommended.`
  }
  return `${findings.length} ${findings.length === 1 ? "finding" : "findings"} returned — no breaking changes.`
}

function nextStepBlurb(findings: Finding[]): string | null {
  const breaking = findings.filter((f) => f.impact === "breaking")
  if (breaking.length > 0) {
    return `Review ${breaking.map((f) => f.entity).join(", ")} — ${breaking.length === 1 ? "this change is" : "these changes are"} marked breaking and should be addressed before your next deploy.`
  }
  const hasPatch = findings.some((f) => f.replacement_text && f.affected_line != null)
  if (hasPatch) {
    return "Open the Diff tab to download the suggested file with HIGH-confidence patches applied."
  }
  const hasHigh = findings.some((f) => f.tier === "HIGH")
  if (hasHigh) {
    return "Review the HIGH-confidence findings below — these came from official changelogs and are the most reliable signals."
  }
  return null
}

// ---------------------------------------------------------------------------
// Impact group config
// ---------------------------------------------------------------------------

const IMPACT_CONFIG: Record<
  string,
  { label: string; dot: string; rowBorder: string; badge: string }
> = {
  breaking: {
    label: "Breaking changes",
    dot: "bg-red-500",
    rowBorder: "border-red-100",
    badge: "bg-red-50 text-red-700 border-red-200",
  },
  deprecation: {
    label: "Deprecations",
    dot: "bg-orange-400",
    rowBorder: "border-orange-100",
    badge: "bg-orange-50 text-orange-700 border-orange-200",
  },
  additive: {
    label: "New additions",
    dot: "bg-blue-400",
    rowBorder: "border-blue-100",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
  },
  best_practice: {
    label: "Best practice updates",
    dot: "bg-purple-400",
    rowBorder: "border-purple-100",
    badge: "bg-purple-50 text-purple-700 border-purple-200",
  },
}

const TIER_COLORS: Record<string, string> = {
  HIGH: "text-emerald-700 bg-emerald-50 border-emerald-200",
  MEDIUM: "text-amber-700 bg-amber-50 border-amber-200",
  LOW: "text-neutral-600 bg-neutral-100 border-neutral-200",
  CONFLICT: "text-red-700 bg-red-50 border-red-200",
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ImpactGroup({
  impact,
  findings,
}: {
  impact: string
  findings: Finding[]
}) {
  const cfg = IMPACT_CONFIG[impact] ?? IMPACT_CONFIG.best_practice

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
        <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
          {cfg.label} ({findings.length})
        </span>
      </div>
      <div className="space-y-2 pl-4">
        {findings.map((f, i) => (
          <div
            key={`${f.entity}-${i}`}
            className={`rounded-xl border p-3 ${cfg.rowBorder}`}
          >
            <div className="flex flex-wrap items-start gap-2 mb-1">
              <span className="text-sm font-semibold text-neutral-900">{f.entity}</span>
              <span
                className={`text-[10px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded border ${TIER_COLORS[f.tier] ?? TIER_COLORS.LOW}`}
              >
                {f.tier}
              </span>
            </div>
            <p className="text-sm text-neutral-700 leading-relaxed">{f.claim}</p>
            {f.suggested_change && f.suggested_change !== "Review the underlying source and update this file manually." && (
              <p className="mt-1.5 text-xs text-neutral-500 leading-relaxed">
                <span className="font-medium text-neutral-600">What to do: </span>
                {f.suggested_change}
              </p>
            )}
            {f.affected_file && f.affected_file !== "unknown" && (
              <p className="mt-1 text-[11px] text-neutral-400">
                File: {f.affected_file}
                {f.affected_line != null ? `:${f.affected_line}` : ""}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SourceQualityBar({ sources }: { sources: SourceMeta[] }) {
  const live = sources.filter((s) => s.status === "live").length
  const cached = sources.filter((s) => s.status === "cached").length
  const unavailable = sources.filter((s) => s.status === "unavailable").length
  const total = sources.length

  if (total === 0) return null

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] uppercase tracking-widest text-neutral-400 mb-2">Source quality</p>
      <div className="flex items-center gap-3 text-xs">
        {live > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="text-emerald-700 font-medium">{live} live</span>
          </span>
        )}
        {cached > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400 flex-shrink-0" />
            <span className="text-amber-700">{cached} cached</span>
          </span>
        )}
        {unavailable > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-neutral-300 flex-shrink-0" />
            <span className="text-neutral-500">{unavailable} unavailable</span>
          </span>
        )}
        {live === 0 && cached > 0 && (
          <span className="ml-auto text-amber-600 text-[11px]">
            No live sources — findings based on cached data.
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function RunSummary({ findings, sources }: RunSummaryProps) {
  if (findings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <p className="text-sm text-neutral-500">No findings to summarise yet.</p>
        <p className="text-xs text-neutral-400">Run a check to see a natural-language breakdown here.</p>
      </div>
    )
  }

  const groups = groupByImpact(findings)
  const headline = headlineSentence(findings)
  const nextStep = nextStepBlurb(findings)
  const impactOrder = ["breaking", "deprecation", "additive", "best_practice"]

  return (
    <div className="space-y-5">
      {/* Headline */}
      <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3">
        <p className="text-sm font-semibold text-neutral-900 leading-snug">{headline}</p>
        {nextStep && (
          <p className="mt-1.5 text-xs text-neutral-600 leading-relaxed">{nextStep}</p>
        )}
      </div>

      {/* Findings by impact group */}
      <div className="space-y-5">
        {impactOrder
          .filter((impact) => groups.has(impact))
          .map((impact) => (
            <ImpactGroup
              key={impact}
              impact={impact}
              findings={groups.get(impact)!}
            />
          ))}
      </div>

      {/* Source quality */}
      <SourceQualityBar sources={sources} />
    </div>
  )
}
