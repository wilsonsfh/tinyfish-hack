import { promises as fs } from "fs"
import { tmpdir } from "os"
import { basename, dirname, join, normalize } from "path"
import { NextResponse } from "next/server"
import { acquireRateLimit } from "@/lib/rate-limit"

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
}

function safeRelativePath(value: string): string {
  const normalized = normalize(value).replace(/^(\.\.(\/|\\|$))+/, "")
  if (!normalized || normalized.startsWith("..")) {
    throw new Error(`Unsafe file path: ${value}`)
  }
  return normalized
}

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimit = acquireRateLimit(request, "repo-upload", {
    windowMs: 2 * 60 * 1000,
    maxRequests: 8,
    maxConcurrent: 2,
  })

  if (rateLimit.response) {
    return rateLimit.response as NextResponse
  }

  try {
    const formData = await request.formData()
    const rootName = typeof formData.get("rootName") === "string"
      ? String(formData.get("rootName")).trim()
      : "repo-upload"
    const fileEntries = formData.getAll("files")

    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "No files uploaded." }, { status: 400 })
    }

    const tempDir = await fs.mkdtemp(join(tmpdir(), "driftcheck-upload-"))
    const rootDir = join(tempDir, basename(rootName) || "repo-upload")

    await fs.mkdir(rootDir, { recursive: true })

    // Pre-create all unique directories in one pass before parallel writes
    const dirs = new Set<string>()
    const validEntries: Array<{ file: File; targetPath: string }> = []
    for (const entry of fileEntries) {
      if (!(entry instanceof File)) continue
      const relativePath = safeRelativePath(entry.webkitRelativePath || entry.name)
      const targetPath = join(rootDir, relativePath)
      dirs.add(dirname(targetPath))
      validEntries.push({ file: entry, targetPath })
    }
    await Promise.all([...dirs].map((d) => fs.mkdir(d, { recursive: true })))

    // Write all files in parallel (batched to avoid fd exhaustion)
    const BATCH = 64
    for (let i = 0; i < validEntries.length; i += BATCH) {
      await Promise.all(
        validEntries.slice(i, i + BATCH).map(async ({ file, targetPath }) => {
          const buffer = Buffer.from(await file.arrayBuffer())
          await fs.writeFile(targetPath, buffer)
        })
      )
    }

    return NextResponse.json({
      repoPath: rootDir,
      repoLabel: basename(rootDir),
      uploadedFiles: fileEntries.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    )
  } finally {
    rateLimit.lease?.release()
  }
}
