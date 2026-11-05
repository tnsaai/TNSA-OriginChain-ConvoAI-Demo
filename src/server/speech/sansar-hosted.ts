import type {ChatMessage, ToolCall} from "./upstream.ts"

type OmniEvent =
  | {type:"text.delta"; text:string}
  | {type:"audio.delta"; pcm16:string; sample_rate:number}
  | {type:"tool.call"; call:ToolCall}
  | {type:"done"; finish_reason:"stop"|"tool_calls"}
  | {type:"error"; code:string}

export async function* streamHostedSansar(messages:ChatMessage[],tools:unknown[],signal:AbortSignal,outputMode?:"audio"):AsyncGenerator<OmniEvent> {
  const key=process.env.TNSA_API_KEY
  if(!key)throw new Error("Hosted Sansar requires TNSA_API_KEY")
  const res=await fetch("https://api.tnsaai.com/omni",{
    method:"POST",signal,redirect:"error",
    headers:{"x-api-key":key,"Content-Type":"application/json",Accept:"text/event-stream"},
    body:JSON.stringify({model:"NGen-4.5-Sansar",messages,tools,max_output_tokens:256,...(outputMode?{output_mode:outputMode}:{})}),
  })
  if(!res.ok||!res.body){
    await res.body?.cancel()
    throw new Error(`Hosted Sansar unavailable (${res.status})`)
  }
  const reader=res.body.getReader()
  const decoder=new TextDecoder()
  let pending=""
  try {
    while(true){
      const part=await reader.read()
      pending+=decoder.decode(part.value,{stream:!part.done})
      if(pending.length>512*1024)throw new Error("Hosted Sansar event exceeds limit")
      let boundary:RegExpMatchArray|null
      while((boundary=pending.match(/\r?\n\r?\n/))){
        const index=boundary.index!
        const frame=pending.slice(0,index).split(/\r?\n/)
        pending=pending.slice(index+boundary[0].length)
        const data=frame.filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n")
        if(!data)continue
        const parsed=JSON.parse(data)
        const type=frame.find(line=>line.startsWith("event:"))?.slice(6).trim()||parsed.type
        const event={...parsed,type} as OmniEvent
        if(event.type==="error")throw new Error("Hosted Sansar generation failed")
        if(event.type==="audio.delta"&&(event.sample_rate!==24000||typeof event.pcm16!=="string"))throw new Error("Invalid hosted Sansar audio")
        yield event
        if(event.type==="done")return
      }
      if(part.done)throw new Error("Hosted Sansar stream ended before done")
    }
  } finally {
    await reader.cancel().catch(()=>{})
    reader.releaseLock()
  }
}
