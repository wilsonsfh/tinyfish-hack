"use client"

import { StageState, StageId } from "@/lib/types"
import { StageNode } from "./StageNode"

interface PipelineProps {
  stages: StageState[]
  activeStage: StageId | null
  onStageClick: (id: StageId) => void
}

// ─── Arrow connector between two sequential nodes ─────────────────────────────
interface ArrowProps {
  lit: boolean
}

function ArrowConnector({ lit }: ArrowProps) {
  return (
    <div
      className="flex items-center justify-center flex-shrink-0 px-1"
      aria-hidden="true"
    >
      {/* Line segment */}
      <div
        className={[
          "h-px w-8 md:w-12 transition-all duration-500",
          lit
            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
            : "bg-slate-700",
        ].join(" ")}
      />
      {/* Arrowhead */}
      <svg
        width="8"
        height="10"
        viewBox="0 0 8 10"
        fill="none"
        className="flex-shrink-0"
      >
        <path
          d="M0 1 L7 5 L0 9"
          stroke={lit ? "#34d399" : "#334155"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all duration-500"
          style={lit ? { filter: "drop-shadow(0 0 3px rgba(52,211,153,0.8))" } : {}}
        />
      </svg>
    </div>
  )
}

// ─── Merge arrow — used below the parallel fork to re-join ───────────────────
function MergeArrow({ lit }: { lit: boolean }) {
  return (
    <svg
      viewBox="0 0 60 60"
      className="w-10 h-10 md:w-14 md:h-14 flex-shrink-0"
      aria-hidden="true"
    >
      {/* Top branch line */}
      <line
        x1="0"
        y1="15"
        x2="50"
        y2="30"
        stroke={lit ? "#34d399" : "#334155"}
        strokeWidth="1.5"
        strokeLinecap="round"
        className="transition-all duration-500"
        style={lit ? { filter: "drop-shadow(0 0 3px rgba(52,211,153,0.8))" } : {}}
      />
      {/* Bottom branch line */}
      <line
        x1="0"
        y1="45"
        x2="50"
        y2="30"
        stroke={lit ? "#34d399" : "#334155"}
        strokeWidth="1.5"
        strokeLinecap="round"
        className="transition-all duration-500"
        style={lit ? { filter: "drop-shadow(0 0 3px rgba(52,211,153,0.8))" } : {}}
      />
      {/* Arrowhead */}
      <path
        d="M44 26 L54 30 L44 34"
        stroke={lit ? "#34d399" : "#334155"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="transition-all duration-500"
        style={lit ? { filter: "drop-shadow(0 0 3px rgba(52,211,153,0.8))" } : {}}
      />
    </svg>
  )
}

// ─── Vertical divider label ───────────────────────────────────────────────────
function PhaseLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[9px] text-slate-600 tracking-[0.2em] uppercase select-none">
      {children}
    </span>
  )
}

// ─── Scan-line overlay for the terminal aesthetic ────────────────────────────
function ScanlineOverlay() {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-xl opacity-[0.03]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.5) 2px, rgba(255,255,255,0.5) 3px)",
      }}
      aria-hidden="true"
    />
  )
}

// ─── Corner-bracket decorations ──────────────────────────────────────────────
function CornerBrackets() {
  const corner =
    "absolute w-3 h-3 border-slate-600 opacity-40"
  return (
    <>
      <span className={`${corner} top-2 left-2 border-t border-l`} aria-hidden="true" />
      <span className={`${corner} top-2 right-2 border-t border-r`} aria-hidden="true" />
      <span className={`${corner} bottom-2 left-2 border-b border-l`} aria-hidden="true" />
      <span className={`${corner} bottom-2 right-2 border-b border-r`} aria-hidden="true" />
    </>
  )
}

// ─── Helper: is a stage considered "done" for lighting up downstream arrows ──
function isDone(stage: StageState | undefined): boolean {
  return stage?.status === "complete"
}

