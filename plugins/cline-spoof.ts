import type { Plugin } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Spoof traffic as Cline CLI to access Cline-only models.
 *
 * Why a local reverse proxy?
 * opencode overrides User-Agent after provider/config headers are applied,
 * so chat.headers / options.headers cannot reliably set a custom UA (e.g.
 * Cline/*).  By pointing the cline provider baseURL at 127.0.0.1:<port>,
 * this proxy rewrites the outbound request with exact Cline CLI headers
 * before forwarding to https://api.cline.bot.
 *
 * API key is read from ~/.config/opencode/.env (CLINE_API_KEY).
 */

const CLIENT_VERSION = "3.0.47"
const CORE_VERSION = "0.2.0"
const USER_AGENT = `Cline/${CLIENT_VERSION}`
const TARGET_ORIGIN = "https://api.cline.bot"
const PREFERRED_PORT = 17323
const PROVIDERS = new Set(["cline", "cline-spoof", "cline-pass"])
// Set CLINE_SPOOF_LOG=1 to write request traces to ~/.config/opencode/logs/
const LOG_ENABLED = process.env.CLINE_SPOOF_LOG === "1"
const LOG_DIR = join(homedir(), ".config/opencode/logs")
const LOG_FILE = join(LOG_DIR, "cline-spoof.log")
const ENV_FILE = join(homedir(), ".config/opencode/.env")

const STATIC_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://cline.bot",
  "X-Title": "Cline",
  "X-IS-MULTIROOT": "false",
  "X-CLIENT-TYPE": "cline-cli",
  "X-CLIENT-VERSION": CLIENT_VERSION,
  "X-PLATFORM": "cli",
  "X-PLATFORM-VERSION": CLIENT_VERSION,
  "X-CORE-VERSION": CORE_VERSION,
  "User-Agent": USER_AGENT,
}

let proxyBaseURL: string | undefined
let server: ReturnType<typeof Bun.serve> | undefined
let logReady: Promise<void> | undefined

/** Simple .env parser (no multiline values, no escapes). */
async function loadEnvFile(path: string): Promise<Record<string, string>> {
  const env: Record<string, string> = {}
  try {
    const content = await Bun.file(path).text()
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      env[key] = value
    }
  } catch {
    // silent — file may not exist
  }
  return env
}

async function log(line: string) {
  if (!LOG_ENABLED) return
  try {
    logReady ??= mkdir(LOG_DIR, { recursive: true }).then(() => undefined)
    await logReady
    await appendFile(LOG_FILE, line + "\n")
  } catch {
    // silent
  }
}

function buildOutboundHeaders(req: Request): Headers {
  const headers = new Headers()

  for (const key of [
    "authorization",
    "content-type",
    "accept",
    "accept-encoding",
  ]) {
    const value = req.headers.get(key)
    if (value) headers.set(key, value)
  }

  for (const [key, value] of Object.entries(STATIC_HEADERS)) {
    headers.set(key, value)
  }

  return headers
}

/**
 * Force the highest available reasoning effort ("xhigh") on every
 * chat-completion request.  glm-5.2 supports low/medium/high/xhigh; we
 * always send xhigh regardless of what opencode selected.
 */
function forceMaxReasoning(body: unknown): unknown {
  if (
    typeof body === "object" &&
    body !== null &&
    "model" in body &&
    typeof (body as Record<string, unknown>).model === "string"
  ) {
    const b = body as Record<string, unknown>
    // The AI SDK openai-compatible provider sends reasoning_effort.
    b.reasoning_effort = "xhigh"
    // Also wipe any budget-based overrides so effort wins.
    delete b.reasoning_budget_tokens
  }
  return body
}

function startProxy(port: number) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    async fetch(req) {
      const incoming = new URL(req.url)
      const target = `${TARGET_ORIGIN}${incoming.pathname}${incoming.search}`
      const headers = buildOutboundHeaders(req)

      let body: ArrayBuffer | undefined
      let bodyModified = false

      if (req.method !== "GET" && req.method !== "HEAD") {
        const contentType = req.headers.get("content-type") || ""
        if (contentType.includes("application/json")) {
          const text = await req.text()
          try {
            const json = JSON.parse(text)
            const modified = forceMaxReasoning(json)
            const modifiedText = JSON.stringify(modified)
            bodyModified = modifiedText !== text
            body = new TextEncoder().encode(modifiedText)
            // Update Content-Length if present
            headers.set("content-length", String(body.byteLength))
          } catch {
            // Not valid JSON — forward raw body
            body = new TextEncoder().encode(text)
          }
        } else {
          body = await req.arrayBuffer()
        }
      }

      if (LOG_ENABLED) {
        const interesting = [...headers.entries()]
          .filter(
            ([k]) =>
              k.startsWith("x-") ||
              k.startsWith("http-") ||
              k === "user-agent" ||
              k === "content-type" ||
              k === "authorization",
          )
          .map(([k, v]) =>
            k === "authorization"
              ? `    ${k}: Bearer <redacted>`
              : `    ${k}: ${v}`,
          )
          .join("\n")
        void log(
          `\n[${new Date().toISOString()}] >>> ${req.method} ${target}${bodyModified ? " [reasoning=xhigh]" : ""}\n${interesting}`,
        )
      }

      const res = await fetch(target, {
        method: req.method,
        headers,
        body,
        // @ts-expect-error bun streaming
        duplex: body ? "half" : undefined,
      })

      if (LOG_ENABLED) {
        void log(`[${new Date().toISOString()}] <<< ${res.status} ${target}`)
      }

      return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      })
    },
  })
}

function ensureProxy(): string {
  if (proxyBaseURL && server) return proxyBaseURL

  try {
    server = startProxy(PREFERRED_PORT)
  } catch {
    server = startProxy(0)
  }

  proxyBaseURL = `http://127.0.0.1:${server.port}/api/v1`
  return proxyBaseURL
}

function ensureProvider(cfg: any, id: string, baseURL: string, apiKey?: string) {
  cfg.provider ??= {}
  cfg.provider[id] ??= {}
  cfg.provider[id].options ??= {}
  cfg.provider[id].options.baseURL = baseURL
  if (apiKey) {
    cfg.provider[id].options.apiKey = apiKey
  }
  cfg.provider[id].options.headers = {
    ...cfg.provider[id].options.headers,
    ...STATIC_HEADERS,
  }
}

export default (async () => {
  const baseURL = ensureProxy()
  const env = await loadEnvFile(ENV_FILE)
  const apiKey = env.CLINE_API_KEY || process.env.CLINE_API_KEY

  return {
    config: async (cfg) => {
      ensureProvider(cfg, "cline", baseURL, apiKey)
      ensureProvider(cfg, "cline-pass", baseURL, apiKey)
      if (cfg.provider?.["cline-spoof"]) {
        ensureProvider(cfg, "cline-spoof", baseURL, apiKey)
      }
    },

    "chat.headers": async (input, output) => {
      if (!PROVIDERS.has(input.model.providerID)) return

      Object.assign(output.headers, STATIC_HEADERS, {
        "X-Task-ID": input.sessionID,
      })
    },
  }
}) satisfies Plugin
