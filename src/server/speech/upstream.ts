// Calls to the inference provider (OpenAI-compatible API). The only module that talks to it. Errors carry the provider's
// detail for server logs only; the HTTP layer replaces them with neutral messages.

import { normalizeTranscript } from "./transcript.ts"
import { config } from "./config.ts"

export class UpstreamError extends Error {
  status: number
  detail: string
  constructor(status: number, detail: string) {
    super(`upstream ${status}`)
    this.status = status
    this.detail = detail
  }
}

const auth = () => ({ Authorization: `Bearer ${config.upstream.apiKey}` })

async function fail(res: Response): Promise<never> {
  const detail = await res.text().catch(() => "")
  throw new UpstreamError(res.status, detail.slice(0, 500))
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } }
export type ChatChunk = {
  choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]
}

/** Streams a chat completion with tools; yields parsed SSE chunks. */
export async function* chatStream(opts: { messages: ChatMessage[]; tools: unknown[]; toolChoice: "auto" | "required"; signal: AbortSignal; planningOnly?:boolean }) {
  if(config.inferenceProvider==="anumana"){yield* (await import("./anumana.ts")).chatNative(opts);return}
  const router = config.openRouter.enabled
  if (router && !config.openRouter.apiKey) throw new UpstreamError(503, "OpenRouter chat is not configured")
  const res = await fetch(router ? "https://openrouter.ai/api/v1/chat/completions" : `${config.upstream.baseUrl}/chat/completions`, {
    method: "POST",
    signal: opts.signal,
    redirect: "error",
    headers: { Authorization: `Bearer ${router ? config.openRouter.apiKey : config.upstream.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: router ? config.openRouter.model : config.upstream.chatModel,
      stream: true,
      messages: opts.messages,
      ...(opts.tools.length ? {tools: opts.tools, tool_choice: opts.toolChoice} : {}),
      ...(router
        ? {reasoning: {enabled: false}, temperature: 0.1, max_tokens: 800}
        : {reasoning_effort: "none", temperature: 0.5, max_completion_tokens: 400, parallel_tool_calls: true}),
    }),
  })
  if (!res.ok || !res.body) await fail(res)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  const parse = (line: string): ChatChunk | undefined => {
    const data = line.startsWith("data:") ? line.slice(5).trim() : ""
    if (!data || data === "[DONE]") return
    let chunk: ChatChunk & {error?: unknown}
    try { chunk = JSON.parse(data) } catch { throw new UpstreamError(502, "Invalid completion stream") }
    if (chunk?.error) throw new UpstreamError(502, "Provider returned a completion stream error")
    return chunk
  }
  try {
    while (true) {
      const {done,value} = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, {stream:true})
      if (buffer.length > 256 * 1024) throw new UpstreamError(502,"Completion stream exceeded its limit")
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) { const chunk=parse(line); if(chunk) yield chunk }
      if (done) { const chunk=parse(buffer); if(chunk) yield chunk; break }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

type Segment = { text: string; no_speech_prob?: number; avg_logprob?: number }

// Domain words the recognizer should spell right; also nudges it toward the two supported languages.
const VOCABULARY = "OriginChain, OriginChainDB, Meridian Logistics, ABC, Harbor Pay, Sahyadri, Frankfurt, Mumbai, Virginia, OC-20417, INC-2291. مرحبا، الطلب، الاجتماع."

/** Speech to text with automatic language detection. Drops what the model hears in silence or noise. */
export async function transcribe(wav: Uint8Array, signal: AbortSignal): Promise<{ text: string; language: string | null; durationS: number | null }> {
  if(process.env.STT_PROVIDER==="elevenlabs")return (await import("./elevenlabs.ts")).transcribeEleven(wav,signal)
  if(config.inferenceProvider==="anumana" && process.env.SANSAR_HOSTED_ONLY!=="1")return (await import("./anumana.ts")).transcribeNative(wav,signal)
  const form = new FormData()
  form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "utterance.wav")
  form.append("model", config.upstream.sttModel)
  form.append("response_format", "verbose_json")
  form.append("temperature", "0")
  form.append("prompt", VOCABULARY)
  const res = await fetch(`${config.upstream.baseUrl}/audio/transcriptions`, { method: "POST", signal, headers: auth(), body: form })
  if (!res.ok) await fail(res)
  const data = (await res.json()) as { text?: string; language?: string; duration?: number; segments?: Segment[] }
  const segments = (data.segments ?? []).filter((s) => (s.no_speech_prob ?? 0) < 0.6 && (s.avg_logprob ?? 0) > -1.2)
  const text = (data.segments ? segments.map((s) => s.text).join("") : data.text ?? "").replace(/\s+/g, " ").trim()
  const spoken = /\p{L}/u.test(text) && text !== VOCABULARY ? text : ""
  const language = /arab/i.test(data.language ?? "") ? "ar" : /engl/i.test(data.language ?? "") ? "en" : data.language ?? null
  return { text: normalizeTranscript(spoken), language, durationS: data.duration ?? null }
}

/** One text-to-speech request (input must be short: the models take ~200 characters). Returns WAV bytes. */
export async function speakChunk(input: string, model: string, voice: string, signal: AbortSignal): Promise<Buffer> {
  if((await import("./elevenlabs.ts")).elevenEnabled())return (await import("./elevenlabs.ts")).speakEleven(input,voice,signal)
  if(config.inferenceProvider==="anumana" && process.env.SANSAR_HOSTED_ONLY!=="1")return (await import("./anumana.ts")).speakNative(input,voice,signal)
  const res = await fetch(`${config.upstream.baseUrl}/audio/speech`, {
    method: "POST",
    signal,
    headers: { ...auth(), "Content-Type": "application/json" },
    body: JSON.stringify({ model, voice, input, response_format: "wav" }),
  })
  if (!res.ok) await fail(res)
  return Buffer.from(await res.arrayBuffer())
}
