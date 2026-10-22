"use client"

import { useEffect, useRef, useState } from "react"
import {
  Activity,
  ArrowUp,
  Ban,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  CloudSun,
  Hand,
  LifeBuoy,
  Loader2,
  Mic,
  MicOff,
  Package,
  Phone,
  PhoneOff,
  RotateCcw,
  Volume2,
  VolumeX,
  Wrench,
  X,
} from "lucide-react"
import Orb from "@/components/realtime-voice/voice-orb"
import { type MessageView, type Phase, type ToolCallView, type TurnView, useRealtimeVoice } from "@/components/realtime-voice/use-realtime-voice"
import { cn } from "@/lib/utils"
const SUGGESTIONS = [
  "Where's order OC-20417, and will it rain in Mumbai?",
  "Kestrel's provisioning is stuck. Is Frankfurt healthy?",
  "When is my next meeting with Meridian?",
  "What does the Enterprise plan include?",
  "Open an urgent ticket for Kestrel about replication lag",
]

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Start a session to talk",
  connecting: "Connecting microphone",
  listening: "Listening",
  thinking: "Working on it",
  speaking: "Speaking",
}

const TOOL_META: Record<string, { label: string; icon: typeof Package }> = {
  lookup_order: { label: "Order lookup", icon: Package },
  get_account: { label: "Account", icon: Building2 },
  check_cluster_health: { label: "Cluster health", icon: Activity },
  search_knowledge_base: { label: "Knowledge base", icon: BookOpen },
  check_calendar: { label: "Calendar", icon: CalendarDays },
  get_weather: { label: "Weather", icon: CloudSun },
  create_support_ticket: { label: "Support ticket", icon: LifeBuoy },
}

