"use client"

import Image from "next/image"
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { fallbackReasonLabel } from "@/lib/fallbacks"
import { buildQuickCheckConfigContent } from "@/lib/quick-check"
import type {
  Finding,
  PipelineEvent,
  QuickCheckScope,
  RepoDiffScope,
  SourceMeta,
  StageId,
  StageState,
} from "@/lib/types"
import { Pipeline } from "@/components/Pipeline"
import StageDetail from "@/components/StageDetail"
import FileUpload from "@/components/FileUpload"
import FindingCard from "@/components/FindingCard"
import DiffView from "@/components/DiffView"
import SourcesPanel from "@/components/SourcesPanel"

const CONFIDENCE_TIERS = new Set(["HIGH", "MEDIUM", "LOW", "CONFLICT"] as const)
const IMPACT_TYPES = new Set(["breaking", "deprecation", "additive", "best_practice"] as const)
const SOURCE_TYPES = new Set(["tinyfish", "git_diff", "fixture", "repo_inventory"] as const)
const SOURCE_STATUSES = new Set(["live", "cached", "unavailable"] as const)
const STAGE_IDS = new Set(["discovery", "skills-diff", "resolution", "diff", "confidence", "output"] as const)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function safeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function normalizeConfidenceTier(value: unknown): Finding["tier"] {
  return typeof value === "string" && CONFIDENCE_TIERS.has(value as Finding["tier"])
    ? (value as Finding["tier"])
    : "LOW"
}

function normalizeImpactType(value: unknown): Finding["impact"] {
  return typeof value === "string" && IMPACT_TYPES.has(value as Finding["impact"])
    ? (value as Finding["impact"])
    : "best_practice"
}

function sanitizeProvenance(steps: unknown): Finding["provenance"] {
  if (!Array.isArray(steps)) return []

  return steps
    .map((step, index) => {
      if (!isObject(step)) {
        return {
          source: `Source ${index + 1}`,
          summary: "No provenance summary was provided.",
          tier: "LOW" as const,
        }
      }

      return {
        source: safeString(step.source, `Source ${index + 1}`),
        url: safeOptionalString(step.url),
        date: safeOptionalString(step.date),
        summary: safeString(step.summary, "No provenance summary was provided."),
        tier: normalizeConfidenceTier(step.tier),
      }
    })
    .filter((step) => step.source.trim() !== "" || step.summary.trim() !== "")
}

function sanitizeFinding(finding: unknown, index: number): Finding {
  if (!isObject(finding)) {
    return {
      entity: `Finding ${index + 1}`,
      claim: "Malformed finding payload received.",
      tier: "LOW",
      justification: "The server returned an unexpected finding shape, so DriftCheck normalized it for display.",
      source_url: "",
      source_date: "",
      impact: "best_practice",
      affected_file: "unknown",
      suggested_change: "Review the finding details manually.",
      replacement_text: undefined,
      provenance: [],
    }
  }

  const affectedLine =
    typeof finding.affected_line === "number" &&
    Number.isInteger(finding.affected_line) &&
    finding.affected_line > 0
      ? finding.affected_line
      : undefined

  return {
    entity: safeString(finding.entity, `Finding ${index + 1}`),
    claim: safeString(finding.claim, "No claim provided."),
    tier: normalizeConfidenceTier(finding.tier),
    justification: safeString(
      finding.justification,
      "No justification was provided for this finding."
    ),
    source_url: safeString(finding.source_url),
    source_date: safeString(finding.source_date),
    impact: normalizeImpactType(finding.impact),
    affected_file: safeString(finding.affected_file, "unknown"),
    affected_line: affectedLine,
    suggested_change: safeString(
      finding.suggested_change,
      "Review the underlying source and update this file manually."
    ),
    replacement_text: safeOptionalString(finding.replacement_text),
    provenance: sanitizeProvenance(finding.provenance),
  }
}

function sanitizeSource(source: unknown, index: number): SourceMeta {
  if (!isObject(source)) {
    return {
      stage: "output",
      url: "",
      label: `Source ${index + 1}`,
      scraped_at: new Date().toISOString(),
      source_type: "fixture",
      status: "unavailable",
      fallback_reason: "unknown_failure",
      fallback_detail: "Malformed source payload received.",
    }
  }

  const stage =
    typeof source.stage === "string" && STAGE_IDS.has(source.stage as StageId)
      ? (source.stage as StageId)
      : "output"
  const sourceType =
    typeof source.source_type === "string" && SOURCE_TYPES.has(source.source_type as SourceMeta["source_type"])
      ? (source.source_type as SourceMeta["source_type"])
      : "fixture"
  const status =
    typeof source.status === "string" && SOURCE_STATUSES.has(source.status as SourceMeta["status"])
      ? (source.status as SourceMeta["status"])
      : "unavailable"

  return {
    stage,
    url: safeString(source.url),
    label: safeString(source.label, `Source ${index + 1}`),
    scraped_at: safeString(source.scraped_at, new Date().toISOString()),
    source_type: sourceType,
    status,
    fallback_reason: safeOptionalString(source.fallback_reason) as SourceMeta["fallback_reason"] | undefined,
    fallback_detail: safeOptionalString(source.fallback_detail),
  }
}

