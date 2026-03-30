"use client"

import { ConfidenceTier } from "@/lib/types"

interface ConfidenceBadgeProps {
  tier: ConfidenceTier | string | undefined
  size?: "sm" | "md"
}

const TIER_CONFIG: Record<
  ConfidenceTier,
  { label: string; className: string }
> = {
  HIGH: {
    label: "HIGH",
    className:
      "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  },
  MEDIUM: {
    label: "MEDIUM",
    className: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
  },
  LOW: {
    label: "LOW",
    className: "bg-slate-700/60 text-slate-400 border border-slate-600/50",
  },
  CONFLICT: {
    label: "CONFLICT",
    className:
      "bg-transparent text-red-400 border border-red-500/70 shadow-[0_0_8px_rgba(239,68,68,0.2)]",
  },
}

const FALLBACK_CONFIG = {
  label: "UNKNOWN",
  className: "bg-slate-800 text-slate-400 border border-slate-700",
}

export function ConfidenceBadge({ tier, size = "md" }: ConfidenceBadgeProps) {
  const cfg =
    typeof tier === "string" && tier in TIER_CONFIG
      ? TIER_CONFIG[tier as ConfidenceTier]
      : FALLBACK_CONFIG

  const sizeClass =
    size === "sm"
      ? "px-1.5 py-0.5 text-[9px] tracking-widest"
      : "px-2 py-0.5 text-[10px] tracking-widest"

  return (
    <span
      className={[
        "inline-flex items-center rounded font-bold uppercase",
        "whitespace-nowrap select-none",
        sizeClass,
        cfg.className,
      ].join(" ")}
      aria-label={`Confidence: ${cfg.label}`}
    >
      {cfg.label}
    </span>
  )
}
