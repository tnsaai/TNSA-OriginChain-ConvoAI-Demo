import {elevenEnabled,streamEleven} from "./elevenlabs.ts"
import {modelContext,resolveModel,MODEL_OPTIONS} from "./model-context.ts"
import { TOOL_SPECS } from "./demo/tools.ts"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { randomUUID, timingSafeEqual, createHash } from "node:crypto"
import { DEFAULT_VOICE, PUBLIC_MODELS, VOICES, config, limits } from "./config.ts"
import { runAgentTurn, sanitizeHistory } from "./agent.ts"
import { speak, chunkText } from "./tts.ts"
import { transcribe } from "./upstream.ts"
import { database, TABLES } from "./db/client.ts"

const MAX_JSON=256*1024, MAX_AUDIO=4*1024*1024, MAX_TTS_CHARS=5000
class HttpError extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status} }
const log=(event:object)=>{
  let line=JSON.stringify({time:new Date().toISOString(),...event})
  for(const secret of [...config.apiKeys,config.upstream.apiKey,config.openRouter.apiKey,process.env.ORIGINCHAIN_TOKEN??"",process.env.ELEVENLABS_API_KEY??""])if(secret)line=line.split(secret).join("[redacted]")
  console.log(line)
}
function send(res:ServerResponse,status:number,body:unknown,headers:Record<string,string>={}) {
  if(res.headersSent || res.destroyed) return
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers})
  res.end(JSON.stringify(body))
}
async function readBody(req:IncomingMessage,limit:number):Promise<Buffer> {
  const declared=Number(req.headers["content-length"])
  if(Number.isFinite(declared)&&declared>limit) throw new HttpError(413,"Request body too large")
  const chunks:Buffer[]=[];let length=0
  for await(const chunk of req){length+=chunk.length;if(length>limit)throw new HttpError(413,"Request body too large");chunks.push(chunk)}
  return Buffer.concat(chunks)
}
async function readJson(req:IncomingMessage,limit=MAX_JSON):Promise<Record<string,unknown>> {
  if(!req.headers["content-type"]?.toLowerCase().startsWith("application/json"))throw new HttpError(415,"Content-Type must be application/json")
  let value:unknown
  const bytes=await readBody(req,limit)
  try{value=JSON.parse(bytes.toString("utf8"))}catch{throw new HttpError(400,"Invalid JSON")}
  if(!value||typeof value!=="object"||Array.isArray(value))throw new HttpError(400,"Expected a JSON object")
  return value as Record<string,unknown>
}
function validateHistory(body:Record<string,unknown>) {
  if(!Array.isArray(body.messages)||!body.messages.length||body.messages.length>32)throw new HttpError(400,"Provide 1 to 32 conversation messages")
  for(const m of body.messages)if(!m||!["user","assistant"].includes(m.role)||typeof m.content!=="string"||!m.content.trim()||m.content.length>2000)throw new HttpError(400,"Invalid conversation message")
  const history=sanitizeHistory(body.messages)
  if(history.at(-1)?.role!=="user")throw new HttpError(400,"The last message must be from the user")
  return history
}
function validateWav(bytes:Buffer) {
  if(bytes.length<44||bytes.toString("ascii",0,4)!=="RIFF"||bytes.toString("ascii",8,12)!=="WAVE")throw new HttpError(400,"Expected a PCM WAV recording")
  let offset=12,fmt=false,data=false
  while(offset+8<=bytes.length) {
    const id=bytes.toString("ascii",offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8
    if(start+size>bytes.length)throw new HttpError(400,"Truncated WAV recording")
    if(id==="fmt ") {if(size<16||bytes.readUInt16LE(start)!==1||![1,2].includes(bytes.readUInt16LE(start+2))||bytes.readUInt16LE(start+14)!==16)throw new HttpError(400,"Use 16-bit mono or stereo PCM WAV");const rate=bytes.readUInt32LE(start+4);if(rate<8000||rate>48000)throw new HttpError(400,"Unsupported WAV sample rate");fmt=true}
    if(id==="data")data=size>0
    offset=start+size+(size%2)
  }
  if(!fmt||!data)throw new HttpError(400,"Recording has no PCM audio")
}
const keyDigests=config.apiKeys.map(k=>createHash("sha256").update(k).digest())
function authenticate(req:IncomingMessage) {
  const h=req.headers.authorization??"",key=h.startsWith("Bearer ")?h.slice(7).trim():""
  if(key){const digest=createHash("sha256").update(key).digest();const index=keyDigests.findIndex(k=>timingSafeEqual(k,digest));if(index>=0)return `key${index}`}
  if(config.allowNoAuth&&!keyDigests.length)return "local-development"
  throw new HttpError(401,"Missing or invalid API key")
}
const windows=new Map<string,{start:number;count:number}>(),active=new Map<string,number>()
let activeTotal=0,draining=false
function acquire(id:string,res:ServerResponse) {
  const now=Date.now(),window=windows.get(id)
  if(!window||now-window.start>=60000)windows.set(id,{start:now,count:1})
  else if(++window.count>limits.ratePerMinute)throw new HttpError(429,"Too many requests")
  if(activeTotal>=limits.maxConcurrent||(active.get(id)??0)>=limits.perKeyConcurrent)throw new HttpError(429,"The speech service is busy")
  activeTotal++;active.set(id,(active.get(id)??0)+1)
  let released=false
  const release=()=>{if(released)return;released=true;activeTotal--;active.set(id,Math.max(0,(active.get(id)??1)-1))}
  res.once("finish",release);res.once("close",release)
}
function events(res:ServerResponse) {
  res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform","X-Accel-Buffering":"no"})
  res.flushHeaders()
  let pendingBytes=0,tail=Promise.resolve()
  const emit=(event:string,data:Record<string,unknown>)=>{
    if(res.destroyed||res.writableEnded)return
    const payload=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    const bytes=Buffer.byteLength(payload)
    pendingBytes+=bytes
    if(pendingBytes>8*1024*1024){res.destroy();return}
    tail=tail.then(()=>new Promise<void>((resolve,reject)=>{
      if(res.destroyed||res.writableEnded){resolve();return}
      if(res.write(payload)){resolve();return}
      const cleanup=()=>{res.off("drain",drained);res.off("close",closed);res.off("error",errored)}
      const drained=()=>{cleanup();resolve()}
      const closed=()=>{cleanup();resolve()}
      const errored=(error:Error)=>{cleanup();reject(error)}
      res.once("drain",drained);res.once("close",closed);res.once("error",errored)
    })).catch(()=>{res.destroy()}).finally(()=>{pendingBytes-=bytes})
  }
  emit.flush=()=>tail
  return emit
}

async function combinedTurn(req:IncomingMessage,res:ServerResponse,signal:AbortSignal) {
  const body=await readJson(req,Math.ceil(MAX_AUDIO*4/3)+MAX_JSON)
  if(body.voice!==undefined&&(typeof body.voice!=="string"||!VOICES[body.voice]))throw new HttpError(400,"Unknown voice")
  const prior=body.messages??[]
  if(!Array.isArray(prior)||prior.length>30)throw new HttpError(400,"Invalid conversation history")
  let text=typeof body.input==="string"?body.input.trim():""
  let audio:Buffer|undefined
  if(body.audio!==undefined) {
    if(text||typeof body.audio!=="string"||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.audio)||body.audio.length%4!==0)throw new HttpError(400,"Provide input text or base64 WAV audio")
    audio=Buffer.from(body.audio,"base64");if(audio.length>MAX_AUDIO)throw new HttpError(413,"Audio too large");validateWav(audio)
  }
  if(!audio&&(!text||text.length>2000))throw new HttpError(400,"Provide input text (up to 2000 characters) or audio")
  // Validate history before opening a paid transcription request.
  validateHistory({messages:[...prior,{role:"user",content:text||"audio input"}]})
  const emit=events(res)
  if(audio)text=(await transcribe(audio,signal)).text
  emit("input.transcript",{text,model:PUBLIC_MODELS.stt})
  if(!text){emit("response.done",{empty:true});res.end();return}
  const history=validateHistory({messages:[...prior,{role:"user",content:text}]})
  if(config.inferenceProvider==="anumana" && !elevenEnabled() && body.speak!==false){
    let lastTool:number|undefined,firstAudio:number|undefined,firstAfterTool:number|undefined,chunks=0
    await runAgentTurn(history,(event,data)=>{
      const now=Date.now()
      if(event==="response.function_call.completed")lastTool=now
      if(event==="response.audio.delta"){
        chunks++;firstAudio??=now
        if(lastTool!==undefined && firstAfterTool===undefined){firstAfterTool=now-lastTool;emit("response.latency",{tool_to_first_pcm_ms:firstAfterTool,scope:"Completed tool event to PCM at agent server; excludes browser transport/playback."})}
      }
      emit(event,event==="response.done"?{...data,audio_chunks:chunks,tool_to_first_pcm_ms:firstAfterTool}:data)
    },signal,msg=>log({event:"agent_error",detail:msg}),{streamAudio:true})
    await emit.flush();res.end();return
  }
  let pending="",sequence=0,done:Record<string,unknown>|undefined,failed=false
  let queue=Promise.resolve()
  let activeSyntheses=0
  const synthesisWaiters:(()=>void)[]=[]
  const synthesizeSentence=async(sentence:string)=>{
    if(activeSyntheses>=3)await new Promise<void>(resolve=>synthesisWaiters.push(resolve))
    else activeSyntheses++
    try { signal.throwIfAborted();return await speak({input:sentence,...(typeof body.voice==="string"?{voice:body.voice}:{})},signal) }
    finally {const next=synthesisWaiters.shift();if(next)next();else activeSyntheses--}
  }
  const enqueue=(sentence:string)=>{
    if(!/[\p{L}\p{N}]/u.test(sentence))return
    if(elevenEnabled()){
      queue=queue.then(async()=>{
        if(failed)return
        for await(const pcm of streamEleven(sentence,typeof body.voice==="string"?body.voice:DEFAULT_VOICE[/[\u0600-\u06ff]/.test(sentence)?"ar":"en"],signal)){
          emit("response.audio.delta",{sequence:sequence++,format:"pcm16",sample_rate:24000,channels:1,audio:pcm.toString("base64"),model:PUBLIC_MODELS.tts})
          await emit.flush()
        }
      }).catch(()=>{if(!failed){failed=true;emit("error",{message:"The speech service could not finish the audio reply."})}})
      return
    }
    // Start prefetch immediately; preserve playback order separately from synthesis order.
    const audio=synthesizeSentence(sentence).then(value=>({value,error:false as const}),(error:unknown)=>{log({event:"speech_synthesis_error",detail:error instanceof Error?error.message:"Unknown synthesis error",provider:config.inferenceProvider,...(error&&typeof error==="object"&&"detail" in error?{provider_detail:String(error.detail)}:{})});return {error:true as const}})
    queue=queue.then(async()=>{
      const result=await audio
      if(failed)return
      if(result.error)throw new Error("Speech synthesis failed")
      const {wav}=result.value
      emit("response.audio.delta",{sequence:sequence++,format:"wav",audio:wav.toString("base64"),text:sentence,model:PUBLIC_MODELS.tts})
    }).catch(()=>{if(!failed){failed=true;emit("error",{message:"The speech service could not finish the audio reply."})}})
  }
  await runAgentTurn(history,(event,data)=>{
    if(failed)return
    if(event==="response.done"){done=data;return}
    if(event==="error")failed=true
    emit(event,data)
    if(event==="response.text.delta"&&body.speak!==false){
      pending+=String(data.delta??"")
      let match:RegExpMatchArray|null
      while((match=pending.match(/^([\s\S]*?[.!?؟](?:\s|$))/))){enqueue(match[1]);pending=pending.slice(match[1].length)}
      if(pending.length>400){const pieces=chunkText(pending);for(const part of pieces.slice(0,-1))enqueue(part);pending=pieces.at(-1)??""}
    }
  },signal,msg=>log({event:"agent_error",detail:msg}))
  if(!failed)enqueue(pending)
  await queue
  if(done&&!failed)emit("response.done",{...done,audio_chunks:sequence})
  await emit.flush()
  res.end()
}
async function readiness(signal:AbortSignal) {
  const db=database(),[state,schemas]=await Promise.all([db.ready(signal),db.schemas(signal)])
  return state.read_ready&&state.write_ready&&TABLES.every(t=>schemas.includes(db.schema(t)))
}
async function handleRequest(req:IncomingMessage,res:ServerResponse){
  const start=Date.now(),id=randomUUID(),path=(req.url??"/").split("?")[0]
  res.setHeader("X-Request-Id",id);res.setHeader("X-Content-Type-Options","nosniff")
  res.on("finish",()=>log({event:"request",request_id:id,method:req.method,path,status:res.statusCode,duration_ms:Date.now()-start}))
  const abort=new AbortController()
  const timer=setTimeout(()=>{abort.abort();if(!res.headersSent)send(res,504,{error:"The speech request timed out",request_id:id});else{res.write(`event: error\ndata: ${JSON.stringify({message:"The speech request timed out"})}\n\n`);res.end()}},limits.timeoutMs)
  res.once("close",()=>{clearTimeout(timer);if(!res.writableFinished)abort.abort()});res.once("finish",()=>clearTimeout(timer))
  try {
    if(draining)throw new HttpError(503,"Service restarting")
    if(req.method==="GET"&&path==="/health")return send(res,200,{ok:true,service:"tnsa-speech"})
    const caller=authenticate(req)
    if(req.method==="GET"&&path==="/v1/ready") {const ready=await readiness(abort.signal).catch(()=>false);return send(res,ready?200:503,{ready,service:"tnsa-speech"})}
    acquire(caller,res)
    if(req.method==="POST" && config.inferenceProvider==="anumana" && process.env.SANSAR_HOSTED_ONLY==="1" && !process.env.TNSA_API_KEY && (path==="/v1/agent/turn"||path==="/v1/audio/turn"))
      throw new HttpError(503,"Hosted Sansar is missing its tenant API key")
    if(req.method==="GET"&&path==="/v1/sources") {
      const documents=await database().list<{id:string;title:string;sourceUrl?:string;acl?:unknown}>("documents",abort.signal)
      return send(res,200,{ready:true,database:"OriginChainDB",namespace:database().options.namespace,tools:TOOL_SPECS.map(t=>({name:t.function.name,description:t.function.description})),documents:documents.filter(d=>!d.acl).map(d=>({id:d.id,title:d.title,url:d.sourceUrl,kind:d.sourceUrl?"documentation":"demo_record"}))})
    }
    if(req.method==="GET"&&path==="/v1/models")return send(res,200,{models:MODEL_OPTIONS.map(m=>({id:m.id,label:m.label,execution:m.provider==="anumana"?(process.env.TNSA_API_KEY||process.env.SANSAR_HOSTED_ONLY==="1"?"Hosted Sansar":"Local Anumana"):"Older API",configured:m.provider==="anumana"?!!process.env.TNSA_API_KEY||(process.env.SANSAR_HOSTED_ONLY!=="1"&&!!process.env.ANUMANA_API_URL):!!config.upstream.apiKey}))})
    if(req.method==="GET"&&path==="/v1/voices")return send(res,200,{model:PUBLIC_MODELS.tts,default:DEFAULT_VOICE,voices:Object.entries(VOICES).map(([id,v])=>({id,language:v.lang,label:v.label}))})
    if(req.method==="POST"&&path==="/v1/agent/turn") {
      const history=validateHistory(await readJson(req)),emit=events(res)
      await runAgentTurn(history,emit,abort.signal,msg=>log({event:"agent_error",request_id:id,detail:msg}));await emit.flush();res.end();return
    }
    if(req.method==="POST"&&path==="/v1/audio/turn")return await combinedTurn(req,res,abort.signal)
    if(req.method==="POST"&&path==="/v1/audio/transcriptions") {
      if(!["audio/wav","audio/x-wav","application/octet-stream"].includes((req.headers["content-type"]??"").split(";")[0]))throw new HttpError(415,"Send raw audio/wav")
      const wav=await readBody(req,MAX_AUDIO);validateWav(wav)
      const result=await transcribe(wav,abort.signal);return send(res,200,{text:result.text,language:result.language,model:PUBLIC_MODELS.stt})
    }
    if(req.method==="POST"&&path==="/v1/audio/speech") {
      const body=await readJson(req),input=typeof body.input==="string"?body.input.replace(/[*_#`|~<>[\]]/g,"").trim():""
      if(!input)throw new HttpError(400,"input is required")
      if(input.length>MAX_TTS_CHARS)throw new HttpError(413,"Input exceeds 5000 characters")
      if(body.voice!==undefined&&(typeof body.voice!=="string"||!VOICES[body.voice]))throw new HttpError(400,"Unknown voice")
      if(body.language!==undefined&&body.language!=="ar"&&body.language!=="en")throw new HttpError(400,"Unsupported language")
      const {wav}=await speak({input,voice:body.voice as string|undefined,language:body.language as "ar"|"en"|undefined},abort.signal)
      res.writeHead(200,{"Content-Type":"audio/wav","Content-Length":wav.length,"Cache-Control":"no-store"});res.end(wav);return
    }
    throw new HttpError(404,"Not found")
  }catch(e){
    if(abort.signal.aborted)return
    const status=e instanceof HttpError?e.status:502
    if(status>=500)log({event:"request_failed",request_id:id,type:e instanceof Error?e.name:"Error"})
    if(res.headersSent){if(!res.destroyed){res.write('event: error\ndata: {"message":"The speech service could not finish this request."}\n\n');res.end()}return}
    send(res,status,{error:e instanceof HttpError?e.message:"The speech service could not complete this request",request_id:id},status===429?{"Retry-After":"10"}:{})
  }
}
export const server=createServer((req,res)=>{
 const header=req.headers["x-speech-model"]
 if(header!==undefined){
  const model=resolveModel(header)
  if(!model){send(res,400,{error:"Unknown speech model"});return}
  modelContext.run({id:model.id,provider:model.provider},()=>{void handleRequest(req,res)})
 }else void handleRequest(req,res)
})
server.keepAliveTimeout=65000;server.headersTimeout=70000;server.requestTimeout=120000;server.maxHeadersCount=64
if(fileURLToPath(import.meta.url) === resolve(/* turbopackIgnore: true */ process.argv[1] ?? "")){
  server.listen(config.port,config.host,()=>log({event:"listening",host:config.host,port:config.port}))
  for(const sig of ["SIGINT","SIGTERM"] as const)process.on(sig,()=>{draining=true;server.close(()=>process.exit(0));server.closeIdleConnections();setTimeout(()=>process.exit(1),15000).unref()})
}
