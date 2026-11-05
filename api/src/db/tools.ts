import { randomUUID } from "node:crypto"
import { database } from "./client.ts"
import type { Customer, Order, RegionHealth, CalendarEvent, Ticket } from "../demo/originchain-db.ts"
import type { ToolResult } from "../demo/tools.ts"
type Document = {id:string;title:string;date:string;content:string;sourceUrl?:string;acl?:unknown}
type Weather = {id:string;city:string;tempC:number;condition:string;rainChance:number;wind:string}
const str = (v:unknown) => typeof v === "string" ? v.trim().slice(0,500) : ""
const ok = (summary:string,data:object):ToolResult => ({ok:true,summary,data:{...data,source:"originchain",data_kind:"demo_workspace"}})
const missing = (summary:string):ToolResult => ({ok:false,summary,data:{error:summary,source:"originchain"}})
async function customer(query:unknown,signal:AbortSignal) {
  const q=str(query).toLowerCase()
  if (!q) return undefined
  const rows=await database().list<Customer>("customers",signal)
  return rows.find(c=>c.id.toLowerCase()===q || c.name.toLowerCase()===q || ((c as Customer & {aliases?:string[]}).aliases??[]).some(alias=>alias.toLowerCase()===q)) ?? rows.find(c=>c.name.toLowerCase().includes(q) || q.includes(c.id.toLowerCase()))
}
export async function runDatabaseTool(name:string,args:Record<string,unknown>,signal:AbortSignal, context:{allowWrites?:boolean;operationId?:string}={}):Promise<ToolResult> {
  const db=database()
  switch(name) {
    case "lookup_order": {
      const id=str(args.order_id).toUpperCase().replace(/\s/g,"")
      if(id) {
        const order=await db.get<Order>("orders",id,signal)
        if(!order) return missing(`Order ${id} not found`)
        const account=await db.get<Customer>("customers",order.customerId,signal)
        return ok(`${order.id} · ${order.status.replaceAll("_"," ")} · ETA ${order.eta}`,{...order,customer:account?.name})
      }
      const account=await customer(args.customer,signal)
      if(!account) return missing("Customer not found")
      const orders=(await db.list<Order>("orders",signal)).filter(o=>o.customerId===account.id)
      return ok(`${orders.length} orders for ${account.name}`,{customer:account.name,orders})
    }
    case "get_account": {
      const account=await customer(args.customer,signal)
      if(!account) return missing("Customer not found")
      const openTickets=(await db.list<Ticket>("tickets",signal)).filter(t=>t.customerId===account.id && t.status!=="resolved")
      return ok(`${account.name} · ${account.plan} · ${account.nodes} nodes`,{...account,openTickets})
    }
    case "check_cluster_health": {
      // These are stored demo-region observations, never invented live operational telemetry.
      const q=str(args.region).toLowerCase()
      const regions=(await db.list<RegionHealth>("regions",signal)).filter(r=>!q || r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      if(!regions.length) return missing("No region observations found")
      const degraded=regions.filter(r=>r.status!=="operational")
      return ok(degraded.length?`${degraded.map(r=>r.name).join(", ")} degraded`:"Stored regions operational",{regions,observation:"stored_demo_snapshot"})
    }
    case "search_knowledge_base": {
      const terms=str(args.query).toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(t=>t.length>2) ?? []
      if(!terms.length) return missing("A search query is required")
      const rows=await db.list<Document>("documents",signal)
      const results=rows.filter(d=>!d.acl).map(d=>({d,score:terms.reduce((s,t)=>s+(d.title.toLowerCase().includes(t)?3:0)+(d.content.toLowerCase().includes(t)?1:0),0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score).slice(0,3).map(({d})=>({id:d.id,title:d.title,date:d.date,excerpt:d.content.slice(0,900),url:d.sourceUrl}))
      return ok(`${results.length} matching articles`,{results,sources:results.filter(r=>r.url).map(r=>({kind:"documentation",title:r.title,url:r.url}))})
    }
    case "check_calendar": {
      const account=args.customer?await customer(args.customer,signal):undefined
      if(args.customer && !account) return missing("Customer not found")
      const q=str(args.person).toLowerCase(), date=str(args.date)
      const rows=await db.list<CalendarEvent>("calendar",signal)
      const events=rows.filter(e=>(!account || e.customerId===account.id)&&(!q || e.attendees.some(a=>a.toLowerCase().includes(q)))&&(!date || e.start.startsWith(date))).sort((a,b)=>a.start.localeCompare(b.start))
      return ok(`${events.length} meetings`,{events,timeZone:"Asia/Kolkata"})
    }
    case "get_weather": {
      const q=str(args.city).toLowerCase()
      if(!q) return missing("A city is required")
      const hit=(await db.list<Weather>("weather",signal)).find(w=>w.city.toLowerCase().includes(q) || q.includes(w.id))
      return hit?ok(`${hit.city} · ${hit.tempC}°C · ${hit.condition}`,{...hit,observation:"stored_demo_snapshot"}):missing("No stored weather observation for this city")
    }
    case "create_support_ticket": {
      if(!context.allowWrites) return missing("Ask explicitly to open a support ticket before creating one")
      const account=await customer(args.customer,signal)
      if(!account) return missing("Customer not found")
      const summary=str(args.summary).slice(0,200)
      if(!summary) return missing("A ticket summary is required")
      const operation=context.operationId ?? randomUUID()
      const id=`SUP-${operation.replaceAll("-","").slice(0,20).toUpperCase()}`
      const existing=await db.get<Ticket>("tickets",id,signal)
      if(existing) return ok(`${existing.id} opened · ${existing.priority}`,{...existing,customer:account.name})
      const priority=["low","high","urgent"].includes(str(args.priority))?str(args.priority) as Ticket["priority"]:"normal"
      const ticket:Ticket={id,customerId:account.id,summary,priority,status:"open",created:new Date().toISOString()}
      await db.put("tickets",id,ticket,signal,operation)
      return ok(`${id} opened · ${priority}`,{...ticket,customer:account.name})
    }
    default:return missing("Unknown tool")
  }
}