export default function RealtimeVoicePage() {
  const voice = useRealtimeVoice()
  const [draft, setDraft] = useState("")

  const submit = (text: string) => {
    const t = text.trim()
    if (!t) return
    setDraft("")
    void voice.send(t)
  }
  const busy = voice.phase === "thinking" || voice.phase === "speaking"

  return (
    // On desktop the playground is pinned to the viewport (header 4rem + bottom padding 1rem) and each panel scrolls
    // inside itself. flex-none matters: as a flex-1 item of the growing layout column it would size to its content.
    <div className="flex flex-col gap-4 lg:h-[calc(100svh-2rem)] lg:flex-none lg:overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Realtime Voice</h1>
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">OriginChain</span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A voice agent on NGen-Realtime that calls tools while it keeps talking. Everything streams: your words, its words, and every tool call.
          </p>
        </div>
        <button
          type="button"
          onClick={voice.reset}
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
          Reset
        </button>
      </div>

      {voice.notice ? <div className="rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">{voice.notice}{voice.audioBlocked ? <button type="button" onClick={() => void voice.enableAudio()} className="ml-3 rounded-full bg-foreground px-3 py-1 text-background">Enable sound</button> : null}</div> : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <Conversation messages={voice.messages} draft={voice.userDraft} />

        {/* Orb and controls */}
        <section className="order-first flex flex-col items-center rounded-[24px] bg-muted/40 px-5 py-6 dark:bg-white/[0.025] lg:order-none lg:min-h-0">
          <div className="flex w-full flex-1 flex-col items-center justify-center gap-5">
            <div className="relative">
              <Orb
                levels={voice.levels}
                size="min(68vw, 280px)"
                speed={voice.phase === "thinking" ? 1.08 : voice.phase === "speaking" ? 0.96 : 0.58}
                reactivity={0.7}
                className={cn("transition-opacity duration-500", voice.phase === "idle" && "opacity-70")}
              />
            </div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <PhaseDot phase={voice.phase} />
              <span className={cn(voice.phase === "idle" ? "text-muted-foreground" : "text-foreground")}>{PHASE_LABEL[voice.phase]}</span>
            </div>
            {voice.active ? <MicMeter level={voice.inputLevel} muted={voice.micMuted} /> : null}

            <div className="flex items-center gap-3">
              <RoundButton
                label={voice.micMuted ? "Unmute microphone" : "Mute microphone"}
                onClick={() => voice.setMicMuted(!voice.micMuted)}
                disabled={!voice.active}
                active={voice.micMuted}
              >
                {voice.micMuted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
              </RoundButton>
              <button
                type="button"
                onClick={() => (voice.active ? voice.stop() : void voice.start())}
                aria-label={voice.active ? "End session" : "Start session"}
                className={cn(
                  "flex size-16 items-center justify-center rounded-full shadow-sm transition-all active:scale-95",
                  voice.active ? "bg-red-500 text-white hover:bg-red-600" : "bg-foreground text-background hover:opacity-90"
                )}
              >
                {voice.active ? <PhoneOff className="size-6" /> : <Phone className="size-6" />}
              </button>
              <RoundButton label="Interrupt" onClick={voice.interrupt} disabled={!busy}>
                <Hand className="size-5" />
              </RoundButton>
              <RoundButton label={voice.voiceOn ? "Mute agent voice" : "Unmute agent voice"} onClick={() => voice.setVoiceOn(!voice.voiceOn)} active={!voice.voiceOn}>
                {voice.voiceOn ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
              </RoundButton>
            </div>
            {!voice.srSupported ? (
              <p className="max-w-xs text-center text-xs text-muted-foreground">Allow microphone access to talk, or type below.</p>
            ) : null}
          </div>

          <form
            className="mt-4 flex w-full items-center gap-2 rounded-full bg-background p-1.5 pl-4 shadow-sm dark:bg-white/[0.06] dark:shadow-none"
            onSubmit={(e) => {
              e.preventDefault()
              submit(draft)
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={busy ? "Type to interrupt…" : "Or type to the agent…"}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              aria-label="Send"
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity disabled:opacity-30"
            >
              <ArrowUp className="size-4" />
            </button>
          </form>
          <div className="mt-3 flex w-full flex-wrap justify-center gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => submit(s)}
                className="rounded-full bg-background px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground dark:bg-white/[0.06]"
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <Turns turns={voice.turns} />
      </div>
    </div>
  )
}

/** How loud the mic hears the user, live: shows whether talking over the agent is getting through. */
function MicMeter({ level, muted }: { level: React.RefObject<number>; muted: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let shown = 0
    const tick = () => {
      // Fast rise, slow fall, like a VU meter.
      const target = muted ? 0 : level.current ?? 0
      shown = target > shown ? target : shown * 0.9
      if (bar.current) bar.current.style.transform = `scaleX(${Math.max(0.02, shown)})`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [level, muted])
  return (
    <div className="-mt-2 flex w-40 items-center gap-2" title="Microphone level">
      {muted ? <MicOff className="size-3 text-muted-foreground" /> : <Mic className="size-3 text-muted-foreground" />}
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
        <div ref={bar} className="h-full origin-left rounded-full bg-emerald-500 transition-none" style={{ transform: "scaleX(0.02)" }} />
      </div>
    </div>
  )
}

function PhaseDot({ phase }: { phase: Phase }) {
  const color = {
    idle: "bg-muted-foreground/40",
    connecting: "bg-amber-500",
    listening: "bg-emerald-500",
    thinking: "bg-blue-500",
    speaking: "bg-blue-500",
  }[phase]
  return (
    <span className="relative flex size-2.5">
      {phase !== "idle" ? <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", color)} /> : null}
      <span className={cn("relative inline-flex size-2.5 rounded-full", color)} />
    </span>
  )
}

function RoundButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-11 items-center justify-center rounded-full transition-colors disabled:opacity-35",
        active ? "bg-foreground text-background" : "bg-background text-foreground hover:bg-muted dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
      )}
    >
      {children}
    </button>
  )
}

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
  }, [dep])
  return ref
}

function PanelHeader({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 px-5 pt-4 pb-2">
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

// ---- Conversation --------------------------------------------------------------------------------------------------

function Conversation({ messages, draft }: { messages: MessageView[]; draft: string }) {
  const ref = useAutoScroll(messages.map((m) => m.text.length + (m.spokenChars ?? 0)).join() + draft)
  return (
    <section className="flex h-[70svh] min-h-[420px] flex-col overflow-hidden rounded-[24px] bg-muted/40 dark:bg-white/[0.025] lg:h-auto lg:min-h-0">
      <PanelHeader title="Conversation" hint="Live transcript" />
      <div ref={ref} className="panel-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pb-5 pl-5 pr-2">
        {messages.length === 0 && !draft ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
            <p className="font-medium">Nothing said yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Start a session and speak, or tap a suggestion. Your words appear here as you say them.</p>
          </div>
        ) : null}
        {messages.map((m) => (m.role === "user" ? <UserBubble key={m.id} text={m.text} /> : <AssistantText key={m.id} m={m} />))}
        {draft ? <UserBubble text={draft} partial /> : null}
      </div>
    </section>
  )
}

function UserBubble({ text, partial }: { text: string; partial?: boolean }) {
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-[14.5px] leading-6",
          partial
            ? "border border-dashed border-foreground/20 text-muted-foreground"
            : "bg-background shadow-sm dark:bg-white/[0.06] dark:shadow-none"
        )}
      >
        {text}
        {partial ? <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-emerald-500 align-middle" /> : null}
      </div>
    </div>
  )
}

