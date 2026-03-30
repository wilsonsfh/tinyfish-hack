"use client"

import { StageState } from "@/lib/types"

interface StageNodeProps {
  stage: StageState
  isActive: boolean
  onClick: () => void
}

// SVG icon components — no external libraries
function IdleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function SpinnerIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="animate-spin"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function FallbackDot() {
  return (
    <span
      title="Fallback data used"
      className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-slate-900 z-10"
      aria-label="Fallback fixture data used"
    />
  )
}

const STATUS_CONFIG = {
  idle: {
    icon: <IdleIcon />,
    iconColor: "text-slate-500",
    borderColor: "border-white/10",
    bgColor: "bg-white/[0.03]",
    glowClass: "",
    labelColor: "text-slate-400",
    badgeText: "IDLE",
    badgeBg: "bg-white/[0.05] text-slate-400",
    ringColor: "",
  },
  running: {
    icon: <SpinnerIcon />,
    iconColor: "text-blue-400",
    borderColor: "border-cyan-400/40",
    bgColor: "bg-cyan-400/8",
    glowClass: "shadow-[0_0_20px_rgba(34,211,238,0.2)] animate-pulse-glow",
    labelColor: "text-blue-300",
    badgeText: "RUNNING",
    badgeBg: "bg-cyan-400/12 text-cyan-200",
    ringColor: "ring-2 ring-cyan-400/18",
  },
  complete: {
    icon: <CheckIcon />,
    iconColor: "text-emerald-400",
    borderColor: "border-emerald-400/35",
    bgColor: "bg-emerald-400/8",
    glowClass: "shadow-[0_0_16px_rgba(52,211,153,0.18)]",
    labelColor: "text-emerald-300",
    badgeText: "DONE",
    badgeBg: "bg-emerald-400/12 text-emerald-200",
    ringColor: "ring-1 ring-emerald-500/20",
  },
  error: {
    icon: <ErrorIcon />,
    iconColor: "text-red-400",
    borderColor: "border-rose-400/40",
    bgColor: "bg-rose-400/8",
    glowClass: "shadow-[0_0_16px_rgba(244,63,94,0.16)]",
    labelColor: "text-red-300",
    badgeText: "ERROR",
    badgeBg: "bg-rose-400/12 text-rose-200",
    ringColor: "ring-1 ring-red-500/20",
  },
} as const

function formatDuration(startedAt?: string, completedAt?: string): string | null {
  if (!startedAt) return null
  const end = completedAt ? new Date(completedAt) : new Date()
  const ms = end.getTime() - new Date(startedAt).getTime()
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function StageNode({ stage, isActive, onClick }: StageNodeProps) {
  const cfg = STATUS_CONFIG[stage.status]
  const duration = formatDuration(stage.startedAt, stage.completedAt)

  return (
    <button
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`${stage.label} stage — ${stage.status}`}
      className={[
        // Base layout
        "relative flex flex-col items-center gap-2 w-full",
        "group cursor-pointer focus:outline-none",
        // Focus ring for keyboard nav
        "focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 rounded-lg",
      ].join(" ")}
    >
      {/* Fallback indicator dot */}
      <div className="relative">
        {stage.usedFallback && <FallbackDot />}

        {/* Main card circle */}
        <div
          className={[
            "relative flex items-center justify-center",
            "w-14 h-14 rounded-full border-2",
            "transition-all duration-200 ease-out",
            cfg.bgColor,
            cfg.borderColor,
            cfg.glowClass,
            cfg.ringColor,
            // Active indicator: extra ring
            isActive
              ? "ring-2 ring-offset-2 ring-offset-slate-950 ring-white/14 scale-105"
              : "group-hover:scale-105 group-hover:border-opacity-90",
          ].join(" ")}
        >
          {/* Status icon */}
          <span className={["transition-colors duration-200", cfg.iconColor].join(" ")}>
            {cfg.icon}
          </span>
        </div>
      </div>

      {/* Stage label */}
      <span
        className={[
          "text-xs font-semibold tracking-wider uppercase leading-tight text-center",
          "transition-colors duration-200",
          cfg.labelColor,
          isActive ? "opacity-100" : "opacity-75 group-hover:opacity-100",
        ].join(" ")}
      >
        {stage.label}
      </span>

      {/* Status badge */}
      <span
        className={[
          "text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded",
          "uppercase transition-all duration-200",
          cfg.badgeBg,
        ].join(" ")}
      >
        {cfg.badgeText}
      </span>

      {/* Duration chip — only when we have timing data */}
      {duration && stage.status !== "idle" && (
        <span className="text-[9px] tracking-wide text-slate-500">
          {duration}
        </span>
      )}

      {/* Error message excerpt */}
      {stage.status === "error" && stage.error && (
        <span
          className="text-[9px] max-w-[80px] truncate text-center leading-tight text-red-400/80"
          title={stage.error}
        >
          {stage.error.slice(0, 32)}
          {stage.error.length > 32 ? "…" : ""}
        </span>
      )}

      {/* Inspect hint on hover */}
      <span
        className={[
          "text-[9px] tracking-wide text-slate-600",
          "opacity-0 group-hover:opacity-100 transition-opacity duration-150",
          "absolute -bottom-5 whitespace-nowrap",
        ].join(" ")}
        aria-hidden="true"
      >
        click to inspect
      </span>
    </button>
  )
}
