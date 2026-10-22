export async function ensureAudioRunning(context: {state: string; resume(): Promise<void>}) {
  if (context.state !== "running") await context.resume()
  if (context.state !== "running") throw new Error("Audio output is blocked. Select Enable sound to resume playback.")
}

type Transcription = {text:string;language:string|null}
export type TranscriptRequest = {voicedMs:number;controller:AbortController;promise:Promise<Transcription>}
/** Only reuse captions when no further speech has been captured; never reuse a partial missing the last word. */
export const canReuseTranscript = (request:TranscriptRequest | undefined, voicedMs:number) =>
  !!request && !request.controller.signal.aborted && request.voicedMs === voicedMs

export function createAudioLimiter(maximum=3) {
  let active=0
  const queue:{resolve:(release:()=>void)=>void;reject:(reason:unknown)=>void;signal:AbortSignal;onAbort:()=>void}[]=[]
  const drain=()=>{
    while(active<maximum&&queue.length){
      const next=queue.shift()!
      next.signal.removeEventListener("abort",next.onAbort)
      if(next.signal.aborted){next.reject(next.signal.reason);continue}
      active++;let released=false
      next.resolve(()=>{if(released)return;released=true;active--;drain()})
    }
  }
  return (signal:AbortSignal)=>new Promise<()=>void>((resolve,reject)=>{
    if(signal.aborted){reject(signal.reason);return}
    const entry={resolve,reject,signal,onAbort:()=>{const i=queue.indexOf(entry);if(i>=0)queue.splice(i,1);reject(signal.reason)}}
    signal.addEventListener("abort",entry.onAbort,{once:true});queue.push(entry);drain()
  })
}