function AssistantText({ m }: { m: MessageView }) {
  const spoken = m.spokenChars ?? m.text.length
  // Split the text at narration boundaries and at the spoken cursor so each run can be styled.
  const cuts = new Set<number>([0, m.text.length, Math.min(spoken, m.text.length)])
  for (const [a, b] of m.narration ?? []) {
    cuts.add(a)
    cuts.add(b)
  }
  const points = [...cuts].sort((x, y) => x - y)
  const runs = points.slice(0, -1).map((a, i) => {
    const b = points[i + 1]
    return {
      text: m.text.slice(a, b),
      narration: (m.narration ?? []).some(([x, y]) => a >= x && b <= y),
      unspoken: a >= spoken,
    }
  })
  return (
    <div className="max-w-[92%] text-[14.5px] leading-6">
      {m.text ? (
        runs.map((r, i) => (
          <span
            key={i}
            className={cn(
              r.narration && "text-blue-700 dark:text-blue-300",
              r.unspoken && (m.interrupted ? "text-muted-foreground/60 line-through decoration-muted-foreground/40" : "text-muted-foreground")
            )}
          >
            {r.text}
          </span>
        ))
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-current" />
        </span>
      )}
      {m.streaming && m.text ? <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-foreground/60" /> : null}
      {m.interrupted ? <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-300">interrupted</span> : null}
    </div>
  )
}

// ---- Turns and agent activity --------------------------------------------------------------------------------------

function Turns({ turns }: { turns: TurnView[] }) {
  const ref = useAutoScroll(JSON.stringify(turns.map((t) => [t.status, t.tools.map((c) => c.status), t.events.length])))
  return (
    <section className="flex h-[70svh] min-h-[420px] flex-col overflow-hidden rounded-[24px] bg-muted/40 dark:bg-white/[0.025] lg:h-auto lg:min-h-0">
      <PanelHeader title="Turns and agent activity" hint="Tool calls run in parallel" />
      <SourceCatalog />
      <div ref={ref} className="panel-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pb-4 pl-4 pr-1.5">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-12 text-center">
            <Wrench className="size-5 text-muted-foreground" />
            <p className="mt-2 font-medium">No turns yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">Each turn shows turn detection, latency, and every tool the agent runs while it talks.</p>
          </div>
        ) : null}
        {turns.map((t) => (
          <TurnCard key={t.id} turn={t} />
        ))}
      </div>
    </section>
  )
}

function SourceCatalog() {
  const [catalog,setCatalog]=useState<{tools:{name:string;description:string}[];documents:{id:string;title:string;url?:string;kind:string}[]} | null>(null)
  useEffect(()=>{
    const abort=new AbortController();let retry:ReturnType<typeof setTimeout>
    const load=()=>fetch("/api/speech/sources",{signal:abort.signal}).then(r=>r.ok?r.json():null).then(data=>{if(abort.signal.aborted)return;if(data)setCatalog(data);else retry=setTimeout(load,3000)}).catch(()=>{if(!abort.signal.aborted)retry=setTimeout(load,3000)})
    void load();return()=>{abort.abort();clearTimeout(retry)}
  },[])
  return <details className="mx-4 mb-3 shrink-0 rounded-xl bg-background px-3 py-2 text-xs">
    <summary className="cursor-pointer text-muted-foreground">{catalog?`OriginChainDB connected · ${catalog.tools.length} tools · ${catalog.documents.length} sources`:"Tools and sources"}</summary>
    {catalog ? <div className="max-h-64 space-y-3 overflow-y-auto py-2">
      <div><p className="mb-1 font-medium">Tools</p>{catalog.tools.map(tool=><p key={tool.name} title={tool.description} className="py-0.5 font-mono text-[10px] text-muted-foreground">{tool.name}</p>)}</div>
      <div><p className="mb-1 font-medium">Sources</p>{catalog.documents.map(doc=>doc.url?.startsWith("https://")?<a key={doc.id} href={doc.url} target="_blank" rel="noopener noreferrer" className="block py-0.5 text-[11px] text-blue-600 hover:underline">{doc.title} ↗</a>:<p key={doc.id} className="py-0.5 text-[10px] text-muted-foreground">{doc.title} · demo record</p>)}</div>
    </div>:<p className="pt-2 text-muted-foreground">Source catalog is unavailable. Tool errors will appear with each turn.</p>}
  </details>
}

