import type { Plugin } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { appendFile, mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Spoof xAI traffic as grok-build (grok-shell).
 *
 * Why a local reverse proxy?
 * opencode overrides User-Agent to `opencode/<version>` after provider/config
 * headers are applied, so chat.headers / options.headers cannot set a custom
 * UA (e.g. grok-shell/*). See:
 *   https://github.com/anomalyco/opencode/issues/24594
 * The bundled xai OAuth plugin also forces UA in its custom fetch
 * (packages/opencode/src/plugin/xai.ts).
 *
 * Fix: point the xai provider baseURL at 127.0.0.1:<port>; this proxy rewrites
 * the outbound request (User-Agent + x-grok-* headers) to
 * https://cli-chat-proxy.grok.com.
 */

const CLIENT_VERSION = "0.2.101"
const USER_AGENT = `grok-shell/${CLIENT_VERSION} (linux; x86_64)`
const TARGET_ORIGIN = "https://cli-chat-proxy.grok.com"
const PREFERRED_PORT = 17322
const PROVIDERS = new Set(["xai", "grok-build-spoof"])
// Set GROK_BUILD_SPOOF_LOG=1 to write request traces to ~/.config/opencode/logs/
const LOG_ENABLED = process.env.GROK_BUILD_SPOOF_LOG === "1"
const LOG_DIR = join(homedir(), ".config/opencode/logs")
const LOG_FILE = join(LOG_DIR, "grok-build-spoof.log")

const STATIC_HEADERS: Record<string, string> = {
  "x-grok-client-identifier": "grok-shell",
  "x-grok-client-mode": "interactive",
  "x-grok-client-version": CLIENT_VERSION,
  "x-xai-token-auth": "xai-grok-cli",
  "x-authenticateresponse": "authenticate-response",
  "User-Agent": USER_AGENT,
}

type SessionState = {
  convId: string
  sessionId: string
  turn: number
}

const sessions = new Map<string, SessionState>()
let proxyBaseURL: string | undefined
let server: ReturnType<typeof Bun.serve> | undefined
let logReady: Promise<void> | undefined

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
    "x-session-affinity",
    "x-session-id",
    "x-grok-conv-id",
    "x-grok-req-id",
    "x-grok-session-id",
    "x-grok-agent-id",
    "x-grok-turn-idx",
    "x-grok-model-override",
  ]) {
    const value = req.headers.get(key)
    if (value) headers.set(key, value)
  }

  for (const [key, value] of Object.entries(STATIC_HEADERS)) {
    headers.set(key, value)
  }

  if (!headers.has("x-grok-req-id")) headers.set("x-grok-req-id", randomUUID())
  if (!headers.has("x-grok-conv-id")) headers.set("x-grok-conv-id", randomUUID())
  if (!headers.has("x-grok-session-id")) headers.set("x-grok-session-id", randomUUID())
  if (!headers.has("x-grok-agent-id")) headers.set("x-grok-agent-id", randomUUID())
  if (!headers.has("x-grok-turn-idx")) headers.set("x-grok-turn-idx", "1")

  return headers
}

function startProxy(port: number) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    // Streaming model responses idle between chunks longer than Bun's default 10s.
    idleTimeout: 0,
    async fetch(req) {
      const incoming = new URL(req.url)
      const target = `${TARGET_ORIGIN}${incoming.pathname}${incoming.search}`
      const headers = buildOutboundHeaders(req)
      const body =
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await req.arrayBuffer()

      if (LOG_ENABLED) {
        const interesting = [...headers.entries()]
          .filter(
            ([k]) =>
              k.startsWith("x-") ||
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
          `\n[${new Date().toISOString()}] >>> ${req.method} ${target}\n${interesting}`,
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

  proxyBaseURL = `http://127.0.0.1:${server.port}/v1`
  return proxyBaseURL
}

function ensureProvider(cfg: any, id: string, baseURL: string) {
  cfg.provider ??= {}
  cfg.provider[id] ??= {}
  cfg.provider[id].options ??= {}
  cfg.provider[id].options.baseURL = baseURL
  cfg.provider[id].options.headers = {
    ...cfg.provider[id].options.headers,
    ...STATIC_HEADERS,
  }
}

export default (async () => {
  const baseURL = ensureProxy()

  return {
    config: async (cfg) => {
      ensureProvider(cfg, "xai", baseURL)
      if (cfg.provider?.["grok-build-spoof"]) {
        ensureProvider(cfg, "grok-build-spoof", baseURL)
      }
    },

    "chat.headers": async (input, output) => {
      if (!PROVIDERS.has(input.model.providerID)) return

      let state = sessions.get(input.sessionID)
      if (!state) {
        state = {
          convId: randomUUID(),
          sessionId: randomUUID(),
          turn: 0,
        }
        sessions.set(input.sessionID, state)
      }
      state.turn += 1

      const modelId =
        (input.model as { api?: { id?: string } }).api?.id ?? input.model.id

      Object.assign(output.headers, STATIC_HEADERS, {
        "x-grok-conv-id": state.convId,
        "x-grok-req-id": randomUUID(),
        "x-grok-session-id": state.sessionId,
        "x-grok-agent-id": randomUUID(),
        "x-grok-turn-idx": String(state.turn),
        "x-grok-model-override": modelId,
      })
    },
  }
}) satisfies Plugin
