"use client"

import { useState, useRef, DragEvent, ChangeEvent } from "react"

interface FileUploadProps {
  onFileContent: (content: string, filename: string) => void
}

const ACCEPTED_EXTENSIONS = [".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".py", ".ts"]

export default function FileUpload({ onFileContent }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [filename, setFilename] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [pasteContent, setPasteContent] = useState("")
  const [pasteFilename, setPasteFilename] = useState("pasted-config.md")
  const [loadingSample, setLoadingSample] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  const isValidFile = (file: File): boolean => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase()
    return ACCEPTED_EXTENSIONS.includes(ext)
  }

  const processFile = (file: File) => {
    setError(null)
    if (!isValidFile(file)) {
      setError(`Unsupported file type. Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`)
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setFilename(file.name)
      setPreview(content.slice(0, 300))
      onFileContent(content, file.name)
    }
    reader.readAsText(file)
  }

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handlePasteSubmit = () => {
    setError(null)
    if (!pasteContent.trim()) {
      setError("Paste area is empty.")
      return
    }
    const name = pasteFilename.trim() || "pasted-config.md"
    setFilename(name)
    setPreview(pasteContent.slice(0, 300))
    onFileContent(pasteContent, name)
  }

  const handleLoadSample = async () => {
    setLoadingSample(true)
    setError(null)
    try {
      const { SAMPLE_CONFIG } = await import("@/fixtures/sample-config")
      const name = "sample-config.txt"
      setFilename(name)
      setPreview(SAMPLE_CONFIG.slice(0, 300))
      setPasteContent(SAMPLE_CONFIG)
      onFileContent(SAMPLE_CONFIG, name)
    } catch {
      setError("Could not load sample. Try uploading manually.")
    } finally {
      setLoadingSample(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-4
          rounded-[24px] border border-dashed px-6 py-10
          cursor-pointer select-none transition-all duration-200
          ${isDragging
            ? "border-cyan-300/50 bg-cyan-400/8 shadow-[0_0_0_1px_rgba(103,232,249,0.18)]"
            : "border-white/10 bg-[#0b1017] hover:border-cyan-400/28 hover:bg-[#0d131d]"
          }
        `}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          className="sr-only"
          onChange={handleFileChange}
        />

        {/* Upload icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-10 w-10 transition-colors duration-200 ${isDragging ? "text-cyan-300" : "text-slate-500"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>

        <div className="text-center">
          <p className="text-sm font-semibold text-slate-100">
            Drop your config file here, or{" "}
            <span className="text-cyan-300 underline underline-offset-2">click to browse</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {ACCEPTED_EXTENSIONS.join("  ")}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleLoadSample()
          }}
          disabled={loadingSample}
          className="
            mt-1 rounded-full border border-white/12 bg-white/[0.04] px-3 py-1.5
            text-xs text-slate-300 transition-colors duration-150
            hover:border-cyan-400/30 hover:bg-cyan-400/10 hover:text-cyan-100
            disabled:cursor-not-allowed disabled:opacity-50
            cursor-pointer
          "
        >
          {loadingSample ? "Loading…" : "Load sample"}
        </button>
      </div>

      {/* Uploaded file preview */}
      {filename && preview !== null && (
        <div className="rounded-[22px] border border-white/10 bg-[#0a0f16] p-4">
          <div className="mb-2 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-semibold text-emerald-300">{filename}</span>
          </div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-400">
            {preview}
            {preview.length >= 300 && (
              <span className="text-slate-600">{"\n\n…(truncated)"}</span>
            )}
          </pre>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-white/10" />
        <span className="text-xs uppercase tracking-[0.18em] text-slate-500">or paste content</span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      {/* Paste area */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="paste-filename" className="shrink-0 text-xs text-slate-400">
            Filename:
          </label>
          <input
            id="paste-filename"
            type="text"
            value={pasteFilename}
            onChange={(e) => setPasteFilename(e.target.value)}
            className="
              w-52 rounded-full border border-white/10 bg-[#0b1017] px-3 py-1.5
              text-xs text-slate-200 placeholder-slate-600
              focus:border-cyan-400/35 focus:outline-none focus:ring-1 focus:ring-cyan-400/20
            "
            placeholder="config.md"
          />
        </div>

        <textarea
          id="paste-content"
          aria-label="Paste config content"
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          rows={8}
          placeholder={"# Paste your AGENTS.md, .cursorrules, or any config file here…"}
          className="
            w-full resize-y rounded-[22px] border border-white/10 bg-[#0b1017]
            px-4 py-3 text-xs text-slate-200 placeholder-slate-600 leading-relaxed
            focus:border-cyan-400/35 focus:outline-none focus:ring-1 focus:ring-cyan-400/20
            transition-colors duration-150
          "
        />

        <button
          type="button"
          onClick={handlePasteSubmit}
          className="
            flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10
            px-4 py-2 text-xs font-semibold text-emerald-200
            hover:border-emerald-400/40 hover:bg-emerald-500/14 hover:text-emerald-100
            cursor-pointer transition-colors duration-150
            focus:outline-none focus:ring-2 focus:ring-emerald-400/20
          "
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Use pasted content
        </button>
      </div>
    </div>
  )
}
