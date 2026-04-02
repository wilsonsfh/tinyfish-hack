import type { TinyFishRequest, TinyFishResponse, TinyFishSSEEvent } from "./types";

const TINYFISH_BASE_URL = "https://agent.tinyfish.ai/v1/automation";
const TINYFISH_TIMEOUT_MS = 120_000;

type TinyFishCallOptions = {
  timeoutMs?: number
}

function getApiKey(): string {
  const key = process.env.TINYFISH_API_KEY;
  if (!key) {
    throw new Error(
      "Missing TINYFISH_API_KEY environment variable. Set it before running the pipeline."
    );
  }
  return key;
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
  };
}

function buildTimeoutSignal(timeoutMs = TINYFISH_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs)
}

/**
 * Synchronous scrape — POSTs to /run and awaits a COMPLETED result.
 */
export async function scrapePage(
  request: TinyFishRequest,
  options: TinyFishCallOptions = {}
): Promise<TinyFishResponse> {
  const apiKey = getApiKey();
  const timeoutMs = options.timeoutMs ?? TINYFISH_TIMEOUT_MS;

  const response = await fetch(`${TINYFISH_BASE_URL}/run`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(request),
    signal: buildTimeoutSignal(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `TinyFish API error: ${response.status} ${response.statusText}`
    );
  }

  const data: TinyFishResponse = await response.json();

  if (data.status === "FAILED") {
    throw new Error(
      `TinyFish scrape FAILED for URL "${request.url}". ` +
        (data.error ? `Reason: ${data.error}` : "No further details provided.")
    );
  }

  if (data.status !== "COMPLETED") {
    throw new Error(
      `TinyFish scrape returned unexpected status "${data.status}" for URL "${request.url}".`
    );
  }

  return data;
}

/**
 * SSE streaming scrape — POSTs to /run-sse and yields parsed events as they arrive.
 * Callers use: for await (const event of scrapePageSSE(request)) { ... }
 */
export async function* scrapePageSSE(
  request: TinyFishRequest,
  options: TinyFishCallOptions = {}
): AsyncGenerator<TinyFishSSEEvent> {
  const apiKey = getApiKey();
  const timeoutMs = options.timeoutMs ?? TINYFISH_TIMEOUT_MS;

  const response = await fetch(`${TINYFISH_BASE_URL}/run-sse`, {
    method: "POST",
    headers: buildHeaders(apiKey),
    body: JSON.stringify(request),
    signal: buildTimeoutSignal(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(
      `TinyFish SSE API error: ${response.status} ${response.statusText}`
    );
  }

  if (!response.body) {
    throw new Error("TinyFish SSE response body is null.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const raw = line.slice("data: ".length).trim();
          if (!raw || raw === "[DONE]") continue;

          try {
            const parsed = JSON.parse(raw);
            yield parsed as TinyFishSSEEvent;
          } catch {
            // Skip malformed lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Normalizes a rejection reason into a descriptive error string.
 * Adds a "TinyFish timeout:" prefix for AbortError/TimeoutError so that
 * classifyTinyFishFallbackReason can correctly categorise them.
 */
function normalizeRejectionError(reason: unknown): string {
  if (reason instanceof Error) {
    if (reason.name === "TimeoutError" || reason.name === "AbortError") {
      return `TinyFish timeout: ${reason.message}`;
    }
    return reason.message;
  }
  return String(reason);
}

/**
 * Parallel scrape — runs multiple scrapePage calls concurrently.
 * Failed requests are returned as { status: "FAILED" } entries rather than throwing.
 */
export async function scrapeParallel(
  requests: TinyFishRequest[],
  options: TinyFishCallOptions = {}
): Promise<TinyFishResponse[]> {
  const results = await Promise.allSettled(requests.map((request) => scrapePage(request, options)));

  return results.map((result) => {
    if (result.status === "fulfilled") {
      return result.value;
    }
    return {
      run_id: "",
      status: "FAILED",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      num_of_steps: 0,
      result: null,
      error: normalizeRejectionError(result.reason),
    } satisfies TinyFishResponse;
  });
}
