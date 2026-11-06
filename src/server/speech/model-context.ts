import {AsyncLocalStorage} from "node:async_hooks"
export type ModelId="ngen-4.5-sansar"|"ngen-4-realtime"
export const MODEL_OPTIONS:{id:ModelId;label:string;provider:"anumana"|"remote"}[]=[
 {id:"ngen-4-realtime" as const,label:"NGen 4 Realtime",provider:"remote" as const},
]
export const modelContext=new AsyncLocalStorage<{id:ModelId;provider:"anumana"|"remote"}>()
export function selectedModel(){return MODEL_OPTIONS.find(m=>m.id===modelContext.getStore()?.id)??MODEL_OPTIONS[0]}
export function resolveModel(value:unknown){return MODEL_OPTIONS.find(m=>m.id===value)}