const ms = (v?: number) => (v == null || Number.isNaN(v) ? "–" : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`)

function TurnCard({ turn }: { turn: TurnView }) {
  const status = {
    streaming: { label: "Live", cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300" },
    done: { label: "Done", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
    interrupted: { label: "Interrupted", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    error: { label: "Error", cls: "bg-red-500/10 text-red-700 dark:text-red-300" },
  }[turn.status]
  return (
    <div className="rounded-2xl bg-background p-3.5 shadow-sm dark:bg-white/[0.04] dark:shadow-none">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">Turn {turn.index}</span>
        <span className={cn("rounded-full px-1.5 py-px text-[10px] font-medium", status.cls)}>{status.label}</span>
        {turn.mode ? (
          <span className="ml-auto rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{turn.mode === "model" ? "NGen-Realtime" : "Scripted agent"}</span>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-sm">&ldquo;{turn.userText}&rdquo;</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Metric label="First word" value={ms(turn.firstTextMs)} />
        <Metric label="First audio" value={ms(turn.firstAudioMs)} />
        <Metric label="Total" value={ms(turn.totalMs)} />
      </div>
      {turn.tools.length ? (
        <div className="mt-3 space-y-2">
          {turn.tools.map((c) => (
            <ToolCard key={c.callId} call={c} />
          ))}
        </div>
      ) : null}
      <ol className="mt-3 space-y-1 border-l border-border pl-3">
        {turn.events.map((e, i) => (
          <li key={i} className="flex gap-2 text-[11px] text-muted-foreground">
            <span className="w-10 shrink-0 tabular-nums">+{((e.at - turn.startedAt) / 1000).toFixed(1)}s</span>
            <span>{e.label}</span>
          </li>
        ))}
      </ol>
      {turn.error ? <p className="mt-2 text-xs text-red-600 dark:text-red-400">{turn.error}</p> : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 dark:bg-white/[0.04]">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{value}</p>
    </div>
  )
}

function ToolCard({ call }: { call: ToolCallView }) {
  const result = call.result as {sources?:{kind?:string;title?:string;url?:string;schema?:string;record_id?:string}[];data_kind?:string} | undefined
  const sources = Array.isArray(result?.sources) ? result.sources : []
  const meta = TOOL_META[call.name] ?? { label: call.name, icon: Wrench }
  const Icon = meta.icon
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (call.status !== "running") return
    const t = setInterval(() => setElapsed(Date.now() - call.startedAt), 100)
    return () => clearInterval(t)
  }, [call.status, call.startedAt])
  const args = Object.entries(call.args).filter(([, v]) => v !== "" && v != null)
  return (
    <div
      className={cn(
        "rounded-xl border p-2.5 transition-colors",
        call.status === "running" ? "border-blue-500/40 bg-blue-500/[0.05]" : "border-border",
        call.status === "error" && "border-red-500/30",
        call.status === "cancelled" && "opacity-60"
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-muted">
          <Icon className="size-3.5" />
        </span>
        <span className="text-[13px] font-medium">{meta.label}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{call.name}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
          {call.status === "running" ? (
            <>
              <Loader2 className="size-3 animate-spin text-blue-500" />
              {ms(elapsed)}
            </>
          ) : call.status === "done" ? (
            <>
              <Check className="size-3 text-emerald-500" />
              {ms(call.ms)}
            </>
          ) : call.status === "error" ? (
            <>
              <X className="size-3 text-red-500" />
              {ms(call.ms)}
            </>
          ) : (
            <>
              <Ban className="size-3" />
              cancelled
            </>
          )}
        </span>
      </div>
      {args.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {args.map(([k, v]) => (
            <span key={k} className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {k}: <span className="text-foreground">{String(v)}</span>
            </span>
          ))}
        </div>
      ) : null}
      {call.summary ? <p className="mt-1.5 text-xs">{call.summary}</p> : null}
      {sources.length ? <div className="mt-2 space-y-1 border-t border-border pt-2">
        <p className="text-[10px] font-medium text-muted-foreground">Sources</p>
        {sources.map((source,i) => source.url?.startsWith("https://") ?
          <a key={i} href={source.url} target="_blank" rel="noopener noreferrer" className="block text-[11px] text-blue-600 underline-offset-2 hover:underline">{source.title ?? "Documentation"} ↗</a> :
          <div key={i} className="text-[10px] text-muted-foreground">{source.title ?? "OriginChainDB"} · <span className="font-mono">{source.schema}{source.record_id ? ` / ${source.record_id}` : ""}</span>{result?.data_kind === "demo_workspace" ? " · demo records" : ""}</div>
        )}
      </div> : null}
      {call.result !== undefined ? (
        <details className="group mt-1.5">
          <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">Result</summary>
          <pre className="no-scrollbar mt-1 max-h-48 overflow-auto rounded-lg bg-muted/70 p-2 text-[10.5px] leading-4 dark:bg-black/30">
            {JSON.stringify(call.result, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

