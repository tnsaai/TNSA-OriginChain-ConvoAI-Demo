"use client"

// Client side of the Realtime Voice playground.
// Audio in:  echo-cancelled mic -> voice-activity detection (turn detection) -> TNSA STT with automatic language
//            detection, called for live partials while the user talks and once for the final transcript.
// Agent:     POST /api/speech/agent/turn, read the SSE stream of text deltas and tool-call events.
// Audio out: text deltas are cut into sentences and spoken as they arrive, so speech starts before the turn ends.
// Barge-in:  user speech while the agent is talking ducks it at once and stops it when TNSA STT confirms new words.

import { useCallback, useEffect, useRef, useState } from "react"
import { ensureAudioRunning, canReuseTranscript, createAudioLimiter, type TranscriptRequest } from "@/lib/voice-performance"
import type { VoiceLang } from "@/lib/realtime/voices"
import { replyLang, scriptLang } from "@/lib/realtime/language"

export type Phase = "idle" | "connecting" | "listening" | "thinking" | "speaking"

export type ToolCallView = {
  callId: string
  name: string
  args: Record<string, unknown>
  status: "running" | "done" | "error" | "cancelled"
  summary?: string
  result?: unknown
  ms?: number
  startedAt: number
}

export type TurnView = {
  id: string
  index: number
  userText: string
  startedAt: number
  status: "streaming" | "done" | "interrupted" | "error"
  mode?: "model" | "mock"
  firstTextMs?: number
  firstAudioMs?: number
  totalMs?: number
  tools: ToolCallView[]
  events: { at: number; label: string }[]
  error?: string
}

export type MessageView = {
  id: string
  turnId: string
  role: "user" | "assistant"
  text: string
  /** Character ranges of the assistant text that were narration spoken while tools ran. */
  narration?: [number, number][]
  spokenChars?: number
  interrupted?: boolean
  streaming?: boolean
}

export type Levels = { level: number; bass: number; treble: number }

/** One user utterance being captured from the mic. */
type Utterance = {
  transcriptRequest?: TranscriptRequest
  chunks: Float32Array[]
  rate: number
  startedAt: number
  voicedMs: number
  silentMs: number
  /** The agent was audible at some point while this was captured (echo is possible). */
  duringPlayback: boolean
  /** TNSA STT confirmed it is the user talking over the agent. */
  confirmed: boolean
  discard: boolean
  lastInterimAt: number
  interimBusy: boolean
  /** Time spent clearly louder than the agent's leftover echo (fast barge-in). */
  loudMs: number
  /** Loudest block so far, to learn the echo level if this turns out to be the agent. */
  maxRms: number
}

/** Silence that ends the user's turn. */
const ENDPOINT_MS = 350
const ECHO_TAIL_MS = 1600
/** Shorter than this is a cough or a click, not a turn. */
const MIN_SPEECH_MS = 300
const INTERIM_EVERY_MS = 500
const MAX_UTTERANCE_MS = 20000
/** ~340 ms of audio kept from before speech was detected, so the first syllable isn't cut. */
const PREROLL_BLOCKS = 8
const STT_RATE = 16000
/** Talking over the agent must last this long, with new words, before the agent stops. */
const BARGE_IN_MIN_MS = 350
/** This much voice far louder than the agent's echo (within 1.5 s) stops it without waiting for a transcript. */
const LOUD_BARGE_IN_MS = 250
/** Recent blocks (~430 ms) over which speech onset is counted. */
const ONSET_WINDOW_BLOCKS = 10

type VadState = {
  floor: number
  /** Loudest recent leftover echo of the agent (learned during playback). */
  echoPeak: number
  spikeMax: number
  above: number
  hits: number[]
  loudHits: number[]
  heardMs: number
  preroll: Float32Array[]
}
const newVad = (): VadState => ({ floor: 0, echoPeak: 0, spikeMax: 0, above: 0, hits: [], loudHits: [], heardMs: 0, preroll: [] })

/** Playback the detector must hear before it trusts its echo level for a fast barge-in. */
const ECHO_CALIBRATION_MS = 1500
/** What TNSA STT typically invents from faint noise or echo; never a turn on its own. */
const STT_FILLER = /^(thank you\.?|thanks( for watching)?\.?|you\.?|bye\.?|okay\.?|ok\.?|so\.?|hmm+\.?|شكرا(ً)?\.?|شكراً لكم\.?|اشتركوا في القناة\.?|\.+)$/i

