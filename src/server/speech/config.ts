// TNSA Speech API configuration. Provider details live only here and in upstream.ts; nothing that reaches a client
// (responses, headers, errors, model or voice names) mentions them.

import {modelContext,selectedModel} from "./model-context.ts"
import type { VoiceLang } from "./language.ts"

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean)

export const config = {
  port: Number(process.env.PORT ?? 8787),
  // Bound to localhost in production: only cloudflared (on the same box) can reach it.
  host: process.env.HOST ?? "127.0.0.1",
  /** Keys callers send as `Authorization: Bearer <key>`. Required unless ALLOW_NO_AUTH=1 (local dev only). */
  apiKeys: list(process.env.SPEECH_API_KEYS),
  allowNoAuth: process.env.ALLOW_NO_AUTH === "1",
  /** Requests per minute per key (or per IP without a key). */
  ratePerMinute: Number(process.env.RATE_LIMIT_PER_MIN ?? 240),
  get inferenceProvider(){return modelContext.getStore()?.provider ?? process.env.INFERENCE_PROVIDER ?? "remote"},
  openRouter: {
    enabled: process.env.OPENROUTER_CHAT_ENABLED === "1",
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    model: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  },
  upstream: {
    baseUrl: process.env.UPSTREAM_BASE_URL ?? "https://api.groq.com/openai/v1",
    apiKey: process.env.UPSTREAM_API_KEY ?? "",
    chatModel: process.env.UPSTREAM_CHAT_MODEL ?? "qwen/qwen3.8-27b",
    sttModel: process.env.UPSTREAM_STT_MODEL ?? "whisper-large-v3-turbo",
    ttsModel: {
      en: process.env.UPSTREAM_TTS_MODEL_EN ?? "canopylabs/orpheus-v1-english",
      ar: process.env.UPSTREAM_TTS_MODEL_AR ?? "canopylabs/orpheus-arabic-saudi",
    } as Record<VoiceLang, string>,
  },
}

/** Names clients see. */
export const PUBLIC_MODELS = {
  get agent(){return selectedModel().label},
  get stt(){return selectedModel().id+"-asr"},
  get tts(){return selectedModel().id+"-tts"},
} as const

/** Public TNSA voice names -> language and the upstream voice that speaks them. */
export const VOICES: Record<string, { lang: VoiceLang; upstream: string; label: string }> = {
  maya: { lang: "en", upstream: "diana", label: "Maya (English, female)" },
  ava: { lang: "en", upstream: "hannah", label: "Ava (English, female)" },
  arjun: { lang: "en", upstream: "daniel", label: "Arjun (English, male)" },
  layla: { lang: "ar", upstream: "noura", label: "Layla (Arabic, Saudi, female)" },
  sara: { lang: "ar", upstream: "lulwa", label: "Sara (Arabic, Saudi, female)" },
  faisal: { lang: "ar", upstream: "fahad", label: "Faisal (Arabic, Saudi, male)" },
}

/** Default voice per language when the caller doesn't pick one. */
export const DEFAULT_VOICE: Record<VoiceLang, string> = { en: "maya", ar: "layla" }

if (process.env.NODE_ENV === "production" && (config.allowNoAuth || !config.apiKeys.length)) throw new Error("Production requires SPEECH_API_KEYS and authenticated requests")

const integerSetting = (name: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`)
  return value
}
export const limits = {
  maxConcurrent: integerSetting("MAX_CONCURRENT_REQUESTS", 12, 1, 100),
  perKeyConcurrent: integerSetting("MAX_CONCURRENT_PER_KEY", 8, 1, 50),
  timeoutMs: integerSetting("REQUEST_TIMEOUT_MS", 110000, 1000, 300000),
  ratePerMinute: integerSetting("RATE_LIMIT_PER_MIN", 240, 1, 10000),
}
if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error("Invalid PORT")
if (process.env.NODE_ENV === "production" && config.inferenceProvider!=="anumana" && !config.upstream.apiKey) throw new Error("Production requires UPSTREAM_API_KEY")
if (process.env.NODE_ENV === "production" && config.host !== "127.0.0.1") throw new Error("Production API must bind to loopback behind its tunnel")

if (process.env.NODE_ENV === "production" && process.env.REQUIRE_DATABASE !== "0" && (!process.env.ORIGINCHAIN_BASE_URL || !process.env.ORIGINCHAIN_TOKEN || !process.env.ORIGINCHAIN_TENANT)) throw new Error("Production requires all three OriginChain connection values")
