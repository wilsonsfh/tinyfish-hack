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
      "bg-red-50 text-red-700 border border-red-200",
  },
  deprecation: {
    label: "DEPRECATION",
    className:
      "bg-orange-50 text-orange-700 border border-orange-200",
  },
  additive: {
    label: "ADDITIVE",
    className:
      "bg-blue-50 text-blue-700 border border-blue-200",
  },
  best_practice: {
    label: "BEST PRACTICE",
    className:
      "bg-purple-50 text-purple-700 border border-purple-200",
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
  if (!iso) return ""
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

const FALLBACK_IMPACT_CONFIG = {
  label: "UNKNOWN",
  className: "bg-neutral-100 text-neutral-500 border border-neutral-200",
}

function ImpactBadge({ impact }: { impact: ImpactType | string | undefined }) {
  const cfg =
    typeof impact === "string" && impact in IMPACT_CONFIG
      ? IMPACT_CONFIG[impact as ImpactType]
      : FALLBACK_IMPACT_CONFIG
  return (
    <span
      className={[
        "inline-flex items-center rounded font-bold uppercase",
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

  const entity =
    typeof finding.entity === "string" && finding.entity.trim() !== ""
      ? finding.entity
      : "Unknown finding"
  const claim =
    typeof finding.claim === "string" && finding.claim.trim() !== ""
      ? finding.claim
      : "No claim provided."
  const justification =
    typeof finding.justification === "string" && finding.justification.trim() !== ""
      ? finding.justification
      : "No justification was provided."
  const sourceUrl = typeof finding.source_url === "string" ? finding.source_url : ""
  const formattedDate = formatDate(typeof finding.source_date === "string" ? finding.source_date : "")
  const affectedFile =
    typeof finding.affected_file === "string" && finding.affected_file.trim() !== ""
      ? finding.affected_file
      : "unknown"
  const suggestedChange =
    typeof finding.replacement_text === "string" && finding.replacement_text.trim() !== ""
      ? finding.replacement_text
      : typeof finding.suggested_change === "string" && finding.suggested_change.trim() !== ""
      ? finding.suggested_change
      : "Review the related source and update this file manually."
  const provenance = Array.isArray(finding.provenance) ? finding.provenance : []
  const provenanceId = `provenance-${entity.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase()}`

  const cardBorder =
    finding.impact === "breaking"
      ? "border-red-200 hover:border-red-300"
      : finding.impact === "deprecation"
      ? "border-orange-200 hover:border-orange-300"
      : finding.impact === "additive"
      ? "border-blue-200 hover:border-blue-300"
      : "border-neutral-200 hover:border-neutral-300"

  return (
    <article
      className={[
        "flex flex-col gap-0 rounded-2xl border bg-white",
        "transition-all duration-200",
        cardBorder,
      ].join(" ")}
      aria-label={`Finding: ${entity}`}
    >
      {/* ── Header ── */}
      <div className="flex flex-col gap-3 p-4">
        {/* Top row: entity + badges */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold tracking-tight text-neutral-900">
            {entity}
          </span>
          <ImpactBadge impact={finding.impact} />
          <ConfidenceBadge tier={finding.tier} size="sm" />
        </div>

        {/* Claim — main readable sentence */}
        <p className="text-sm leading-relaxed text-neutral-700">
          {claim}
        </p>

        {/* Suggested change */}
        {suggestedChange && suggestedChange !== "Review the related source and update this file manually." && (
          <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2.5">
            <div className="text-[9px] uppercase tracking-widest text-neutral-400 mb-1">
              What to do
            </div>
            <p
              className={[
                "text-xs leading-relaxed text-neutral-600",
                expanded ? "" : "line-clamp-2",
              ].join(" ")}
            >
              {suggestedChange}
            </p>
          </div>
        )}

        {/* Metadata row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-neutral-400">
          {sourceUrl ? (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-neutral-500 hover:text-neutral-700 transition-colors duration-150 cursor-pointer max-w-[220px] truncate"
              title={sourceUrl}
            >
              {sourceUrl.replace(/^https?:\/\//, "").slice(0, 44)}
              {sourceUrl.replace(/^https?:\/\//, "").length > 44 && "…"}
              <ExternalLinkIcon />
            </a>
          ) : (
            <span>no source URL</span>
          )}
          {formattedDate && <span>{formattedDate}</span>}
          {affectedFile !== "unknown" && (
            <span className="flex items-center gap-0.5">
              <FileIcon />
              {affectedFile}
              {finding.affected_line != null && `:${finding.affected_line}`}
            </span>
          )}
        </div>
      </div>

      {/* ── Expand toggle ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={provenanceId}
        className={[
          "flex items-center justify-between w-full px-4 py-2.5",
          "border-t border-neutral-100",
          "text-[10px] text-neutral-400 hover:text-neutral-600",
          "hover:bg-neutral-50 transition-all duration-150 cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300",
          "focus-visible:ring-inset",
        ].join(" ")}
      >
        <span className="uppercase tracking-widest font-medium">
          {expanded
            ? "hide provenance"
            : `provenance chain (${provenance.length} sources)`}
        </span>
        <ChevronDownIcon open={expanded} />
      </button>

      {/* ── Provenance panel ── */}
      {expanded && (
        <div
          id={provenanceId}
          className="border-t border-neutral-100 px-4 pb-4 pt-2"
        >
          <ProvenanceChain steps={provenance} />
        </div>
      )}
    </article>
  )
}