/** Mono PCM blocks -> 16 kHz 16-bit WAV for TNSA STT. */
function encodeWav(chunks: Float32Array[], rate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const ratio = rate / STT_RATE
  const n = Math.floor(total / ratio)
  const view = new DataView(new ArrayBuffer(44 + n * 2))
  const text = (o: number, s: string) => [...s].forEach((ch, i) => view.setUint8(o + i, ch.charCodeAt(0)))
  text(0, "RIFF")
  view.setUint32(4, 36 + n * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, STT_RATE, true)
  view.setUint32(28, STT_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, n * 2, true)
  // Flatten, then downsample by averaging each window of source samples.
  const all = new Float32Array(total)
  let at = 0
  for (const c of chunks) {
    all.set(c, at)
    at += c.length
  }
  for (let i = 0; i < n; i++) {
    const from = Math.floor(i * ratio)
    const to = Math.min(total, Math.floor((i + 1) * ratio))
    let s = 0
    for (let j = from; j < to; j++) s += all[j]
    const v = Math.max(-1, Math.min(1, s / Math.max(1, to - from)))
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  return new Blob([view.buffer], { type: "audio/wav" })
}
const GREETING = "Hi, I'm the OriginChain voice agent. Ask me about orders, cluster health, the calendar or pricing, and I'll check while we talk."

const GREETING_AR = "هلا، أنا مساعد OriginChain الصوتي. اسألني عن الطلبات أو حالة الخوادم أو المواعيد، وأنا أتحقق لك وأنا أكلمك."
/** TNSA TTS takes at most 200 characters per request; leave room for trimming. */
const TTS_SAFE_CHARS = 190

/** Cuts text into pieces under the TTS limit, preferring commas (including Arabic ،) and then spaces. */
function splitForTts(text: string): string[] {
  const out: string[] = []
  let rest = text
  while (rest.trim().length > TTS_SAFE_CHARS) {
    const window = rest.slice(0, TTS_SAFE_CHARS)
    const at = Math.max(window.lastIndexOf("، "), window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "))
    const cut = at > 60 ? at + 2 : window.lastIndexOf(" ") > 60 ? window.lastIndexOf(" ") + 1 : TTS_SAFE_CHARS
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  if (rest.trim()) out.push(rest)
  return out
}

/** English by default (TNSA TTS English, Diana); Arabic text switches to TNSA TTS Arabic (Noura), even mid-sentence. */
const VOICE_FOR: Record<VoiceLang, string> = { en: "maya", ar: "layla" }

const ARABIC_LETTER = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
const LATIN_LETTER = /[A-Za-z]/

/**
 * Splits text into consecutive runs of one script so each run can go to the matching TTS model:
 * "Your order حاضر وصل الحين, ETA Friday." -> ["Your order ", "حاضر وصل الحين, ", "ETA Friday."].
 * Digits and punctuation stay with the run they follow. Whitespace is kept, so the runs join back to the input.
 */
function scriptRuns(text: string): { lang: VoiceLang; text: string }[] {
  const runs: { lang: VoiceLang; text: string }[] = []
  for (const token of text.match(/\s*\S+\s*/g) ?? [text]) {
    const lang: VoiceLang | null = ARABIC_LETTER.test(token) ? "ar" : LATIN_LETTER.test(token) ? "en" : null
    const last = runs[runs.length - 1]
    if (last && (lang === null || lang === last.lang)) last.text += token
    else runs.push({ lang: lang ?? "en", text: token })
  }
  // A neutral first token ("2026 ...") takes the language of what follows it.
  if (runs.length > 1 && !ARABIC_LETTER.test(runs[0].text) && !LATIN_LETTER.test(runs[0].text)) {
    runs[1].text = runs[0].text + runs[1].text
    runs.shift()
  }
  // Runs under three words (an order id or one borrowed word) stay in the surrounding voice instead of flipping.
  for (let i = 0; i < runs.length && runs.length > 1; ) {
    if (runs[i].text.trim().split(/\s+/).length >= MIN_SWITCH_WORDS) {
      i++
      continue
    }
    const into = i > 0 ? i - 1 : i + 1
    runs[into].text = i > 0 ? runs[into].text + runs[i].text : runs[i].text + runs[into].text
    runs.splice(i, 1)
    // Neighbours of the same language are now adjacent: join them.
    const j = Math.max(0, i - 1)
    if (runs[j + 1] && runs[j].lang === runs[j + 1].lang) {
      runs[j].text += runs[j + 1].text
      runs.splice(j + 1, 1)
    }
    i = 0
  }
  return runs
}

const MIN_SWITCH_WORDS = 3

/** TNSA TTS ends every clip with up to ~0.9 s of silence; trim it so voice switches and sentence joins sound continuous. */
function trimTrailingSilence(ctx: AudioContext, buffer: AudioBuffer, keepMs = 90): AudioBuffer {
  const data = buffer.getChannelData(0)
  let last = data.length - 1
  while (last > 0 && Math.abs(data[last]) < 0.012) last--
  const length = Math.min(data.length, last + Math.round((keepMs / 1000) * buffer.sampleRate))
  if (length >= data.length - 1) return buffer
  const out = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate)
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(0, length), c)
  return out
}

const uid = () => Math.random().toString(36).slice(2, 10)
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
export function useRealtimeVoice() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [messages, setMessages] = useState<MessageView[]>([])
  const [turns, setTurns] = useState<TurnView[]>([])
  const [userDraft, setUserDraft] = useState("")
  const [micMuted, setMicMuted] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const ttsLimiter = useRef(createAudioLimiter(3))
  const [notice, setNotice] = useState<string | null>(null)
  const [srSupported, setSrSupported] = useState(true)
  // Language follows the conversation: the agent answers in the user's language, each sentence is voiced by the
  // TNSA TTS model for its script (English or Arabic), and speech recognition follows the user's last language.
  const [lang, setLangState] = useState<VoiceLang>("en")
  const langRef = useRef<VoiceLang>("en")
  const ttsUnavailable = useRef<Record<VoiceLang, boolean>>({ en: false, ar: false })
  const outCtxRef = useRef<AudioContext | null>(null)
  const outAnalyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)

  const levels = useRef<Levels>({ level: 0, bass: 0, treble: 0 })
  const phaseRef = useRef<Phase>("idle")
  const messagesRef = useRef<MessageView[]>([])
  const voiceOnRef = useRef(true)
  const micMutedRef = useRef(false)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const procRef = useRef<ScriptProcessorNode | null>(null)
  const rafRef = useRef<number>(0)
  const activeRef = useRef(false)

  // Speech in: noise floor and pre-roll for the voice detector, the utterance being captured, and stable entry points
  // for the audio callback (it is created once per session).
  const vadRef = useRef<VadState>(newVad())
  /** Live mic level (0..1) for the meter under the orb. */
  const inputLevel = useRef(0)
  const utteranceRef = useRef<Utterance | null>(null)
  const onMicBlockRef = useRef<(block: Float32Array, rate: number) => void>(() => {})
  const runTurnRef = useRef<(text: string) => Promise<void>>(async () => {})
  const outGainRef = useRef<GainNode | null>(null)

  const response = useRef<{
    turnId: string
    msgId: string
    abort: AbortController
    text: string
    pending: string
    /** Sentences waiting to be spoken, each with its audio already being fetched. */
    queue: { text: string; audio: Promise<AudioBuffer | null> }[]
    spoken: number
    streamDone: boolean
    speaking: boolean
    /** The sentence being spoken and the one before it: what the mic may hear back as echo. */
    recent: string
  } | null>(null)
  const speakPulse = useRef(0)
  // Chrome can garbage-collect an utterance mid-sentence and never fire onend, so keep a reference until it finishes.
  const liveUtterances = useRef(new Set<SpeechSynthesisUtterance>())
  // Echo control: what the agent said recently (across turns), when its audio last played, and when the
  // echo-cancelled mic last carried real voice energy.
  const echoText = useRef("")
  const lastAudioAt = useRef(0)

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])
  useEffect(() => {
    voiceOnRef.current = voiceOn
  }, [voiceOn])
  useEffect(() => {
    micMutedRef.current = micMuted
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !micMuted))
  }, [micMuted])

  const patchTurn = useCallback((id: string, fn: (t: TurnView) => TurnView) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t)))
  }, [])
  const patchMessage = useCallback((id: string, fn: (m: MessageView) => MessageView) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? fn(m) : m)))
  }, [])
  const logEvent = useCallback(
    (turnId: string, label: string) => patchTurn(turnId, (t) => ({ ...t, events: [...t.events, { at: Date.now(), label }] })),
    [patchTurn]
  )

  // ---- Levels for the orb ---------------------------------------------------------------------------------------
  const tick = useCallback(() => {
    const a = analyserRef.current
    const target: Levels = { level: 0, bass: 0, treble: 0 }
    const out = outAnalyserRef.current
    if (phaseRef.current === "speaking" && out && sourceRef.current) {
      // Real output level of the TNSA TTS audio that is playing.
      const data = new Uint8Array(out.frequencyBinCount)
      out.getByteFrequencyData(data)
      const band = (from: number, to: number) => {
        let s = 0
        for (let i = from; i < to; i++) s += data[i]
        return s / ((to - from) * 255)
      }
      target.level = Math.min(1, band(2, 48) * 2.6)
      target.bass = Math.min(1, band(1, 10) * 2.2)
      target.treble = Math.min(1, band(32, 96) * 3.2)
    } else if (phaseRef.current === "speaking") {
      const t = performance.now() / 1000
      speakPulse.current *= 0.9
      const v = 0.32 + 0.22 * Math.abs(Math.sin(t * 7.3)) * Math.abs(Math.sin(t * 2.1)) + speakPulse.current
      target.level = Math.min(1, v)
      target.bass = target.level * 0.8
      target.treble = target.level * 0.45
    } else if (a && !micMutedRef.current) {
      const data = new Uint8Array(a.frequencyBinCount)
      a.getByteFrequencyData(data)
      const band = (from: number, to: number) => {
        let s = 0
        for (let i = from; i < to; i++) s += data[i]
        return s / ((to - from) * 255)
      }
      target.level = Math.min(1, band(2, 48) * 2.4)
      target.bass = Math.min(1, band(1, 10) * 2.2)
      target.treble = Math.min(1, band(32, 96) * 3)
    } else if (phaseRef.current === "thinking") {
      target.level = 0.12 + 0.06 * Math.sin(performance.now() / 260)
    }
    levels.current = target
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // ---- Speech out ---------------------------------------------------------------------------------------------
  // Each sentence is synthesised by NGenTTS-V2 (TNSA speech service) as soon as it is complete, while earlier sentences play,
  // and played through Web Audio so the orb follows the real output level. The browser voice is a per-sentence fallback.
  const outCtx = useCallback(() => {
    if (!outCtxRef.current || outCtxRef.current.state === "closed") {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      // Volume control after the analyser, so ducking during barge-in doesn't flatten the orb.
      const gain = ctx.createGain()
      analyser.connect(gain).connect(ctx.destination)
      outCtxRef.current = ctx
      outAnalyserRef.current = analyser
      outGainRef.current = gain
    }
    if (outCtxRef.current.state !== "running") void outCtxRef.current.resume().catch(() => setAudioBlocked(true))
    return outCtxRef.current
  }, [])

  const synthesize = useCallback(
    async (text: string, lang: VoiceLang, signal: AbortSignal): Promise<AudioBuffer | null> => {
      if (!voiceOnRef.current || ttsUnavailable.current[lang]) return null
      let release: (() => void) | undefined
      try {
        release = await ttsLimiter.current(signal)
        const res = await fetch("/api/speech/audio/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: text, voice: VOICE_FOR[lang], language: lang }),
          signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          // Configuration problems (terms not accepted, no key) won't fix themselves mid-session: stop asking.
          if (res.status === 400 || res.status === 401 || res.status === 403) {
            ttsUnavailable.current[lang] = true
            setNotice("The speech service is unavailable. Retrying playback with your browser voice.")
          }
          return null
        }
        const ctx = outCtx()
        return trimTrailingSilence(ctx, await ctx.decodeAudioData(await res.arrayBuffer()))
      } catch {
        if (!signal.aborted) setNotice("Could not load speech audio. Trying your browser voice.")
        return null
      } finally { release?.() }
    },
    [outCtx]
  )

  const pickVoice = useCallback((lang: VoiceLang) => {
    const voices = typeof window !== "undefined" ? window.speechSynthesis?.getVoices() ?? [] : []
    const want = lang === "ar" ? /^ar/i : /^en/i
    const good = /natural|neural|online/i
    return (
      voices.find((v) => want.test(v.lang) && good.test(v.name) && (lang === "ar" || /en-IN/i.test(v.lang))) ??
      voices.find((v) => want.test(v.lang) && good.test(v.name)) ??
      voices.find((v) => want.test(v.lang))
    )
  }, [])

  const finishIfDrained = useCallback(() => {
    const r = response.current
    if (!r || !r.streamDone || r.speaking || r.queue.length || r.pending.trim()) return
    patchMessage(r.msgId, (m) => ({ ...m, streaming: false, spokenChars: r.text.length }))
    response.current = null
    lastAudioAt.current = Date.now()
    if (activeRef.current) setPhase("listening")
    else setPhase("idle")
  }, [patchMessage])

  const speakNext = useCallback(() => {
    const r = response.current
    if (!r || r.speaking) return
    const item = r.queue.shift()
    const sentence = item?.text
    if (!item || !sentence) {
      // Narration is spoken but tools are still running: show that the agent is working, not talking.
      if (!r.streamDone) setPhase("thinking")
      return finishIfDrained()
    }
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      clearTimeout(watchdog)
      lastAudioAt.current = Date.now()
      if (response.current !== r) return
      r.speaking = false
      r.spoken += sentence.length
      patchMessage(r.msgId, (m) => ({ ...m, spokenChars: r.spoken }))
      speakNext()
    }
    const markAudio = () => {
      setPhase("speaking")
      patchTurn(r.turnId, (t) => (t.firstAudioMs != null ? t : { ...t, firstAudioMs: Date.now() - t.startedAt }))
    }
    r.speaking = true
    r.recent = `${r.recent.split("\u0000").pop() ?? ""}\u0000${sentence}`
    // Remember the last few sentences across turns: the recognizer can deliver them late.
    echoText.current = `${echoText.current} ${sentence}`.slice(-600)
    let watchdog: ReturnType<typeof setTimeout> | undefined

    const speakWithBrowser = () => {
      // Watchdog: if the browser never reports the end of this sentence, move on instead of hanging in "speaking".
      watchdog = setTimeout(() => {
        window.speechSynthesis?.cancel()
        done()
      }, 3000 + sentence.length * 110)
      if (!voiceOnRef.current || typeof window === "undefined" || !window.speechSynthesis) {
        markAudio()
        setTimeout(done, Math.min(2200, 40 * sentence.length))
        return
      }
      const u = new SpeechSynthesisUtterance(sentence)
      const sentenceLang = scriptLang(sentence)
      const v = pickVoice(sentenceLang)
      if (v) u.voice = v
      u.lang = sentenceLang === "ar" ? "ar-SA" : "en-IN"
      u.rate = 1.06
      liveUtterances.current.add(u)
      const end = () => {
        liveUtterances.current.delete(u)
        done()
      }
      u.onstart = markAudio
      u.onboundary = () => (speakPulse.current = 0.28)
      u.onend = end
      u.onerror = (event) => {
        if (event.error !== "canceled" && event.error !== "interrupted") { setAudioBlocked(true); setNotice("Your browser could not play speech. Select Enable sound and try again.") }
        end()
      }
      // Chrome sometimes leaves the engine paused after cancel(); resume before queueing.
      window.speechSynthesis.resume()
      window.speechSynthesis.speak(u)
    }

    void item.audio.then(async (buffer) => {
      if (response.current !== r) return
      if (!buffer || !voiceOnRef.current) return speakWithBrowser()
      const ctx = outCtx()
      await ensureAudioRunning(ctx)
      if (response.current !== r) return
      setAudioBlocked(false)
      outGainRef.current?.gain.setTargetAtTime(1, ctx.currentTime, 0.01)
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(outAnalyserRef.current!)
      sourceRef.current = source
      source.onended = () => {
        if (sourceRef.current === source) sourceRef.current = null
        done()
      }
      watchdog = setTimeout(done, buffer.duration * 1000 + 1500)
      markAudio()
      source.start()
    }).catch(() => {
      if (response.current !== r) return
      setAudioBlocked(true)
      setNotice("Audio output was blocked. Select Enable sound, then try again.")
      done()
    })
  }, [finishIfDrained, outCtx, patchMessage, patchTurn, pickVoice])

  /** Moves complete sentences from the pending buffer to the speech queue. */
  const flushSentences = useCallback(
    (all: boolean) => {
      const r = response.current
      if (!r) return
      const re = /^[\s\S]*?(?:[.!?؟…](?:["')\]»]*)(?:\s+|$)|\n+)/
      // Each sentence is cut where the script changes, so English goes to the English voice and Arabic to the
      // Arabic voice even inside one sentence; every piece is fetched right away and played in order.
      const enqueue = (text: string) => {
        for (const run of scriptRuns(text))
          for (const part of splitForTts(run.text)) r.queue.push({ text: part, audio: synthesize(part.trim(), run.lang, r.abort.signal) })
      }
      let m: RegExpMatchArray | null
      while ((m = r.pending.match(re)) && (all || /\s$/.test(m[0]) || m[0].length < r.pending.length)) {
        if (m[0].trim()) enqueue(m[0])
        r.pending = r.pending.slice(m[0].length)
        if (!m[0].length) break
      }
      // A very long run without punctuation: speak it in pieces rather than waiting.
      if (!all && r.pending.length > TTS_SAFE_CHARS) {
        const [head, ...rest] = splitForTts(r.pending)
        enqueue(head)
        r.pending = rest.join("")
      }
      if (all && r.pending.trim()) {
        enqueue(r.pending)
        r.pending = ""
      }
      speakNext()
    },
    [speakNext, synthesize]
  )

  /** Tracks the conversation language (speech-to-text detects the language itself, so nothing else needs switching). */
  const followLanguage = useCallback((next: VoiceLang) => {
    if (next === langRef.current) return
    langRef.current = next
    setLangState(next)
  }, [])

  // ---- Interruption -------------------------------------------------------------------------------------------
  const interrupt = useCallback(
    (reason: string) => {
      const r = response.current
      if (!r) return
      response.current = null
      r.abort.abort()
      if (typeof window !== "undefined") window.speechSynthesis?.cancel()
      const source = sourceRef.current
      sourceRef.current = null
      try {
        source?.stop()
      } catch {}
      lastAudioAt.current = Date.now()
      // Undo any barge-in ducking so the next reply plays at full volume.
      if (outGainRef.current && outCtxRef.current) outGainRef.current.gain.setValueAtTime(1, outCtxRef.current.currentTime)
      const kept = r.text.slice(0, Math.max(r.spoken, 0))
      patchMessage(r.msgId, (m) => ({ ...m, streaming: false, interrupted: true, spokenChars: kept.length }))
      patchTurn(r.turnId, (t) => ({
        ...t,
        status: t.status === "streaming" || t.status === "done" ? "interrupted" : t.status,
        tools: t.tools.map((c) => (c.status === "running" ? { ...c, status: "cancelled" } : c)),
        events: [...t.events, { at: Date.now(), label: reason }],
      }))
      setPhase(activeRef.current ? "listening" : "idle")
    },
    [patchMessage, patchTurn]
  )

  // ---- A turn: send to the agent and consume the stream -------------------------------------------------------
  const runTurn = useCallback(
    async (userText: string) => {
      const text = userText.trim()
      if (!text) return
      outCtx() // Typed turns start from a click: unlock audio playback now.
      // Same rule as the server: "use Arabic" sticks, Arabic script means Arabic. Listen for that language next.
      followLanguage(replyLang([...messagesRef.current.filter((m) => m.role === "user").map((m) => m.text), text]))
      if (response.current) interrupt("Interrupted by a new request")
      const turnId = uid()
      const userMsg: MessageView = { id: uid(), turnId, role: "user", text }
      const msgId = uid()
      const startedAt = Date.now()
      const prior = messagesRef.current
      setMessages((ms) => [...ms, userMsg, { id: msgId, turnId, role: "assistant", text: "", streaming: true, spokenChars: 0, narration: [] }])
      setTurns((ts) => [
        ...ts,
        { id: turnId, index: ts.length + 1, userText: text, startedAt, status: "streaming", tools: [], events: [{ at: startedAt, label: "End of user turn detected" }] },
      ])
      setUserDraft("")
      setPhase("thinking")

      const abort = new AbortController()
      response.current = { turnId, msgId, abort, text: "", pending: "", queue: [], spoken: 0, streamDone: false, speaking: false, recent: "" }
      const r = response.current

      const history = [...prior, userMsg]
        .filter((m) => m.text.trim())
        .map((m) => ({ role: m.role, content: m.role === "assistant" && m.interrupted ? m.text.slice(0, m.spokenChars ?? m.text.length) + " …" : m.text }))

      try {
        const res = await fetch("/api/speech/audio/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input:text, messages:history.slice(0,-1).slice(-14), speak:voiceOnRef.current }),
          signal: abort.signal,
        })
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => ({ error: `Request failed (${res.status})` }))
          throw new Error(err.error ?? `Request failed (${res.status})`)
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (response.current !== r) break
          buf += decoder.decode(value, { stream: true })
          const blocks = buf.split("\n\n")
          buf = blocks.pop() ?? ""
          for (const block of blocks) {
            const event = block.match(/^event: (.+)$/m)?.[1]
            const raw = block.match(/^data: (.+)$/m)?.[1]
            if (!event || !raw) continue
            const data = JSON.parse(raw)
            handleEvent(event, data)
          }
        }
        if (response.current === r) {
          r.streamDone = true
          finishIfDrained()
        }
      } catch (e) {
        if (abort.signal.aborted) return
        const message = e instanceof Error ? e.message : "Realtime turn failed"
        patchTurn(turnId, (t) => ({ ...t, status: "error", error: message, events: [...t.events, { at: Date.now(), label: `Error: ${message}` }] }))
        patchMessage(msgId, (m) => ({ ...m, streaming: false, text: m.text || "Sorry, I lost the connection for that one." }))
        if (response.current === r) response.current = null
        setPhase(activeRef.current ? "listening" : "idle")
      }

      function handleEvent(event: string, data: Record<string, unknown>) {
        switch (event) {
          case "response.created":
            patchTurn(turnId, (t) => ({ ...t, mode: data.mode as TurnView["mode"], events: [...t.events, { at: Date.now(), label: `Response started on ${data.model}` }] }))
            break
          case "response.mode":
            patchTurn(turnId, (t) => ({ ...t, mode: data.mode as TurnView["mode"], events: [...t.events, { at: Date.now(), label: "Model unavailable, scripted agent took over" }] }))
            break
          case "response.text.delta": {
            const delta = String(data.delta ?? "")
            const start = r.text.length
            r.text += delta
            const isNarration = data.source === "narration"
            patchMessage(msgId, (m) => ({ ...m, text: r.text, narration: isNarration ? [...(m.narration ?? []), [start, r.text.length]] : m.narration }))
            patchTurn(turnId, (t) => (t.firstTextMs != null ? t : { ...t, firstTextMs: Date.now() - t.startedAt }))
            break
          }
          case "response.audio.delta": {
            const sentence=String(data.text??"")
            const bytes=Uint8Array.from(atob(String(data.audio??"")),char=>char.charCodeAt(0))
            const ctx=outCtx()
            const audio=ctx.decodeAudioData(bytes.buffer).then(buffer=>trimTrailingSilence(ctx,buffer)).catch(()=>{setNotice("Could not decode speech audio. Trying your browser voice.");return null})
            r.queue.push({text:sentence,audio})
            speakNext()
            break
          }
          case "response.function_call.started":
            patchTurn(turnId, (t) => ({
              ...t,
              tools: [...t.tools, { callId: String(data.call_id), name: String(data.name), args: (data.arguments as Record<string, unknown>) ?? {}, status: "running", startedAt: Date.now() }],
            }))
            break
          case "response.function_call.completed":
            patchTurn(turnId, (t) => ({
              ...t,
              tools: t.tools.map((c) =>
                c.callId === data.call_id ? { ...c, status: data.ok ? "done" : "error", summary: String(data.summary ?? ""), result: data.result, ms: Number(data.ms) } : c
              ),
            }))
            break
          case "response.done":
            patchTurn(turnId, (t) => ({
              ...t,
              status: t.status === "streaming" ? "done" : t.status,
              totalMs: Date.now() - t.startedAt,
              events: [...t.events, { at: Date.now(), label: `Response complete · ${data.tool_calls} tool call${data.tool_calls === 1 ? "" : "s"}` }],
            }))
            break
          case "error":
            throw new Error(String(data.message ?? "Realtime turn failed"))
        }
      }
    },
    [finishIfDrained, followLanguage, interrupt, outCtx, patchMessage, patchTurn, speakNext]
  )
  runTurnRef.current = runTurn

  // ---- Speech in ----------------------------------------------------------------------------------------------
  // The echo-cancelled mic track is captured as PCM. A voice-activity detector finds where each utterance starts and
  // ends; the audio goes to TNSA STT (NGenSTT-V2), which detects English or Arabic by itself, so the user can switch
  // language at any time. While the user talks, the utterance so far is transcribed about once a second for the live
  // transcript. Because the track is echo-cancelled, the agent's own playback is mostly removed before it gets here.

  /** True while the agent can be heard, plus a short tail. */
  const agentAudible = useCallback(
    () =>
      !!sourceRef.current ||
      !!response.current?.speaking ||
      (typeof window !== "undefined" && !!window.speechSynthesis?.speaking) ||
      Date.now() - lastAudioAt.current < ECHO_TAIL_MS,
    []
  )

  const transcribe = useCallback(async (u: Utterance, final = false) => {
    const previous = u.transcriptRequest
    if (final && canReuseTranscript(previous, u.voicedMs)) {
      try { return await previous!.promise } catch { /* A failed partial must not drop the completed utterance. */ }
    }
    if (final) previous?.controller.abort()
    const controller = new AbortController()
    const chunks = u.chunks.slice()
    // Keep a short tail for word endings; don't upload the entire endpoint silence.
    if (final && chunks.length) {
      const blockMs = chunks[chunks.length - 1].length / u.rate * 1000
      const trim = Math.min(chunks.length - 1, Math.floor(Math.max(0, u.silentMs - 100) / blockMs))
      if (trim) chunks.splice(chunks.length - trim)
    }
    const promise = (async () => {
      const res = await fetch("/api/speech/audio/transcriptions", {
        method:"POST", headers:{"Content-Type":"audio/wav"}, body:encodeWav(chunks,u.rate),
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Transcription failed (${res.status})`)
      return await res.json() as {text:string;language:string|null}
    })()
    u.transcriptRequest = {voicedMs:u.voicedMs,controller,promise}
    return await promise
  }, [])

  /** An utterance heard while the agent was playing whose words are just the agent's own: echo that got through. */
  const isOwnVoice = useCallback((u: Utterance, text: string) => {
    if (!u.duringPlayback) return false
    const said = new Set(words(echoText.current))
    const w = words(text)
    return w.length > 0 && w.filter((x) => said.has(x)).length / w.length >= 0.7
  }, [])

  /**
   * Whether text heard while the agent was playing is really the user talking over it. Leftover echo is faint and
   * TNSA STT turns it into the agent's own words or stock filler ("Thank you."), so require at least two new real words.
   */
  const isBargeIn = useCallback(
    (u: Utterance, text: string) => {
      if (!text || isOwnVoice(u, text) || STT_FILLER.test(text.trim())) return false
      const said = new Set(words(echoText.current))
      return words(text).filter((w) => !said.has(w) && w.length > 1).length >= 2
    },
    [isOwnVoice]
  )

  /** That utterance turned out to be the agent's own echo: raise the echo level so it doesn't trigger again. */
  const learnEcho = useCallback((u: Utterance) => {
    vadRef.current.echoPeak = Math.max(vadRef.current.echoPeak, u.maxRms * 0.9)
  }, [])

  /** Lower the agent's volume while we find out whether the user is really talking over it. */
  const duck = useCallback((on: boolean) => {
    const g = outGainRef.current
    if (g && outCtxRef.current) g.gain.setTargetAtTime(on ? 0.25 : 1, outCtxRef.current.currentTime, 0.04)
  }, [])

  const interimTranscript = useCallback(
    async (u: Utterance) => {
      let request: TranscriptRequest | undefined
      try {
        const pending = transcribe(u)
        request = u.transcriptRequest
        const { text } = await pending
        if (u.discard || u.transcriptRequest !== request) return
        if (u.duringPlayback && !u.confirmed) {
          if (!isBargeIn(u, text)) {
            // The agent's own words or TNSA STT filler, judged on enough audio: let the agent carry on. An empty or
            // half-word partial early on proves nothing, so keep listening for the next one.
            if (text && u.voicedMs > 700 && (isOwnVoice(u, text) || STT_FILLER.test(text.trim()))) {
              u.discard = true
              learnEcho(u)
              duck(false)
              if (utteranceRef.current === u) setUserDraft("")
            }
            return
          }
          if (u.voicedMs < BARGE_IN_MIN_MS) return // too short to be sure yet; the next partial decides
          u.confirmed = true
          duck(false)
          interrupt(`User barged in ("${text.slice(0, 60)}"), playback stopped`)
        }
        if (text && utteranceRef.current === u) setUserDraft(text)
      } catch {
        // A missed partial is fine; the final transcript still runs.
      } finally {
        if (u.transcriptRequest === request) u.interimBusy = false
      }
    },
    [duck, interrupt, isBargeIn, isOwnVoice, learnEcho, transcribe]
  )

  const finishUtterance = useCallback(
    async (u: Utterance) => {
      if (u.discard || u.voicedMs < MIN_SPEECH_MS) {
        if (!u.confirmed) duck(false)
        if (!utteranceRef.current) setUserDraft("")
        return
      }
      try {
        const { text } = await transcribe(u, true)
        duck(false)
        // Audio captured while the agent was playing only becomes a turn if it is clearly the user.
        const fromUser = u.confirmed || !u.duringPlayback ? !!text && !STT_FILLER.test(text.trim()) : isBargeIn(u, text)
        if (!fromUser && u.duringPlayback && !u.confirmed) learnEcho(u)
        if (u.discard || !fromUser) {
          if (!utteranceRef.current) setUserDraft("")
          return
        }
        void runTurnRef.current(text)
      } catch (e) {
        duck(false)
        setUserDraft("")
        setNotice(`Speech-to-text failed: ${e instanceof Error ? e.message : "unknown error"}. You can type instead.`)
      }
    },
    [duck, isBargeIn, learnEcho, transcribe]
  )

  /** Called for every ~43 ms block of mic audio: voice-activity detection, barge-in and partial transcripts. */
  const onMicBlock = useCallback(
    (block: Float32Array, rate: number) => {
      if (!activeRef.current) return
      const vad = vadRef.current
      if (micMutedRef.current) {
        if (utteranceRef.current) { utteranceRef.current.discard = true; utteranceRef.current.transcriptRequest?.controller.abort() }
        utteranceRef.current = null
        duck(false)
        return
      }
      const now = Date.now()
      const blockMs = (block.length / rate) * 1000
      let sum = 0
      for (let i = 0; i < block.length; i++) sum += block[i] * block[i]
      const rms = Math.sqrt(sum / block.length)
      const audible = agentAudible()
      // Thresholds relative to what the mic hears without the user: the room's noise floor, and while the agent plays,
      // the loudest recent leftover echo of its voice (learned live: it depends on speakers, volume and room).
      // While the agent plays, Chrome's echo canceller also turns the user down (double-talk), so the fixed minimum is low
      // and the learned echo level does the protecting.
      const startAt = audible ? Math.max(0.005, vad.echoPeak * 1.8, vad.floor * 3) : Math.max(0.008, vad.floor * 3)
      const loudAt = Math.max(0.009, vad.echoPeak * 2.5, vad.floor * 6)
      inputLevel.current = Math.min(1, rms * 25)
      const u = utteranceRef.current

      if (!u) {
        vad.preroll.push(block)
        if (vad.preroll.length > PREROLL_BLOCKS) vad.preroll.shift()
        if (audible) {
          // Learn the echo level slowly (~1 s to settle) from blocks below the threshold: steady echo is learned, but a
          // voice starting within a few blocks can't drag the threshold up ahead of itself. Bursts that turn out to be
          // echo are learned through learnEcho() once TNSA STT confirms them.
          if (rms <= startAt) vad.echoPeak = rms > vad.echoPeak ? vad.echoPeak + (rms - vad.echoPeak) * 0.05 : vad.echoPeak * 0.997
          vad.spikeMax = rms > startAt ? Math.max(vad.spikeMax, rms) : 0
          vad.heardMs += blockMs
        } else {
          vad.echoPeak *= 0.999 // fades slowly between replies, so the next reply starts calibrated
          if (rms < vad.floor * 2 || vad.floor === 0) vad.floor = vad.floor === 0 ? rms : vad.floor * 0.97 + rms * 0.03
        }
        // Count loud blocks over a short window rather than strictly in a row: syllables have dips between them.
        vad.hits.push(rms > startAt ? 1 : 0)
        vad.loudHits.push(rms > loudAt ? 1 : 0)
        if (vad.hits.length > ONSET_WINDOW_BLOCKS) vad.hits.shift()
        if (vad.loudHits.length > ONSET_WINDOW_BLOCKS) vad.loudHits.shift()
        vad.above = vad.hits.reduce((a, b) => a + b, 0)
        // The loud blocks that start an utterance count toward a fast barge-in too.
        if (rms <= startAt || vad.above < (audible ? 4 : 2)) return
        // Speech started.
        const next: Utterance = {
          chunks: [...vad.preroll],
          rate,
          startedAt: now,
          voicedMs: vad.above * blockMs,
          silentMs: 0,
          duringPlayback: audible,
          confirmed: false,
          discard: false,
          lastInterimAt: now,
          interimBusy: false,
          loudMs: vad.loudHits.reduce((a, b) => a + b, 0) * blockMs,
          maxRms: vad.spikeMax,
        }
        utteranceRef.current = next
        vad.preroll = []
        vad.above = 0
        vad.hits = []
        vad.loudHits = []
        vad.spikeMax = 0
        // Only lower the agent's volume for now. The response is cancelled once the words are known to be the user's
        // (a confirmed barge-in, or a finished turn, which replaces the response); a cough or key press cancels nothing.
        if (audible) duck(true)
        setUserDraft("…")
        return
      }

      u.chunks.push(block)
      u.duringPlayback ||= audible
      u.maxRms = Math.max(u.maxRms, rms)
      // Once speaking, a lower level keeps the utterance going (quieter syllables, word endings).
      const keepAt = audible ? Math.max(0.004, vad.echoPeak * 1.2, vad.floor * 2.5) : Math.max(0.005, vad.floor * 2)
      if (rms > keepAt) {
        u.voicedMs += blockMs
        u.silentMs = 0
      } else u.silentMs += blockMs
      // Upload the completed words while the endpoint pause is still being confirmed.
      // If speech resumes, finalization detects the changed voicedMs and cannot reuse this partial.
      if (u.silentMs >= 140 && u.voicedMs >= MIN_SPEECH_MS && !canReuseTranscript(u.transcriptRequest,u.voicedMs)) {
        u.transcriptRequest?.controller.abort()
        u.interimBusy=true
        u.lastInterimAt=now
        void interimTranscript(u)
      }
      if (u.silentMs >= ENDPOINT_MS || now - u.startedAt > MAX_UTTERANCE_MS) {
        // End of the user's turn.
        utteranceRef.current = null
        void finishUtterance(u)
        return
      }
      // Fast barge-in: a voice far louder than the agent's leftover echo, held for ~0.3 s, is the user talking over it.
      // Stop right away instead of waiting for TNSA STT (quieter speech still goes through the transcript check below).
      // Armed only once the echo level has been learned from ~1.5 s of playback, so loud speakers can't trip it early.
      if (u.duringPlayback && !u.confirmed && !u.discard && response.current) {
        // Total loud time in the first moments of speech: syllables come in 100-150 ms bursts with gaps between them.
        if (rms > loudAt && now - u.startedAt < 1500) u.loudMs += blockMs
        if (u.loudMs >= LOUD_BARGE_IN_MS && vad.heardMs >= ECHO_CALIBRATION_MS) {
          u.confirmed = true
          duck(false)
          interrupt("User barged in (voice over playback), playback stopped")
          setUserDraft("…")
        }
      }
      // While the agent is playing, check sooner whether this is really the user.
      const due = u.duringPlayback && !u.confirmed ? 300 : INTERIM_EVERY_MS
      if (!u.interimBusy && u.voicedMs > (u.duringPlayback && !u.confirmed ? 250 : 400) && now - u.lastInterimAt > due) {
        u.lastInterimAt = now
        u.interimBusy = true
        void interimTranscript(u)
      }
    },
    [agentAudible, duck, finishUtterance, interimTranscript, interrupt]
  )
  onMicBlockRef.current = onMicBlock

  // ---- Session ------------------------------------------------------------------------------------------------
  const start = useCallback(async () => {
    if (activeRef.current) return
    activeRef.current = true
    setNotice(null)
    ttsUnavailable.current = {en:false,ar:false}
    setPhase("connecting")
    outCtx() // Create the playback context inside the click so the browser lets it play.

    // Spoken greeting, so the session opens like a call.
    const turnId = uid()
    const msgId = uid()
    const greeting = langRef.current === "ar" ? GREETING_AR : GREETING
    setMessages((ms) => [...ms, { id: msgId, turnId, role: "assistant", text: greeting, streaming: true, spokenChars: 0 }])
    response.current = { turnId, msgId, abort: new AbortController(), text: greeting, pending: greeting, queue: [], spoken: 0, streamDone: true, speaking: false, recent: "" }
    setPhase("thinking")
    flushSentences(true)
    try {
      // No auto-gain: it boosts the faint leftover of the agent's own voice into something that looks like speech.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } })
      if (!activeRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const ctx = new AudioContext()
      await ctx.resume()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      source.connect(analyser)
      // Raw PCM for the voice detector and TNSA STT. The processor must reach the destination to run; it outputs silence.
      const proc = ctx.createScriptProcessor(2048, 1, 1)
      proc.onaudioprocess = (e) => onMicBlockRef.current(new Float32Array(e.inputBuffer.getChannelData(0)), ctx.sampleRate)
      const mute = ctx.createGain()
      mute.gain.value = 0
      source.connect(proc)
      proc.connect(mute).connect(ctx.destination)
      ctxRef.current = ctx
      analyserRef.current = analyser
      procRef.current = proc
      vadRef.current = newVad()
      setSrSupported(true)
    } catch {
      setSrSupported(false)
      setNotice("No microphone access. You can still type to the agent and hear it speak.")
    }


  }, [flushSentences, outCtx])

  const stop = useCallback(() => {
    activeRef.current = false
    interrupt("Session ended")
    if (utteranceRef.current) { utteranceRef.current.discard = true; utteranceRef.current.transcriptRequest?.controller.abort() }
    utteranceRef.current = null
    procRef.current?.disconnect()
    procRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    analyserRef.current = null
    duck(false)
    setUserDraft("")
    setPhase("idle")
  }, [duck, interrupt])

  const reset = useCallback(() => {
    stop()
    setMessages([])
    setTurns([])
  }, [stop])

  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [tick])

  // Voices load asynchronously in Chromium.
  useEffect(() => {
    window.speechSynthesis?.getVoices()
  }, [])

  const enableAudio = useCallback(async () => {
    try { await ensureAudioRunning(outCtx()); setVoiceOn(true); voiceOnRef.current=true; ttsUnavailable.current={en:false,ar:false}; setAudioBlocked(false); setNotice(null) }
    catch { setAudioBlocked(true); setNotice("Sound is blocked by this browser. Open the demo in a browser tab and allow audio playback.") }
  }, [outCtx])

  return {
    audioBlocked,
    enableAudio,
    phase,
    messages,
    turns,
    userDraft,
    levels,
    inputLevel,
    micMuted,
    setMicMuted,
    voiceOn,
    setVoiceOn,
    notice,
    srSupported,
    lang,
    active: phase !== "idle",
    start,
    stop,
    reset,
    send: runTurn,
    interrupt: () => interrupt("Interrupted from the controls"),
  }
}