const INITIAL_STAGES: StageState[] = [
  { id: "discovery", label: "Discovery", status: "idle", usedFallback: false },
  { id: "skills-diff", label: "Skills Diff", status: "idle", usedFallback: false },
  { id: "resolution", label: "Authoritative Check", status: "idle", usedFallback: false },
  { id: "diff", label: "Config Diff", status: "idle", usedFallback: false },
  { id: "confidence", label: "Trust Scoring", status: "idle", usedFallback: false },
  { id: "output", label: "Output", status: "idle", usedFallback: false },
]

type TabId = "findings" | "diff" | "sources" | "detail"

const MODE_SUMMARY = [
  {
    title: "Quick Check",
    stat: "~60%",
    note: "Cuts lookup time for one tool or skill question.",
  },
  {
    title: "Config Diff",
    stat: "~45%",
    note: "Cuts manual review when you already have local config or notes.",
  },
  {
    title: "Repo Diff",
    stat: "~70%",
    note: "Cuts repo maintenance triage for skills, references, and dependencies.",
  },
] as const

const MODE_COMPARISON = [
  {
    mode: "Quick Check",
    input: "Question",
    output: "Scoped findings",
    speed: "Fast",
    bestFor: "Checking one tool, skill, or provider without uploading a file.",
  },
  {
    mode: "Config Diff",
    input: "Config or notes",
    output: "Suggested updates",
    speed: "Most direct",
    bestFor: "Comparing a local setup against current authoritative guidance.",
  },
  {
    mode: "Repo Diff",
    input: "Folder or GitHub URL",
    output: "Repo recommendations",
    speed: "Deep scan",
    bestFor: "Reviewing skills, references, and dependency drift across a repo.",
  },
] as const

const INTEGRATIONS = [
  { name: "TinyFish", role: "live web intake" },
  { name: "OpenAI", role: "typed extraction + diffing" },
  { name: "GitHub", role: "repo intake" },
  { name: "Claude Code", role: "skill + config drift" },
  { name: "Codex", role: "agentic workflow checks" },
] as const

const DOC_LINKS = [
  {
    label: "Documentation",
    href: "https://github.com/wilsonsfh/tinyfish-hack#readme",
  },
  {
    label: "Architecture",
    href: "https://github.com/wilsonsfh/tinyfish-hack/blob/main/ARCHITECTURE.md",
  },
]

type ThemeMode = "dark" | "light"

function uniqueSources(sources: SourceMeta[]): SourceMeta[] {
  const deduped = new Map<string, SourceMeta>()

  for (const source of sources) {
    const key = [
      source.stage,
      source.url,
      source.status,
      source.fallback_reason ?? "",
      source.fallback_detail ?? "",
    ].join("::")

    if (!deduped.has(key)) {
      deduped.set(key, source)
    }
  }

  return [...deduped.values()]
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/15 text-[10px] font-semibold text-stone-400 transition-colors hover:border-cyan-400/40 hover:text-stone-100"
        aria-label="More info"
      >
        i
      </button>
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-2xl border border-white/10 bg-[#101114] px-3 py-2 text-[11px] leading-relaxed text-stone-300 shadow-2xl shadow-black/40 group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  )
}

function panelClass(extra = "") {
  return `rounded-[28px] border border-white/10 bg-white/[0.03] backdrop-blur-xl ${extra}`.trim()
}

function shellPanelClass(extra = "") {
  return `rounded-[30px] border border-[color:var(--chrome-border)] bg-[color:var(--chrome-surface)] shadow-[0_24px_80px_var(--chrome-shadow)] backdrop-blur-xl ${extra}`.trim()
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: ThemeMode
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--chrome-border)] bg-[color:var(--chrome-chip)] px-3 py-2 text-xs font-medium text-[color:var(--chrome-fg)] transition hover:border-[color:var(--chrome-border-strong)]"
      aria-label="Toggle color theme"
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--chrome-fg)]/8">
        {theme === "dark" ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
          </svg>
        )}
      </span>
      <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
    </button>
  )
}

