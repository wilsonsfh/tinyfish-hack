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
      setPreview(content.slice(0, 200))
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
    setPreview(pasteContent.slice(0, 200))
    onFileContent(pasteContent, name)
  }

  const handleLoadSample = async () => {
    setLoadingSample(true)
    setError(null)
    try {
      const { SAMPLE_CONFIG } = await import("@/fixtures/sample-config")
      const name = "sample-config.txt"
      setFilename(name)
      setPreview(SAMPLE_CONFIG.slice(0, 200))
      setPasteContent(SAMPLE_CONFIG)
      onFileContent(SAMPLE_CONFIG, name)
    } catch {
      setError("Could not load sample. Try uploading manually.")
    } finally {
      setLoadingSample(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={`
          relative flex flex-col items-center justify-center gap-2
          rounded-2xl border border-dashed px-4 py-5
          cursor-pointer select-none transition-all duration-200
          ${isDragging
            ? "border-cyan-400/50 bg-cyan-50"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-400 hover:bg-neutral-100"
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

        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-7 w-7 transition-colors duration-200 ${isDragging ? "text-cyan-500" : "text-neutral-400"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>

        <div className="text-center">
          <p className="text-sm font-medium text-neutral-700">
            Drop a file or{" "}
            <span className="text-cyan-600 underline underline-offset-2">click to browse</span>
          </p>
          <p className="mt-0.5 text-[10px] text-neutral-400">
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
            rounded-full border border-neutral-200 bg-white px-3 py-1
            text-xs text-neutral-500 transition-colors duration-150
            hover:border-neutral-300 hover:text-neutral-700
            disabled:cursor-not-allowed disabled:opacity-50
            cursor-pointer
          "
        >
          {loadingSample ? "Loading…" : "Load sample"}
        </button>
      </div>

      {/* Uploaded file preview */}
      {filename && preview !== null && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-xs font-semibold text-emerald-700">{filename}</span>
          </div>
          <pre className="overflow-hidden whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-emerald-800/70 max-h-16">
            {preview}
            {preview.length >= 200 && (
              <span className="text-emerald-600/50">{"\n…"}</span>
            )}
          </pre>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </p>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-neutral-400">or paste</span>
        <div className="h-px flex-1 bg-neutral-200" />
      </div>

      {/* Paste area */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="paste-filename" className="shrink-0 text-[10px] uppercase tracking-widest text-neutral-400">
            Filename:
          </label>
          <input
            id="paste-filename"
            type="text"
            value={pasteFilename}
            onChange={(e) => setPasteFilename(e.target.value)}
            className="
              flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5
              text-xs text-neutral-700 placeholder-neutral-400
              focus:border-neutral-400 focus:outline-none
            "
            placeholder="config.md"
          />
        </div>

        <textarea
          id="paste-content"
          aria-label="Paste config content"
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          rows={4}
          placeholder={"Paste AGENTS.md, .cursorrules, or any config here…"}
          className="
            w-full resize-none rounded-xl border border-neutral-200 bg-neutral-50
            px-3 py-2.5 text-xs text-neutral-700 placeholder-neutral-400 leading-relaxed
            focus:border-neutral-400 focus:outline-none
            transition-colors duration-150
          "
        />

        <button
          type="button"
          onClick={handlePasteSubmit}
          className="
            flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50
            px-3 py-1.5 text-xs font-medium text-emerald-700
            hover:border-emerald-300 hover:bg-emerald-100
            cursor-pointer transition-colors duration-150
            focus:outline-none focus:ring-2 focus:ring-emerald-400/20
          "
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Use pasted content
        </button>
      </div>
    </div>
  )
}
