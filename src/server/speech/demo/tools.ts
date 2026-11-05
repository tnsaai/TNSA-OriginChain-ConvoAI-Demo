import { database } from "../db/client.ts"
import { runDatabaseTool } from "../db/tools.ts"
// Tool contracts for the voice agent. Execution uses the persistent OriginChainDB repository.


export type ToolResult = { ok: boolean; summary: string; data: unknown }

type ToolDef = {
  name: string
  /** Spoken while the tool runs, e.g. "Let me pull up that order." */
  narration: (args: Record<string, unknown>) => string
  schema: { description: string; parameters: Record<string, unknown> }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")

const TOOLS: ToolDef[] = [
  {
    name: "lookup_order",
    narration: (a) => (str(a.order_id) ? `Let me pull up order ${str(a.order_id)}.` : `Let me check ${str(a.customer) || "their"} orders.`),
    schema: {
      description: "Look up an OriginChainDB order by order id (like OC-20417) or list a customer's orders. Returns status, ETA and tracking.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Order id, e.g. OC-20417" },
          customer: { type: "string", description: "Customer name, e.g. Meridian Logistics" },
        },
      },
    },
  },
  {
    name: "get_account",
    narration: (a) => `Opening the ${str(a.customer) || "customer"} account.`,
    schema: {
      description: "Get a customer account: plan, region, node count, ARR, renewal date, primary contact and open support tickets.",
      parameters: {
        type: "object",
        properties: { customer: { type: "string", description: "Customer name" } },
        required: ["customer"],
      },
    },
  },
  {
    name: "check_cluster_health",
    narration: (a) => `Checking stored cluster health${str(a.region) ? ` in ${str(a.region)}` : ""}.`,
    schema: {
      description: "Stored demo observations for OriginChainDB regions: status, replication lag, healthy nodes, p99 write latency and active incidents.",
      parameters: {
        type: "object",
        properties: { region: { type: "string", description: "Region name or id (Mumbai, Frankfurt, Virginia). Omit for all." } },
      },
    },
  },
  {
    name: "search_knowledge_base",
    narration: () => "Searching the knowledge base.",
    schema: {
      description: "Search OriginChainDB product docs, pricing, SLAs, residency, incident reports and release notes.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "What to search for" } },
        required: ["query"],
      },
    },
  },
  {
    name: "check_calendar",
    narration: () => "Looking at the calendar.",
    schema: {
      description: "Account team calendar. Find meetings by customer, person or date (YYYY-MM-DD).",
      parameters: {
        type: "object",
        properties: {
          customer: { type: "string" },
          person: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
        },
      },
    },
  },
  {
    name: "get_weather",
    narration: (a) => `Checking the weather in ${str(a.city) || "that city"}.`,
    schema: {
      description: "Stored demo weather for a city (sample data for Mumbai, Pune, Bengaluru, Delhi, Frankfurt, Virginia).",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
  {
    name: "create_support_ticket",
    narration: (a) => `Opening a support ticket for ${str(a.customer) || "the customer"}.`,
    schema: {
      description: "Open a support ticket for a customer. Only call when the user asks to open, file or raise a ticket.",
      parameters: {
        type: "object",
        properties: {
          customer: { type: "string" },
          summary: { type: "string", description: "One-line problem summary" },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        },
        required: ["customer", "summary"],
      },
    },
  },
]

export const TOOL_SPECS = TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, ...t.schema } }))

export function toolNarration(name: string, args: Record<string, unknown>) {
  return TOOLS.find((t) => t.name === name)?.narration(args) ?? "Let me check that."
}

export async function runTool(name: string, args: Record<string, unknown>, signal: AbortSignal, context: {allowWrites?: boolean;operationId?:string} = {}): Promise<ToolResult & {ms: number}> {
  const started = Date.now()
  signal.throwIfAborted()
  try {
    const result = await runDatabaseTool(name, args, signal, context)
    const tables: Record<string,string>={lookup_order:"orders",get_account:"customers",check_cluster_health:"regions",search_knowledge_base:"documents",check_calendar:"calendar",get_weather:"weather",create_support_ticket:"tickets"}
    const data = result.data && typeof result.data === "object" ? result.data as Record<string,unknown> : {}
    const documented = Array.isArray(data.sources) ? data.sources : []
    const sources = result.ok && tables[name] ? [{kind:"database",title:"OriginChainDB",schema:database().schema(tables[name]),...(typeof data.id === "string"?{record_id:data.id}:{})},...documented] : documented
    return {...result,data:{...data,sources}, ms: Date.now() - started}
  } catch (e) {
    if (signal.aborted) throw e
    console.error(JSON.stringify({event:"database_tool_failed", tool:name, error:e instanceof Error?e.name:"Error"}))
    return {ok:false, summary:"Database temporarily unavailable", data:{error:"The database could not complete the lookup. Please try again."}, ms:Date.now()-started}
  }
}
