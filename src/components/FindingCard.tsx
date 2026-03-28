"use client"

import { useState } from "react"
import { Finding, ImpactType } from "@/lib/types"
import { ConfidenceBadge } from "./ConfidenceBadge"
import { ProvenanceChain } from "./ProvenanceChain"

interface FindingCardProps {
  finding: Finding
}

// ---------------------------------------------------------------------------
// Impact badge config
// ---------------------------------------------------------------------------

const IMPACT_CONFIG: Record<
  ImpactType,
  { label: string; className: string }
> = {
  breaking: {
    label: "BREAKING",
    className:
      "bg-red-500/20 text-red-300 border border-red-500/50 shadow-[0_0_8px_rgba(239,68,68,0.18)]",
  },
  deprecation: {
    label: "DEPRECATION",
    className:
      "bg-orange-500/20 text-orange-300 border border-orange-500/50",
  },
  additive: {
    label: "ADDITIVE",
    className:
      "bg-blue-500/20 text-blue-300 border border-blue-500/50",
  },
  best_practice: {
    label: "BEST PRACTICE",
    className:
      "bg-purple-500/20 text-purple-300 border border-purple-500/50",
  },
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={[
        "transition-transform duration-200",
        open ? "rotate-180" : "rotate-0",
      ].join(" ")}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block ml-1 opacity-60 flex-shrink-0"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block mr-1 opacity-60 flex-shrink-0"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return iso
  }
}

function ImpactBadge({ impact }: { impact: ImpactType }) {
  const cfg = IMPACT_CONFIG[impact]
  return (
    <span
      className={[
        "inline-flex items-center rounded font-mono font-bold uppercase",
        "whitespace-nowrap select-none px-2 py-0.5 text-[10px] tracking-widest",
        cfg.className,
      ].join(" ")}
      aria-label={`Impact: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FindingCard({ finding }: FindingCardProps) {
  const [expanded, setExpanded] = useState(false)

  const formattedDate = formatDate(finding.source_date)

  // Border glow per impact
  const cardGlow =
    finding.impact === "breaking"
      ? "shadow-[0_0_24px_rgba(239,68,68,0.12)] border-red-900/60 hover:border-red-800/80"
      : finding.impact === "deprecation"
      ? "border-orange-900/50 hover:border-orange-800/70"
      : finding.impact === "additive"
      ? "border-blue-900/50 hover:border-blue-800/70"
      : "border-slate-700/60 hover:border-slate-600/80"

  return (
    <article
      className={[
        "flex flex-col gap-0 rounded-xl border bg-slate-900/80 backdrop-blur-sm",
        "transition-all duration-200",
        cardGlow,
      ].join(" ")}
      aria-label={`Finding: ${finding.entity}`}
    >
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 p-4">
        {/* Top row: entity + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-bold text-slate-100 tracking-tight">
            {finding.entity}
          </span>
          <ImpactBadge impact={finding.impact} />
          <ConfidenceBadge tier={finding.tier} size="sm" />
        </div>

        {/* Claim */}
        <p className="font-mono text-[12px] text-slate-300 leading-relaxed">
          {finding.claim}
        </p>

        {/* Justification */}
        <p className="font-mono text-[11px] text-slate-500 leading-relaxed italic">
          {finding.justification}
        </p>

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-0.5">
          {/* Source link + date */}
          <a
            href={finding.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className={[
              "inline-flex items-center gap-0.5",
              "font-mono text-[11px] text-blue-400 hover:text-blue-300",
              "transition-colors duration-150 cursor-pointer",
              "max-w-[260px] truncate",
            ].join(" ")}
            title={finding.source_url}
          >
            {finding.source_url.replace(/^https?:\/\//, "").slice(0, 48)}
            {finding.source_url.replace(/^https?:\/\//, "").length > 48 && "…"}
            <ExternalLinkIcon />
          </a>

          {formattedDate && (
            <span className="font-mono text-[11px] text-slate-600">
              {formattedDate}
            </span>
          )}
        </div>

        {/* Affected file + line */}
        <div className="flex items-center gap-1 font-mono text-[11px] text-slate-500">
          <FileIcon />
          <span className="text-slate-400">{finding.affected_file}</span>
          {finding.affected_line != null && (
            <span className="text-slate-600">:{finding.affected_line}</span>
          )}
        </div>

        {/* Suggested change — preview pill */}
        <div className="rounded-md bg-slate-800/80 border border-slate-700/50 px-3 py-2">
          <div className="font-mono text-[9px] text-slate-600 uppercase tracking-widest mb-1">
            suggested change
          </div>
          <p
            className={[
              "font-mono text-[11px] text-emerald-300 leading-relaxed",
              expanded ? "" : "line-clamp-2",
            ].join(" ")}
          >
            {finding.suggested_change}
          </p>
        </div>
      </div>

      {/* ── Divider + expand toggle ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`provenance-${finding.entity}`}
        className={[
          "flex items-center justify-between w-full px-4 py-2.5",
          "border-t border-slate-800/80",
          "font-mono text-[10px] text-slate-500 hover:text-slate-300",
          "hover:bg-slate-800/40 transition-all duration-150 cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
          "focus-visible:ring-inset",
          expanded ? "text-slate-300" : "",
        ].join(" ")}
      >
        <span className="uppercase tracking-widest font-bold">
          {expanded
            ? "hide provenance"
            : `show provenance chain (${finding.provenance.length} sources)`}
        </span>
        <ChevronDownIcon open={expanded} />
      </button>

      {/* ── Provenance panel ── */}
      {expanded && (
        <div
          id={`provenance-${finding.entity}`}
          className="px-4 pb-4 pt-1 border-t border-slate-800/40"
        >
          <ProvenanceChain steps={finding.provenance} />
        </div>
      )}
    </article>
  )
}
