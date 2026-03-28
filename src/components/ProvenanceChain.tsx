"use client"

import { ProvenanceStep } from "@/lib/types"
import { ConfidenceBadge } from "./ConfidenceBadge"

interface ProvenanceChainProps {
  steps: ProvenanceStep[]
}

function ExternalLinkIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="inline-block ml-0.5 opacity-60"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-slate-600 flex-shrink-0"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function formatDate(iso?: string): string | null {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })
  } catch {
    return null
  }
}

function StepNode({ step, index }: { step: ProvenanceStep; index: number }) {
  const date = formatDate(step.date)

  return (
    <div
      className={[
        "flex flex-col gap-1.5 min-w-[160px] max-w-[220px]",
        "bg-slate-800/70 border border-slate-700/60 rounded-lg p-3",
        "transition-colors duration-150 hover:border-slate-600/80 hover:bg-slate-800/90",
      ].join(" ")}
      aria-label={`Step ${index + 1}: ${step.source}`}
    >
      {/* Step number + confidence badge */}
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[9px] text-slate-600 font-bold uppercase tracking-widest">
          step {index + 1}
        </span>
        <ConfidenceBadge tier={step.tier} size="sm" />
      </div>

      {/* Source name — link if URL available */}
      <div className="font-mono text-[11px] font-semibold text-slate-200 leading-tight">
        {step.url ? (
          <a
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-blue-300 transition-colors duration-150 cursor-pointer"
          >
            {step.source}
            <ExternalLinkIcon />
          </a>
        ) : (
          step.source
        )}
      </div>

      {/* Date */}
      {date && (
        <span className="font-mono text-[9px] text-slate-500 tracking-wide">
          {date}
        </span>
      )}

      {/* Summary */}
      <p className="font-mono text-[10px] text-slate-400 leading-relaxed line-clamp-3">
        {step.summary}
      </p>
    </div>
  )
}

export function ProvenanceChain({ steps }: ProvenanceChainProps) {
  if (!steps || steps.length === 0) {
    return (
      <p className="font-mono text-[11px] text-slate-600 italic">
        No provenance data available.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3" aria-label="Provenance chain">
      {/* Label */}
      <div className="flex items-center gap-2">
        <span className="font-mono text-[9px] text-slate-600 font-bold uppercase tracking-widest">
          provenance trail
        </span>
        <div className="h-px flex-1 bg-slate-800" />
        <span className="font-mono text-[9px] text-slate-700">
          {steps.length} {steps.length === 1 ? "source" : "sources"}
        </span>
      </div>

      {/* Chain — scrollable horizontally on small viewports */}
      <div
        className="flex items-start gap-2 overflow-x-auto pb-1"
        role="list"
        style={{ scrollbarWidth: "thin" }}
      >
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 flex-shrink-0" role="listitem">
            <StepNode step={step} index={i} />
            {i < steps.length - 1 && <ArrowIcon />}
          </div>
        ))}
      </div>

      {/* Scrollbar hint on overflow */}
      {steps.length > 3 && (
        <p className="font-mono text-[9px] text-slate-700 text-right select-none">
          scroll to see full chain →
        </p>
      )}
    </div>
  )
}
