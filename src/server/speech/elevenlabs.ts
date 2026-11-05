import {normalizeTranscript} from "./transcript.ts"
import {scriptLang} from "./language.ts"
// Server-only ElevenLabs transport. Fixed origin prevents credential forwarding.
export const elevenEnabled = () => process.env.TTS_PROVIDER === "elevenlabs"
export const elevenModel = () => process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5"
export function elevenSpeed(){
 const speed=Number(process.env.ELEVENLABS_SPEED||"0.9")
 if(!Number.isFinite(speed)||speed<0.7||speed>1.2)throw new Error("Invalid configured speech speed")
 return speed
}
export function elevenVoice(voice:string) {
 const male=["arjun","faisal","daniel","fahad"].includes(voice)
 return (male?process.env.ELEVENLABS_MALE_VOICE_ID:process.env.ELEVENLABS_VOICE_ID) || (male?"JBFqnCBsd6RMkjVDRZzb":"EXAVITQu4vr4xnSDxMaL")
}
export async function* streamEleven(input:string,voice:string,signal:AbortSignal,transport:typeof fetch=fetch):AsyncGenerator<Buffer> {
 signal.throwIfAborted()
 const key=process.env.ELEVENLABS_API_KEY
 if(!key)throw new Error("ElevenLabs speech is not configured")
 const id=elevenVoice(voice)
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw new Error("Invalid configured voice")
 const res=await transport(`https://api.elevenlabs.io/v1/text-to-speech/${id}/stream?output_format=pcm_24000`,{
  method:"POST",redirect:"error",signal,headers:{"xi-api-key":key,"Content-Type":"application/json","Accept":"application/octet-stream"},
  body:JSON.stringify({text:input,model_id:elevenModel(),language_code:scriptLang(input),voice_settings:{stability:0.5,similarity_boost:0.75,...(elevenModel()==="eleven_v3"?{}:{speed:elevenSpeed()})}})
 })
 if(!res.ok||!res.body){await res.body?.cancel();throw new Error(`Speech provider rejected synthesis (${res.status})`)}
 const reader=res.body.getReader();let carry=Buffer.alloc(0),total=0
 try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break
  const bytes=Buffer.concat([carry,Buffer.from(part.value)]);total+=part.value.length
  if(total>16*1024*1024)throw new Error("Speech exceeds audio limit")
  const aligned=bytes.length-bytes.length%2;carry=Buffer.from(bytes.subarray(aligned))
  for(let start=0;start<aligned;start+=4800)yield bytes.subarray(start,Math.min(start+4800,aligned))
 }
 if(carry.length||!total)throw new Error("Incomplete PCM speech")
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
export async function speakEleven(input:string,voice:string,signal:AbortSignal){
 const parts:Buffer[]=[];for await(const part of streamEleven(input,voice,signal))parts.push(part)
 const pcm=Buffer.concat(parts),header=Buffer.alloc(44)
 header.write("RIFF");header.writeUInt32LE(36+pcm.length,4);header.write("WAVEfmt ",8)
 header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22)
 header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34)
 header.write("data",36);header.writeUInt32LE(pcm.length,40)
 return Buffer.concat([header,pcm])
}

export async function transcribeEleven(wav:Uint8Array,signal:AbortSignal,transport:typeof fetch=fetch){
 signal.throwIfAborted()
 const key=process.env.ELEVENLABS_API_KEY
 if(!key)throw new Error("ElevenLabs transcription is not configured")
 const form=new FormData()
 form.append("file",new Blob([new Uint8Array(wav)],{type:"audio/wav"}),"utterance.wav")
 form.append("model_id",process.env.ELEVENLABS_STT_MODEL_ID||"scribe_v2")
 form.append("tag_audio_events","false");form.append("diarize","false");form.append("timestamps_granularity","none")
 const res=await transport("https://api.elevenlabs.io/v1/speech-to-text",{method:"POST",redirect:"error",signal,headers:{"xi-api-key":key},body:form})
 if(!res.ok){await res.body?.cancel();throw new Error(`Speech provider rejected transcription (${res.status})`)}
 const data=await res.json() as {text?:unknown;language_code?:unknown;words?:{end?:number}[]}
 if(typeof data.text!=="string"||data.text.length>32000)throw new Error("Invalid transcription response")
 const text=normalizeTranscript(data.text.replace(/\s+/g," ").trim())
 const code=typeof data.language_code==="string"?data.language_code:null
 const language=code==="ara"?"ar":code==="eng"?"en":code
 return {text:/\p{L}|\p{N}/u.test(text)?text:"",language,durationS:null}
}