function HeroCodePreview({
  quickCheckQuery,
  configFilename,
}: {
  quickCheckQuery: string
  configFilename: string
}) {
  const prompt = quickCheckQuery.trim() || "is my openai setup up to date?"
  const filename = configFilename || "sample-config.txt"

  return (
    <div className="rounded-[28px] border border-[#23314a] bg-[#0b1220] p-5 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
            Preview
          </p>
          <p className="mt-1 font-mono text-sm text-slate-200">{filename}</p>
        </div>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 font-mono text-[11px] text-cyan-200">
          live + typed
        </span>
      </div>

      <div className="mt-4 space-y-3 font-mono text-[13px] leading-7 text-slate-200">
        <div>
          <span className="text-fuchsia-300">const</span>{" "}
          <span className="text-sky-300">scope</span>{" "}
          <span className="text-slate-500">=</span>{" "}
          <span className="text-cyan-300">quickCheck</span>
          <span className="text-slate-400">(</span>
          <span className="text-amber-300">&quot;{prompt}&quot;</span>
          <span className="text-slate-400">)</span>
        </div>
        <div>
          <span className="text-fuchsia-300">const</span>{" "}
          <span className="text-sky-300">source</span>{" "}
          <span className="text-slate-500">=</span>{" "}
          <span className="text-emerald-300">await</span>{" "}
          <span className="text-cyan-300">tinyfish.resolve</span>
          <span className="text-slate-400">(scope)</span>
        </div>
        <div>
          <span className="text-fuchsia-300">const</span>{" "}
          <span className="text-sky-300">diff</span>{" "}
          <span className="text-slate-500">=</span>{" "}
          <span className="text-emerald-300">await</span>{" "}
          <span className="text-cyan-300">openai.compare</span>
          <span className="text-slate-400">({"{"} baseline, source {"}"})</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["scope", "question -> subject"],
          ["verify", "TinyFish + fallback"],
          ["apply", "replacement_text"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">
              {label}
            </p>
            <p className="mt-2 font-mono text-xs text-slate-200">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function IntegrationStrip() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {INTEGRATIONS.map((item) => (
        <div
          key={item.name}
          className="inline-flex items-center gap-3 rounded-full border border-[color:var(--chrome-border)] bg-[color:var(--chrome-chip)] px-4 py-2"
        >
          <span className="text-[12px] font-semibold text-[color:var(--chrome-fg)]">
            {item.name}
          </span>
          <span className="text-xs text-[color:var(--chrome-muted)]">{item.role}</span>
        </div>
      ))}
    </div>
  )
}

function FeatureComparisonTable() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-[color:var(--chrome-border)]">
      <table className="w-full border-collapse text-left">
        <thead className="bg-[color:var(--chrome-chip)]">
          <tr className="border-b border-[color:var(--chrome-border)] text-[11px] uppercase tracking-[0.22em] text-[color:var(--chrome-muted)]">
            <th className="px-4 py-3 font-medium">Mode</th>
            <th className="px-4 py-3 font-medium">Input</th>
            <th className="px-4 py-3 font-medium">Output</th>
            <th className="px-4 py-3 font-medium">Speed</th>
            <th className="px-4 py-3 font-medium">Best for</th>
          </tr>
        </thead>
        <tbody>
          {MODE_COMPARISON.map((row) => (
            <tr
              key={row.mode}
              className="border-b border-[color:var(--chrome-border)] last:border-b-0"
            >
              <td className="px-4 py-4 font-medium text-[color:var(--chrome-fg)]">{row.mode}</td>
              <td className="px-4 py-4 text-sm text-[color:var(--chrome-muted)]">{row.input}</td>
              <td className="px-4 py-4 text-sm text-[color:var(--chrome-muted)]">{row.output}</td>
              <td className="px-4 py-4 text-sm text-[color:var(--chrome-fg)]">{row.speed}</td>
              <td className="px-4 py-4 text-sm leading-6 text-[color:var(--chrome-muted)]">{row.bestFor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Home() {
  const [theme, setTheme] = useState<ThemeMode>("light")
  
  // Custom hook for scroll-reveal
  const useScrollReveal = () => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view")
        }
      }, { threshold: 0.15 })
      if (ref.current) observer.observe(ref.current)
      return () => observer.disconnect()
    }, [])
    return ref
  }
  
  const heroReveal = useScrollReveal()
  const toolsReveal = useScrollReveal()
  const quickReveal = useScrollReveal()
  const configReveal = useScrollReveal()
  const repoReveal = useScrollReveal()
  const pipelineReveal = useScrollReveal()
  const [stages, setStages] = useState<StageState[]>(INITIAL_STAGES)
  const [activeStage, setActiveStage] = useState<StageId | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [sources, setSources] = useState<SourceMeta[]>([])
  const [configContent, setConfigContent] = useState("")
  const [configFilename, setConfigFilename] = useState("")
  const [quickCheckQuery, setQuickCheckQuery] = useState("")
  const [quickCheckScope, setQuickCheckScope] = useState<QuickCheckScope | null>(null)
  const [repoPath, setRepoPath] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [repoDiffScope, setRepoDiffScope] = useState<RepoDiffScope | null>(null)
  const [uploadedRepoLabel, setUploadedRepoLabel] = useState("")
  const [isRepoDragging, setIsRepoDragging] = useState(false)
  const [isUploadingRepo, setIsUploadingRepo] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runToast, setRunToast] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("findings")
  const abortRef = useRef<AbortController | null>(null)
  const repoInputRef = useRef<HTMLInputElement | null>(null)
  const pipelineSectionRef = useRef<HTMLElement | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("driftcheck-theme")
        : null

    if (stored === "dark" || stored === "light") {
      setTheme(stored)
      return
    }

    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light")
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem("driftcheck-theme", theme)
  }, [theme])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  const updateStage = useCallback((id: StageId, updates: Partial<StageState>) => {
    setStages((prev) => prev.map((stage) => (stage.id === id ? { ...stage, ...updates } : stage)))
  }, [])

  const handleFileContent = useCallback((content: string, filename: string) => {
    setConfigContent(content)
    setConfigFilename(filename)
  }, [])

  const uploadRepoFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    setIsUploadingRepo(true)
    setRunError(null)

    try {
      const formData = new FormData()
      const firstFile = fileArray[0] as File & { webkitRelativePath?: string }
      const firstRelative = firstFile.webkitRelativePath || firstFile.name || "repo-upload"
      const rootName = firstRelative.split("/")[0] || "repo-upload"
      formData.append("rootName", rootName)

      for (const file of fileArray) {
        formData.append("files", file)
      }

      const response = await fetch("/api/repo-upload", {
        method: "POST",
        body: formData,
      })

      const payload = (await response.json().catch(() => null)) as
        | { repoPath?: string; repoLabel?: string; error?: string }
        | null

      if (!response.ok || !payload?.repoPath) {
        throw new Error(payload?.error ?? "Repo upload failed.")
      }

      setRepoPath(payload.repoPath)
      setUploadedRepoLabel(payload.repoLabel ?? rootName)
      setRepoUrl("")
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsUploadingRepo(false)
    }
  }, [])

  const handleRepoFolderChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      await uploadRepoFiles(event.target.files)
    }
  }, [uploadRepoFiles])

  const handleRepoDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsRepoDragging(false)
    if (event.dataTransfer.files?.length) {
      await uploadRepoFiles(event.dataTransfer.files)
    }
  }, [uploadRepoFiles])

  const handleEvent = useCallback((event: PipelineEvent) => {
    switch (event.type) {
      case "STAGE_START":
        updateStage(event.stage, { status: "running", startedAt: event.timestamp })
        setActiveStage(event.stage)
        break
      case "STAGE_PROGRESS":
        break
      case "STAGE_COMPLETE":
        if (event.stage === "discovery") {
          const scope = (
            event.output &&
            typeof event.output === "object" &&
            "scope" in event.output
          )
            ? (event.output as { scope?: QuickCheckScope }).scope ?? null
            : null

          const repoDiff = (
            event.output &&
            typeof event.output === "object" &&
            "repoDiff" in event.output
          )
            ? (event.output as { repoDiff?: RepoDiffScope }).repoDiff ?? null
            : null

          if (scope) {
            setQuickCheckScope(scope)
          }
          if (repoDiff) {
            setRepoDiffScope(repoDiff)
          }
        }

        updateStage(event.stage, {
          status: "complete",
          completedAt: new Date().toISOString(),
          output: event.output,
          usedFallback: event.fallback ?? false,
          fallbackReasons: event.fallbackReasons,
          degradedSources: event.degradedSources,
          feedbackSummary: event.feedbackSummary,
        })
        break
      case "STAGE_ERROR":
        updateStage(event.stage, {
          status: "error",
          error: event.error,
          usedFallback: event.fallback,
          fallbackReasons: event.fallbackReason ? [event.fallbackReason] : undefined,
          degradedSources: event.degradedSources,
        })
        break
      case "PIPELINE_COMPLETE":
        setFindings(Array.isArray(event.findings) ? event.findings.map(sanitizeFinding) : [])
        setSources(Array.isArray(event.sources) ? event.sources.map(sanitizeSource) : [])
        setActiveTab("findings")
        break
      case "PIPELINE_ERROR":
        setRunError(event.error)
        break
    }
  }, [updateStage])

  const showRunToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }
    setRunToast(message)
    toastTimerRef.current = setTimeout(() => setRunToast(null), 3200)
  }, [])

  const focusPipeline = useCallback(() => {
    pipelineSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const runPipeline = useCallback(async (trigger?: "quick-check" | "config-diff" | "repo-diff") => {
    const trimmedQuery = quickCheckQuery.trim()
    const trimmedRepoPath = repoPath.trim()
    const trimmedRepoUrl = repoUrl.trim()

    if (!configContent && !trimmedQuery && !trimmedRepoPath && !trimmedRepoUrl) return

    if (trigger) {
      const modeLabel =
        trigger === "quick-check"
          ? "Quick Check"
          : trigger === "config-diff"
          ? "Config Diff"
          : "Repo Diff"
      showRunToast(`${modeLabel} started. Scrolling to the pipeline…`)
      focusPipeline()
    }

    setIsRunning(true)
    setFindings([])
    setSources([])
    setStages(INITIAL_STAGES)
    setActiveTab("findings")
    setQuickCheckScope(null)
    setRepoDiffScope(null)
    setRunError(null)

    abortRef.current = new AbortController()

    try {
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configContent,
          configFilename,
          quickCheckQuery: trimmedQuery,
          repoPath: trimmedRepoPath || undefined,
          repoUrl: trimmedRepoUrl || undefined,
        }),
        signal: abortRef.current.signal,
      })

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; retryAfterSeconds?: number }
          | null

        const message = payload?.retryAfterSeconds
          ? `${payload.error ?? "Pipeline request failed."} Retry in about ${payload.retryAfterSeconds}s.`
          : payload?.error ?? `Pipeline request failed: ${response.status}`

        throw new Error(message)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          try {
            handleEvent(JSON.parse(raw) as PipelineEvent)
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setRunError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setIsRunning(false)
    }
  }, [configContent, configFilename, focusPipeline, handleEvent, quickCheckQuery, repoPath, repoUrl, showRunToast])

  const hasRunnableInput = Boolean(configContent || quickCheckQuery.trim() || repoPath.trim() || repoUrl.trim())
  const hasEditableBaseline = Boolean(configContent.trim())
  const displayConfigContent =
    configContent ||
    repoDiffScope?.inventorySummary ||
    (quickCheckScope ? buildQuickCheckConfigContent(quickCheckScope) : "")
  const displayConfigFilename =
    configFilename ||
    (repoDiffScope ? "repo-inventory.txt" : quickCheckScope ? "quick-check.txt" : "")
  const quickCheckOnly = Boolean(quickCheckQuery.trim()) && !configContent && !repoPath.trim() && !repoUrl.trim()
  const repoDiffOnly = Boolean(repoPath.trim() || repoUrl.trim()) && !configContent && !quickCheckQuery.trim()
  const diffMode = hasEditableBaseline ? "editable" : "advisory"
  const advisoryTitle = repoPath.trim() || repoUrl.trim()
    ? `Repo recommendations${repoDiffScope?.repoLabel ? ` for ${repoDiffScope.repoLabel}` : ""}`
    : `Quick Check recommendations${quickCheckScope?.selectedSubjects.length ? ` for ${quickCheckScope.selectedSubjects.join(", ")}` : ""}`
  const advisoryDescription = repoPath.trim() || repoUrl.trim()
    ? "This run is based on scanned repo inventory and repo drift signals. DriftCheck is showing repo-level recommendations and targets to inspect, not a literal file patch."
    : "This run is based on your question and authoritative evidence. DriftCheck is showing current setup recommendations, not a literal file patch."

  const selectedStage = stages.find((stage) => stage.id === activeStage) ?? null
  const stageSources = uniqueSources(stages.flatMap((stage) => stage.degradedSources ?? []))
  const runSources = uniqueSources([...sources, ...stageSources])
  const liveSources = runSources.filter((source) => source.status === "live")
  const cachedSources = runSources.filter((source) => source.status === "cached")
  const unavailableSources = runSources.filter((source) => source.status === "unavailable")
  const degradedSources = runSources.filter((source) => source.status !== "live")
  const degradedStages = [...new Set(degradedSources.map((source) => source.stage))]
  const fallbackReasons = [...new Set(degradedSources.flatMap((source) => (
    source.fallback_reason ? [source.fallback_reason] : []
  )))]

  return (
    <main className="min-h-screen overflow-hidden bg-[color:var(--app-bg)] text-[color:var(--app-fg)] transition-colors duration-300 flex flex-col items-center">
      
      {/* Top Nav */}
      <nav className="w-full max-w-[1200px] px-8 py-10 flex justify-between items-center z-10 relative">
        <div className="font-serif text-2xl font-bold tracking-tight">DriftCheck</div>
        <div className="flex gap-8 text-sm uppercase tracking-widest text-[color:var(--app-muted)]">
          <a href="#workbench" className="hover-underline transition-colors hover:text-black">Try it</a>
          <a href={DOC_LINKS[0].href} target="_blank" className="hover-underline transition-colors hover:text-black">Docs</a>
          <a href={DOC_LINKS[1].href} target="_blank" className="hover-underline transition-colors hover:text-black">System</a>
        </div>
      </nav>

      <div className="relative w-full max-w-[1200px] px-6 pb-24 pt-16 flex flex-col items-center text-center">
        {/* HERO SECTION */}
        <section ref={heroReveal} className="reveal-up w-full flex flex-col items-center py-20 pb-40 border-b border-[color:var(--chrome-border)]">
          <div className="space-y-6 flex flex-col items-center">
            <h1 className="max-w-4xl font-serif text-6xl md:text-8xl font-regular leading-[1.05] tracking-tight text-[color:var(--chrome-fg)]">
              Minimal drift checks <br/> for the tools you use.
            </h1>
            <p className="max-w-2xl text-lg leading-relaxed text-[color:var(--app-muted)] mt-6">
              Ask a plain-English question, compare a config, or scan a repo. DriftCheck pulls live source evidence, normalizes it, and tells you what changed before your workflow drifts.
            </p>
          </div>

          <div className="mt-24 relative w-full flex justify-center">
             <div className="relative w-72 h-72 md:w-96 md:h-96 z-10 bouncy-anchor in-view">
               <Image src="/banana_builder.png" alt="Nano Banana Builder" fill className="object-contain drop-shadow-2xl" priority />
             </div>
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-neutral-200 rounded-full blur-3xl opacity-50 -z-10" />
          </div>

          <div className="mt-16 flex justify-center">
            <a href="#workbench" className="inline-flex items-center justify-center px-10 py-5 bg-[#1A1A1A] text-[#F9F9F7] rounded-full text-sm tracking-widest uppercase hover:bg-[#333333] transition-all transform hover:scale-105 active:scale-95 duration-300">
              Run Pipeline
            </a>
          </div>
        </section>

        {/* FEATURE MODES */}
        <section ref={toolsReveal} className="reveal-up w-full flex flex-col items-center py-40 border-b border-[color:var(--chrome-border)]">
          <p className="text-xs uppercase tracking-[0.22em] text-[color:var(--app-muted)] mb-12">Three modes, one pipeline.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl">
            {MODE_COMPARISON.map((row, i) => (
              <div key={row.mode} className={`flex flex-col items-center text-center p-10 border border-[color:var(--chrome-border)] bg-white/40 drop-shadow-sm rounded-3xl delay-${i * 100}`}>
                <h3 className="font-serif text-3xl font-medium mb-4">{row.mode}</h3>
                <p className="text-sm text-[color:var(--app-muted)] leading-relaxed mb-6">{row.bestFor}</p>
                <div className="mt-auto w-full pt-6 border-t border-[color:var(--chrome-border)] text-xs text-[color:var(--app-muted)]">
                  Speed: <span className="text-black">{row.speed}</span> &nbsp;&middot;&nbsp; Input: <span className="text-black">{row.input}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* WORKBENCH SECTION */}
        <section id="workbench" className="w-full flex flex-col items-center py-32 scroll-mt-20">
          <div className="text-center mb-20 max-w-2xl">
            <h2 className="font-serif text-5xl font-medium mb-6">Workbench</h2>
            <p className="text-lg text-[color:var(--app-muted)]">
              Use whichever input matches how you work. Run the pipeline, then inspect the evidence.
            </p>
          </div>

          <div className="w-full max-w-4xl space-y-12">
            
            {/* 1. Quick Check */}
            <div ref={quickReveal} className="reveal-up w-full p-10 md:p-14 border border-[color:var(--chrome-border)] bg-white/50 rounded-3xl shadow-sm text-left relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-2 h-full bg-neutral-200 group-hover:bg-neutral-800 transition-colors" />
              <div className="flex items-center justify-between mb-8">
                <div>
                  <div className="text-xs uppercase tracking-widest text-[color:var(--app-muted)] mb-2">01. Query</div>
                  <h3 className="font-serif text-3xl">Quick Check</h3>
                </div>
                {quickCheckScope && <span className="bg-green-100 text-green-800 text-xs px-3 py-1 rounded-full border border-green-200">Scoped</span>}
              </div>
              <textarea
                value={quickCheckQuery}
                onChange={(event) => setQuickCheckQuery(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !isRunning) {
                    event.preventDefault()
                    void runPipeline("quick-check")
                  }
                }}
                rows={3}
                placeholder="e.g. Is my OpenAI setup up to date?"
                className="w-full resize-none bg-transparent border-b-2 border-neutral-200 focus:border-neutral-800 py-4 text-xl outline-none transition-colors placeholder:text-neutral-400 font-serif"
              />
              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={() => void runPipeline("quick-check")}
                  disabled={!quickCheckQuery.trim() || isRunning}
                  className="px-8 py-3 rounded-full bg-neutral-100 border border-neutral-300 text-sm tracking-widest uppercase hover:bg-neutral-200 disabled:opacity-50 transition-colors"
                >
                  Run Query
                </button>
              </div>
            </div>

            {/* 2. Config Diff */}
            <div ref={configReveal} className="reveal-up w-full p-10 md:p-14 border border-[color:var(--chrome-border)] bg-white/50 rounded-3xl shadow-sm text-left relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-2 h-full bg-neutral-200 group-hover:bg-neutral-800 transition-colors" />
              <div className="flex items-center justify-between mb-8">
                <div>
                  <div className="text-xs uppercase tracking-widest text-[color:var(--app-muted)] mb-2">02. Local state</div>
                  <h3 className="font-serif text-3xl">Config Diff</h3>
                </div>
                {hasEditableBaseline && <span className="bg-blue-100 text-blue-800 text-xs px-3 py-1 rounded-full border border-blue-200">Loaded</span>}
              </div>
              
              <div className="bg-white border border-[color:var(--chrome-border)] rounded-2xl p-6">
                <FileUpload onFileContent={handleFileContent} />
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  type="button"
                  onClick={() => void runPipeline("config-diff")}
                  disabled={!configContent.trim() || isRunning}
                  className="px-8 py-3 rounded-full bg-neutral-100 border border-neutral-300 text-sm tracking-widest uppercase hover:bg-neutral-200 disabled:opacity-50 transition-colors"
                >
                  Run Config Check
                </button>
              </div>
            </div>

            {/* 3. Repo Diff */}
            <div ref={repoReveal} className="reveal-up w-full p-10 md:p-14 border border-[color:var(--chrome-border)] bg-white/50 rounded-3xl shadow-sm text-left relative overflow-hidden group">
              <div className="absolute top-0 left-0 w-2 h-full bg-neutral-200 group-hover:bg-neutral-800 transition-colors" />
              <div className="flex items-center justify-between mb-8">
                <div>
                  <div className="text-xs uppercase tracking-widest text-[color:var(--app-muted)] mb-2">03. Broad scan</div>
                  <h3 className="font-serif text-3xl">Repo Diff</h3>
                </div>
                {repoDiffScope && <span className="bg-purple-100 text-purple-800 text-xs px-3 py-1 rounded-full border border-purple-200">Repo Ready</span>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Local Folder Upload */}
                <div
                  onDrop={(event) => void handleRepoDrop(event)}
                  onDragOver={(event) => { event.preventDefault(); setIsRepoDragging(true); }}
                  onDragLeave={() => setIsRepoDragging(false)}
                  onClick={() => repoInputRef.current?.click()}
                  className={`border border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${isRepoDragging ? 'border-neutral-800 bg-neutral-100' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
                >
                  <input ref={repoInputRef} type="file" multiple {...({ webkitdirectory: "true", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} className="sr-only" onChange={(event) => void handleRepoFolderChange(event)} />
                  <span className="text-sm tracking-widest uppercase text-neutral-500 mb-2">Local Folder</span>
                  <span className="text-xs text-neutral-400 mb-4">(Drop or Click)</span>
                  <span className="text-sm font-medium">
                    {isUploadingRepo ? "Uploading..." : uploadedRepoLabel ? uploadedRepoLabel : "No folder loaded"}
                  </span>
                </div>
                
                {/* GitHub URL */}
                <div className="border border-[color:var(--chrome-border)] bg-white rounded-2xl p-8 flex flex-col justify-center">
                   <span className="text-sm tracking-widest uppercase text-neutral-500 mb-4">GitHub URL</span>
                   <input
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      if (e.target.value.trim()) { setRepoPath(""); setUploadedRepoLabel(""); }
                    }}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isRunning) { e.preventDefault(); void runPipeline("repo-diff"); }
                    }}
                    placeholder="https://github.com/..."
                    className="w-full bg-neutral-100 p-3 rounded-lg text-sm border border-neutral-200 focus:border-neutral-800 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                 type="button"
                 onClick={() => void runPipeline("repo-diff")}
                 disabled={(!repoPath.trim() && !repoUrl.trim()) || isRunning || isUploadingRepo}
                 className="px-8 py-3 rounded-full bg-neutral-100 border border-neutral-300 text-sm tracking-widest uppercase hover:bg-neutral-200 disabled:opacity-50 transition-colors"
                >
                  Run Repo Scan
                </button>
              </div>
            </div>
            
          </div>
        </section>

        {/* PIPELINE & FINDINGS */}
        <section ref={pipelineReveal} className="reveal-up w-full flex flex-col items-center py-20 pb-40">
          
          <div className="w-full max-w-4xl rounded-3xl border border-[color:var(--chrome-border)] bg-white p-8 md:p-12 shadow-sm text-left mb-12">
            <div className="mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b border-[color:var(--chrome-border)] pb-8">
               <div>
                  <h3 className="font-serif text-3xl mb-2">Pipeline Status</h3>
                  <p className="text-[color:var(--app-muted)] text-sm">{isRunning ? "Processing your request..." : hasRunnableInput ? "Ready to run pipeline." : "Waiting for input from the workbench."}</p>
               </div>
               <div className={`px-4 py-2 rounded-full text-xs tracking-widest uppercase font-medium ${isRunning ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'}`}>
                 {isRunning ? "Running" : "Idle"}
               </div>
            </div>
            
            <section ref={pipelineSectionRef}>
              <Pipeline stages={stages} activeStage={activeStage} onStageClick={setActiveStage} />
            </section>
          </div>

          <div className="w-full max-w-4xl text-left">
            <div className="flex gap-4 border-b border-neutral-200 pb-4 mb-8 overflow-x-auto nice-scrollbar">
              {(
                [
                  { id: "findings", label: "Findings", count: findings.length },
                  { id: "diff", label: "Diff View", count: null },
                  { id: "sources", label: "Sources", count: sources.length },
                  { id: "detail", label: "Stage Detail", count: null },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`whitespace-nowrap rounded-full px-6 py-2.5 text-sm uppercase tracking-widest transition-colors ${
                    activeTab === tab.id
                      ? "bg-black text-white"
                      : "bg-transparent text-neutral-500 hover:bg-neutral-100"
                  }`}
                >
                  {tab.label}
                  {tab.count !== null && tab.count > 0 && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] text-white ${activeTab === tab.id ? "bg-white/25 text-white" : "bg-neutral-300"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="min-h-[400px]">
              {activeTab === "findings" && (
                <div className="space-y-6">
                  {findings.length === 0 && !isRunning && (
                    <div className="p-12 text-center text-neutral-400 bg-neutral-50 rounded-3xl border border-neutral-200 border-dashed">
                      No findings yet. Run a check to see results here.
                    </div>
                  )}
                  {findings.length === 0 && isRunning && (
                    <div className="p-12 text-center text-neutral-400 bg-neutral-50 rounded-3xl border border-neutral-200 border-dashed animate-pulse">
                      Analyzing drift signals...
                    </div>
                  )}
                  {findings.map((finding, index) => (
                    <FindingCard key={`${finding.entity}-${index}`} finding={finding} />
                  ))}
                </div>
              )}

              {activeTab === "diff" && (
                <div className="bg-white rounded-3xl overflow-hidden shadow-sm border border-[color:var(--chrome-border)] p-4">
                  <DiffView
                    configContent={displayConfigContent}
                    configFilename={displayConfigFilename}
                    findings={findings}
                    mode={diffMode}
                    advisoryTitle={advisoryTitle}
                    advisoryDescription={advisoryDescription}
                  />
                </div>
              )}

              {activeTab === "sources" && (
                <SourcesPanel sources={sources} findings={findings} resolutionOutput={stages.find((s) => s.id === "resolution")?.output} />
              )}

              {activeTab === "detail" && selectedStage && (
                 <StageDetail stage={selectedStage} />
              )}
              {activeTab === "detail" && !selectedStage && (
                <div className="p-12 text-center text-neutral-400 bg-neutral-50 rounded-3xl border border-neutral-200 border-dashed">
                  Click a pipeline stage to inspect its details and outputs.
                </div>
              )}
            </div>
            
            {(degradedSources.length > 0 || runError) && (
              <div className="mt-12 w-full p-8 border border-neutral-200 bg-white rounded-3xl shadow-sm">
                <h4 className="font-serif text-xl mb-4">Run Health</h4>
                {degradedSources.length > 0 && (
                  <div className="text-sm p-4 bg-yellow-50 text-yellow-900 border border-yellow-200 rounded-2xl mb-4">
                    Some sources were degraded. ({liveSources.length} live, {cachedSources.length} cached, {unavailableSources.length} unavailable).
                    {degradedStages.length > 0 && ` Stages affected: ${degradedStages.join(", ")}`}
                  </div>
                )}
                {runError && (
                  <div className="text-sm p-4 bg-red-50 text-red-900 border border-red-200 rounded-2xl">
                    {runError}
                  </div>
                )}
              </div>
            )}
            
          </div>
        </section>

      </div>
      
      {/* Toast Notification */}
      {runToast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 rounded-full border border-black/10 bg-black/90 px-6 py-3 text-sm text-white shadow-2xl animate-[fade-in-up_0.3s_ease-out]">
          {runToast}
        </div>
      )}
    </main>
  )
}

