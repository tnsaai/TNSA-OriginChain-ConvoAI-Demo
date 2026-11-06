import { database } from "../db/client.ts"

const DATASETS = {
  products: {schema: "store.products", sql: "SELECT id, name, price_inr, rating_avg, rating_count FROM store.products ORDER BY rating_avg DESC LIMIT 10"},
  orders_by_channel: {schema: "store.orders", sql: "SELECT channel, COUNT(*) AS order_count FROM store.orders GROUP BY channel LIMIT 20"},
  low_stock: {schema: "academy_industry_20261029_1308.inventory_replenishment", sql: "SELECT id, on_hand, reserved, safety_stock FROM academy_industry_20261029_1308.inventory_replenishment WHERE on_hand - reserved <= safety_stock LIMIT 20"},
  fund_categories: {schema: "mf.categories", sql: "SELECT category, scheme_count FROM mf.categories LIMIT 60"},
} as const

export const TOOL_SPECS = [{
  type: "function" as const,
  function: {
    name: "query_originchain",
    description: "Read the connected OriginChain database for product ratings, orders by sales channel, low-stock inventory, or mutual fund categories.",
    parameters: {
      type: "object",
      properties: {dataset: {type: "string", enum: Object.keys(DATASETS)}},
      required: ["dataset"],
    },
  },
}]

export type ToolResult = {ok:boolean;summary:string;data:unknown}

export function toolNarration(_name:string, _args:Record<string,unknown>) { return "I’ll check the database." }

export async function runTool(name: string, args: Record<string, unknown>, signal: AbortSignal, _context: {allowWrites?:boolean;operationId?:string} = {}) {
  const start=Date.now()
  if (name !== "query_originchain" || typeof args.dataset !== "string" || !(args.dataset in DATASETS))
    return {ok:false, summary:"Unsupported database request", data:{error:"Choose a supported dataset."}, ms:Date.now()-start}
  const dataset=args.dataset as keyof typeof DATASETS
  const spec=DATASETS[dataset]
  try {
    const db=database()
    const response=await db.request<{kind:string;rows:Record<string,unknown>[]}>(db.tenantPath("/sql"), {
      method:"POST", body:{sql:spec.sql}, signal,
    })
    if(response.kind!=="select" || !Array.isArray(response.rows)) throw new Error("Invalid database response")
    return {ok:true,summary:`Read ${response.rows.length} database records`,data:{result:response.rows,count:response.rows.length,limit:dataset==="products"?10:dataset==="fund_categories"?60:20,sources:[{kind:"database",title:"OriginChainDB",schema:spec.schema}]},ms:Date.now()-start}
  } catch(error) {
    if(signal.aborted)throw error
    console.error("OriginChain lookup failed", error instanceof Error ? error.name : "unknown", (error as {status?:number})?.status ?? "")
    return {ok:false,summary:"Database lookup failed",data:{error:"The database query could not be completed."},ms:Date.now()-start}
  }
}
