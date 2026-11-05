import {streamHostedSansar} from "./sansar-hosted.ts"
// Native inference adapter. OriginChain tool execution stays in agent.ts/db/tools.ts.
import { config,PUBLIC_MODELS } from "./config.ts"
import type { ChatChunk,ChatMessage } from "./upstream.ts"
const endpoint=()=>{
 const url=new URL(process.env.ANUMANA_API_URL||"http://127.0.0.1:8766")
 if(url.protocol!=="http:"||!["127.0.0.1","localhost"].includes(url.hostname))throw new Error("Anumana inference must be loopback HTTP")
 return url
}
async function request(operation:string,body:unknown,signal:AbortSignal){
 const response=await fetch(new URL(`/api/${operation}`,endpoint()),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal,redirect:"error"})
 if(!response.ok)throw new Error(`Anumana ${operation} failed (${response.status})`)
 return response
}
export async function transcribeNative(wav:Uint8Array,signal:AbortSignal){
 const response=await request("transcribe",{wav:Buffer.from(wav).toString("base64")},signal)
 const data=await response.json() as {text:string;language:string|null;durationS:number|null}
 return {text:data.text,language:data.language,durationS:data.durationS}
}
export async function speakNative(input:string,voice:string,signal:AbortSignal){
 const male=["daniel","fahad"].includes(voice),arabic=["noura","lulwa","fahad"].includes(voice)
 return Buffer.from(await (await request("synthesize",{input,gender:male?"male":"female",language:arabic?"ar":"en"},signal)).arrayBuffer())
}
export async function* chatNative(opts:{messages:ChatMessage[];tools:unknown[];toolChoice:"auto"|"required";signal:AbortSignal;planningOnly?:boolean}):AsyncGenerator<ChatChunk>{
 if(process.env.TNSA_API_KEY||process.env.SANSAR_HOSTED_ONLY==="1"){
  const messages=[...opts.messages]
  if(opts.toolChoice==="required")messages.push({role:"system",content:"Call the appropriate tool before answering. Use its result for factual claims."})
  let index=0
  for await(const event of streamHostedSansar(messages,opts.tools,opts.signal)){
   if(event.type==="tool.call")yield {choices:[{delta:{tool_calls:[{index:index++,id:event.call.id,function:event.call.function}]}}]}
   if(event.type==="text.delta"&&!opts.planningOnly)yield {choices:[{delta:{content:event.text}}]}
  }
  if(opts.toolChoice==="required"&&!index)throw new Error("Hosted Sansar did not produce a required tool call")
  return
 }
 const messages=opts.messages.map(m=>({...m}))
 messages.push({role:"system",content: !opts.tools.length ? "Tools are unavailable for this final reply. Respond only with brief spoken text using the provided results. Empty lists mean no matching records. Do not invent missing details or promise another lookup." :
  "Native tool protocol: to call a function, output <tool_call>\n<function=FUNCTION_NAME>\n<parameter=PARAMETER_NAME>\nVALUE\n</parameter>\n</function>\n</tool_call>. Replace placeholders using an available function and its parameter schema. Repeat parameter blocks for additional arguments. String values are plain text, other values are JSON. Never print JSON tool_calls. Tool markup is executed, not spoken. " +
  (opts.toolChoice==="required" ? "A tool is REQUIRED now. Output only the appropriate tool call(s), without acknowledgement or other prose. Do not answer until results arrive." : "If tool results already cover the question, answer from them directly. Otherwise call tools for missing facts; do not claim to check without a call.")})
 if(opts.planningOnly)messages.push({role:"system",content:"You are planning tool actions only. If existing tool results cover this request, output exactly <ready> and stop. Otherwise output only the missing function call(s) using the native tool protocol. Do not write an answer or acknowledgement."})
 const response=await request("chat",{messages,tools:opts.tools},opts.signal)
 if(!response.body)throw new Error("Anumana returned no completion stream")
 const reader=response.body.getReader(),decoder=new TextDecoder();let pending="",visible="",emitted=0,insideTool=false,done=false
 const handle=(event:{type:string;text?:string;detail?:string;tool_calls?:{id:string;function:{name:string;arguments:string}}[]}):ChatChunk[]=>{
  if(event.type==="error")throw new Error("Anumana tool completion failed: "+event.detail)
  if(event.type==="text"){
   visible+=event.text||""
   // Never let executable model markup reach spoken narration, including split prefixes.
   const marker=visible.indexOf("<tool_call>")
   if(marker>=0)insideTool=true
   let end=marker>=0?marker:visible.length
   if(!insideTool){const tail=visible.lastIndexOf("<");if(tail>=emitted && "<tool_call>".startsWith(visible.slice(tail)))end=tail}
   if(end>emitted && (!insideTool||marker>=emitted)){const content=visible.slice(emitted,end);emitted=end;return [{choices:[{delta:{content}}]}]}
  }
  if(event.type==="done"){
   if(opts.toolChoice==="required" && !event.tool_calls?.length)throw new Error("Native model did not produce the required tool call")
   done=true;const chunks:ChatChunk[]=[]
   if(!event.tool_calls?.length && (event.text||"").length>emitted)chunks.push({choices:[{delta:{content:event.text!.slice(emitted)}}]})
   if(event.tool_calls?.length)chunks.push({choices:[{delta:{tool_calls:event.tool_calls.map((call,index)=>({index,id:call.id,function:call.function}))}}]})
   return chunks
  }
  return []
 }
 try{
  while(true){const part=await reader.read();pending+=decoder.decode(part.value,{stream:!part.done})
   if(pending.length>256*1024)throw new Error("Native completion stream too large")
   let newline;while((newline=pending.indexOf("\n"))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(line.trim())for(const chunk of handle(JSON.parse(line)))yield chunk}
   if(part.done){if(pending.trim())for(const chunk of handle(JSON.parse(pending)))yield chunk;break}
  }
  if(!done)throw new Error("Native completion ended before done")
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}

/** Generate the grounded answer and speech together; forward PCM as soon as it exists. */
export async function streamNativeAnswer(messages:ChatMessage[],lang:string,send:(event:string,data:Record<string,unknown>)=>void,signal:AbortSignal){
 const originalSystem=messages.find(m=>m.role==="system")?.content||"You are the OriginChainDB voice assistant."
 const conversation=messages.filter(m=>m.role==="user"||m.role==="assistant"||m.role==="tool").slice(-20)
 const compact:ChatMessage[]=[{role:"system",content:originalSystem+
  " Respond with interleaved text and audio in "+(lang==="ar"?"Arabic":"English")+". Tool execution is complete. Give one or two short sentences answering the user from the tool responses below. Copy numeric facts exactly from the matching record and requested pricing tier. Preserve units and qualifiers such as per node per month. Empty calendar events mean no matching meetings, not lack of access. Never claim you cannot access records when tool results are provided. Do not repeat acknowledgements. Do not call more tools."},...conversation]
 if(process.env.TNSA_API_KEY||process.env.SANSAR_HOSTED_ONLY==="1"){
  let sequence=0
  for await(const event of streamHostedSansar(compact,[],signal,"audio")){
   if(event.type==="text.delta")send("response.text.delta",{delta:event.text,source:"model"})
   if(event.type==="audio.delta")send("response.audio.delta",{sequence:sequence++,format:"pcm16",sample_rate:event.sample_rate,channels:1,audio:event.pcm16,model:PUBLIC_MODELS.agent})
   if(event.type==="tool.call"||(event.type==="done"&&event.finish_reason!=="stop"))throw new Error("Unexpected tool call in hosted spoken reply")
  }
  if(!sequence)throw new Error("Hosted Sansar returned no spoken audio")
  return
 }
 const res=await request("answer",{messages:compact,tools:[]},signal)
 if(!res.body)throw new Error("Native audio stream missing")
 const reader=res.body.getReader(),decoder=new TextDecoder();let pending="",done=false,sequence=0
 const handle=(event:{type:string;text?:string;pcm16?:string;sample_rate?:number;metrics?:unknown;detail?:string})=>{
  if(event.type==="error")throw new Error("Native audio generation failed")
  if(event.type==="text")send("response.text.delta",{delta:event.text||"",source:"model"})
  if(event.type==="audio"&&event.pcm16)send("response.audio.delta",{sequence:sequence++,format:"pcm16",sample_rate:event.sample_rate||24000,channels:1,audio:event.pcm16,model:PUBLIC_MODELS.agent})
  if(event.type==="done"){done=true;send("response.inference.metrics",{metrics:event.metrics,audio_chunks:sequence})}
 }
 try{while(true){const part=await reader.read();pending+=decoder.decode(part.value,{stream:!part.done});if(pending.length>256*1024)throw new Error("Native audio event too large")
  let newline;while((newline=pending.indexOf("\n"))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);if(line.trim())handle(JSON.parse(line))}
  if(part.done){if(pending.trim())handle(JSON.parse(pending));break}}
  if(!done)throw new Error("Native audio stream ended before done")
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
}