// ─── Main pipeline component ─────────────────────────────────────────────────
export function Pipeline({ stages, activeStage, onStageClick }: PipelineProps) {
  const byId = (id: StageId) => stages.find((s) => s.id === id)

  const discovery = byId("discovery")
  const skillsDiff = byId("skills-diff")
  const resolution = byId("resolution")
  const diff = byId("diff")
  const confidence = byId("confidence")
  const output = byId("output")

  // Arrows light up only after both parallel stages complete
  const parallelBothDone = isDone(discovery) && isDone(skillsDiff)

  // Count completed stages for the progress bar
  const totalStages = stages.length
  const completedCount = stages.filter((s) => s.status === "complete").length
  const runningCount = stages.filter((s) => s.status === "running").length
  const progressPct = totalStages > 0 ? (completedCount / totalStages) * 100 : 0

  const renderNode = (stage: StageState | undefined) => {
    if (!stage) return null
    return (
      <StageNode
        stage={stage}
        isActive={activeStage === stage.id}
        onClick={() => onStageClick(stage.id)}
      />
    )
  }

  return (
    <section
      className="relative w-full"
      aria-label="Pipeline visualization"
      role="region"
    >
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          {/* Blinking dot when pipeline is running */}
          {runningCount > 0 && (
            <span
              className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-ping"
              aria-hidden="true"
            />
          )}
          {runningCount === 0 && completedCount === totalStages && totalStages > 0 && (
            <span
              className="inline-block w-2 h-2 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
          )}
          <span className="font-mono text-xs text-slate-400 tracking-widest uppercase">
            {runningCount > 0
              ? "pipeline running"
              : completedCount === totalStages && totalStages > 0
              ? "pipeline complete"
              : "pipeline idle"}
          </span>
        </div>
        <span className="font-mono text-xs text-slate-600 tabular-nums">
          {completedCount}/{totalStages} stages
        </span>
      </div>

      {/* ── Main visualization card ─────────────────────────────────────────── */}
      <div
        className={[
          "relative overflow-hidden rounded-xl border",
          "bg-slate-900/80 backdrop-blur-sm",
          "border-slate-700/60",
          "transition-all duration-300",
          runningCount > 0
            ? "shadow-[0_0_40px_rgba(59,130,246,0.12)]"
            : completedCount === totalStages && totalStages > 0
            ? "shadow-[0_0_40px_rgba(52,211,153,0.10)]"
            : "shadow-none",
        ].join(" ")}
      >
        <ScanlineOverlay />
        <CornerBrackets />

        {/* ── Progress bar (top edge) ─────────────────────────────────────── */}
        <div
          className="absolute top-0 left-0 h-[2px] bg-slate-800 w-full"
          aria-hidden="true"
        >
          <div
            className={[
              "h-full transition-all duration-700 ease-out",
              completedCount === totalStages && totalStages > 0
                ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"
                : "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]",
            ].join(" ")}
            style={{ width: `${progressPct}%` }}
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Pipeline progress"
          />
        </div>

        {/* ── Desktop layout: horizontal row ─────────────────────────────── */}
        <div className="hidden md:flex items-center justify-center px-6 py-8 gap-0 min-h-[180px]">

          {/* Phase 1: Parallel discovery — stacked vertically */}
          <div className="flex flex-col items-center gap-3">
            <PhaseLabel>signal</PhaseLabel>
            <div className="flex flex-col gap-5">
              {renderNode(discovery)}
              {renderNode(skillsDiff)}
            </div>
          </div>

          {/* Fork → parallel nodes are already stacked above; merge arrow follows */}
          <MergeArrow lit={parallelBothDone} />

          {/* Phase 2: Resolution */}
          <div className="flex flex-col items-center gap-3">
            <PhaseLabel>resolve</PhaseLabel>
            {renderNode(resolution)}
          </div>

          <ArrowConnector lit={isDone(resolution)} />

          {/* Phase 3: Diff */}
          <div className="flex flex-col items-center gap-3">
            <PhaseLabel>diff</PhaseLabel>
            {renderNode(diff)}
          </div>

          <ArrowConnector lit={isDone(diff)} />

          {/* Phase 4: Confidence */}
          <div className="flex flex-col items-center gap-3">
            <PhaseLabel>rank</PhaseLabel>
            {renderNode(confidence)}
          </div>

          <ArrowConnector lit={isDone(confidence)} />

          {/* Phase 5: Output */}
          <div className="flex flex-col items-center gap-3">
            <PhaseLabel>output</PhaseLabel>
            {renderNode(output)}
          </div>
        </div>

        {/* ── Mobile layout: vertical stack ──────────────────────────────── */}
        <div className="flex md:hidden flex-col items-center gap-0 px-4 py-6">

          {/* Parallel pair side by side on mobile */}
          <div className="flex items-start gap-4 justify-center w-full">
            <div className="flex flex-col items-center">
              <PhaseLabel>discovery</PhaseLabel>
              <div className="mt-2">{renderNode(discovery)}</div>
            </div>
            <div className="flex flex-col items-center">
              <PhaseLabel>skills diff</PhaseLabel>
              <div className="mt-2">{renderNode(skillsDiff)}</div>
            </div>
          </div>

          {/* Vertical arrow down */}
          <MobileArrow lit={parallelBothDone} />

          <div className="flex flex-col items-center">
            <PhaseLabel>resolution</PhaseLabel>
            <div className="mt-2">{renderNode(resolution)}</div>
          </div>

          <MobileArrow lit={isDone(resolution)} />

          <div className="flex flex-col items-center">
            <PhaseLabel>diff</PhaseLabel>
            <div className="mt-2">{renderNode(diff)}</div>
          </div>

          <MobileArrow lit={isDone(diff)} />

          <div className="flex flex-col items-center">
            <PhaseLabel>confidence</PhaseLabel>
            <div className="mt-2">{renderNode(confidence)}</div>
          </div>

          <MobileArrow lit={isDone(confidence)} />

          <div className="flex flex-col items-center">
            <PhaseLabel>output</PhaseLabel>
            <div className="mt-2">{renderNode(output)}</div>
          </div>
        </div>

        {/* ── Footer bar: legend ─────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between gap-4 px-5 py-2.5 border-t border-slate-800/80"
          aria-hidden="true"
        >
          <div className="flex items-center gap-4 flex-wrap">
            <LegendItem color="bg-slate-600" label="idle" />
            <LegendItem color="bg-blue-500 animate-pulse" label="running" />
            <LegendItem color="bg-emerald-400" label="complete" />
            <LegendItem color="bg-red-500" label="error" />
            <LegendItem color="bg-amber-400" label="fallback" />
          </div>
          <span className="font-mono text-[9px] text-slate-700 tracking-widest uppercase hidden sm:block">
            click stage to inspect
          </span>
        </div>
      </div>
    </section>
  )
}

// ─── Mobile-only vertical arrow ──────────────────────────────────────────────
function MobileArrow({ lit }: { lit: boolean }) {
  return (
    <div className="flex flex-col items-center my-1" aria-hidden="true">
      <div
        className={[
          "w-px h-6 transition-all duration-500",
          lit
            ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.8)]"
            : "bg-slate-700",
        ].join(" ")}
      />
      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
        <path
          d="M1 1 L4 5 L7 1"
          stroke={lit ? "#34d399" : "#334155"}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all duration-500"
        />
      </svg>
    </div>
  )
}

// ─── Legend item ─────────────────────────────────────────────────────────────
function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      <span className="font-mono text-[9px] text-slate-600 tracking-wider">{label}</span>
    </div>
  )
}
