import { createHash } from "node:crypto"
// Text to speech for any length and either language. Long text is cut under the model's ~200-character limit at
// sentence and clause boundaries; mixed English/Arabic text is split where the script changes so each part is spoken
// by a voice for its language. Chunks are synthesised in parallel and joined into one WAV.

import { DEFAULT_VOICE, VOICES, config } from "./config.ts"
import type { VoiceLang } from "./language.ts"
import { speakChunk } from "./upstream.ts"

export const CHUNK_CHARS = 190
const PARALLEL = 4
const MIN_SWITCH_WORDS = 3
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/
const LATIN = /[A-Za-z]/

function pack(pieces: string[], max: number) {
  const chunks: string[] = []
  let current = ""
  for (const piece of pieces) {
    if (current && (current + piece).trim().length > max) {
      chunks.push(current.trim())
      current = ""
    }
    current += piece
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function breakDown(text: string, max: number): string[] {
  if (text.trim().length <= max) return [text]
  const clauses = text.match(/[^,;:،]+[,;:،]*\s*/g) ?? [text]
  if (clauses.length > 1) return clauses.flatMap((c) => breakDown(c, max))
  const words = text.match(/\S+\s*/g) ?? [text]
  if (words.length > 1) return words.flatMap((w) => breakDown(w, max))
  const parts: string[] = []
  for (let i = 0; i < text.length; i += max) parts.push(text.slice(i, i + max))
  return parts
}

/** Request-sized chunks: whole sentences kept together, short ones combined, long ones broken at commas or spaces. */
export function chunkText(text: string, max = CHUNK_CHARS) {
  const sentences = text.match(/[^.!?؟\n]+[.!?؟]*["')\]]*\s*|\n+/g) ?? [text]
  return pack(sentences.flatMap((s) => breakDown(s, max)), max).filter((c) => /[\p{L}\p{N}]/u.test(c))
}

/** Splits text into runs of one script; runs under three words stay with their neighbours. */
export function scriptRuns(text: string): { lang: VoiceLang; text: string }[] {
  const runs: { lang: VoiceLang; text: string }[] = []
  for (const token of text.match(/\s*\S+\s*/g) ?? [text]) {
    const lang: VoiceLang | null = ARABIC.test(token) ? "ar" : LATIN.test(token) ? "en" : null
    const last = runs[runs.length - 1]
    if (last && (lang === null || lang === last.lang)) last.text += token
    else runs.push({ lang: lang ?? "en", text: token })
  }
  if (runs.length > 1 && !ARABIC.test(runs[0].text) && !LATIN.test(runs[0].text)) {
    runs[1].text = runs[0].text + runs[1].text
    runs.shift()
  }
  for (let i = 0; i < runs.length && runs.length > 1; ) {
    if (runs[i].text.trim().split(/\s+/).length >= MIN_SWITCH_WORDS) {
      i++
      continue
    }
    const into = i > 0 ? i - 1 : i + 1
    runs[into].text = i > 0 ? runs[into].text + runs[i].text : runs[i].text + runs[into].text
    runs.splice(i, 1)
    const j = Math.max(0, i - 1)
    if (runs[j + 1] && runs[j].lang === runs[j + 1].lang) {
      runs[j].text += runs[j + 1].text
      runs.splice(j + 1, 1)
    }
    i = 0
  }
  return runs
}

/** Concatenate WAV files that share a format: keep the first header, join the PCM data. */
export function concatWavs(wavs: Buffer[]) {
  if (!wavs.length) throw new Error("No speech audio returned")
  let fmt: Buffer | null = null
  const pcm: Buffer[] = []
  for (const wav of wavs) {
    if (wav.length < 44 || wav.toString("ascii",0,4) !== "RIFF" || wav.toString("ascii",8,12) !== "WAVE") throw new Error("Invalid speech audio")
    let foundData = false
    let foundFormat = false
    let offset = 12
    while (offset + 8 <= wav.length) {
      const id = wav.toString("ascii", offset, offset + 4)
      let size = wav.readUInt32LE(offset + 4)
      const body = offset + 8
      if (id === "data" && (size === 0xffffffff || body + size > wav.length)) size = wav.length - body
      if (body + size > wav.length) throw new Error("Truncated speech audio")
      if (id === "fmt ") {
        const current = wav.subarray(body, body + size)
        if (size < 16 || (fmt && !fmt.equals(current))) throw new Error("Incompatible speech formats")
        fmt ??= current
        foundFormat = true
      }
      if (id === "data") { pcm.push(wav.subarray(body, body + size)); foundData = size > 0 }
      offset = body + size + (size % 2)
    }
    if (!foundData || !foundFormat) throw new Error("Incomplete speech audio")
  }
  if (!fmt) throw new Error("Missing speech format")
  const data = Buffer.concat(pcm)
  const header = Buffer.alloc(12 + 8 + fmt.length + 8)
  header.write("RIFF", 0, "ascii")
  header.writeUInt32LE(header.length - 8 + data.length, 4)
  header.write("WAVE", 8, "ascii")
  header.write("fmt ", 12, "ascii")
  header.writeUInt32LE(fmt.length, 16)
  fmt.copy(header, 20)
  header.write("data", 20 + fmt.length, "ascii")
  header.writeUInt32LE(data.length, 24 + fmt.length)
  return Buffer.concat([header, data])
}

export type SpeakRequest = { input: string; voice?: string; language?: VoiceLang }

/**
 * Synthesises text to one WAV. With a voice, that voice speaks everything. With only a language, that language's
 * default voice. With neither, each part uses the default voice for its own script (English or Arabic).
 */
const audioCache = new Map<string, {wav:Buffer;chunks:number;expires:number}>()
let cacheBytes = 0
const CACHE_BYTES = 16 * 1024 * 1024

export async function speak(req: SpeakRequest, signal: AbortSignal) {
  signal.throwIfAborted()
  const cacheKey = createHash("sha256").update(JSON.stringify({...req,provider:config.inferenceProvider,ttsProvider:process.env.TTS_PROVIDER,ttsModel:process.env.ELEVENLABS_MODEL_ID,speed:process.env.ELEVENLABS_SPEED,voiceId:process.env.ELEVENLABS_VOICE_ID,maleVoiceId:process.env.ELEVENLABS_MALE_VOICE_ID,input:req.input.trim()})).digest("hex")
  const cached = audioCache.get(cacheKey)
  if (cached) {
    audioCache.delete(cacheKey)
    if (cached.expires > Date.now()) { audioCache.set(cacheKey,cached); return {wav:cached.wav,chunks:cached.chunks} }
    cacheBytes -= cached.wav.length
  }
  const pieces: { text: string; lang: VoiceLang; voice: string }[] = []
  const chosen = req.voice ? VOICES[req.voice] : undefined
  const runs = chosen || req.language ? [{ lang: chosen?.lang ?? req.language!, text: req.input }] : scriptRuns(req.input)
  for (const run of runs) {
    const voiceId = req.voice && chosen ? req.voice : DEFAULT_VOICE[run.lang]
    for (const text of chunkText(run.text)) pieces.push({ text, lang: VOICES[voiceId].lang, voice: VOICES[voiceId].upstream })
  }
  const wavs: Buffer[] = new Array(pieces.length)
  let next = 0
  const worker = async () => {
    while (next < pieces.length) {
      const i = next++
      const p = pieces[i]
      wavs[i] = await speakChunk(p.text, config.upstream.ttsModel[p.lang], p.voice, signal)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, pieces.length) }, worker))
  const result = {wav:concatWavs(wavs),chunks:pieces.length}
  signal.throwIfAborted()
  if (req.input.length <= 240 && result.wav.length < CACHE_BYTES) {
    while (cacheBytes + result.wav.length > CACHE_BYTES || audioCache.size >= 128) {
      const oldest = audioCache.keys().next().value
      if (oldest === undefined) break
      cacheBytes -= audioCache.get(oldest)!.wav.length
      audioCache.delete(oldest)
    }
    const existing = audioCache.get(cacheKey)
    if (existing) { cacheBytes -= existing.wav.length; audioCache.delete(cacheKey) }
    audioCache.set(cacheKey,{...result,expires:Date.now()+10*60*1000})
    cacheBytes += result.wav.length
  }
  return result
}
