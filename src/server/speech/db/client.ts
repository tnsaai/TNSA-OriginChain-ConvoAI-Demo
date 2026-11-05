import { setTimeout as delay } from "node:timers/promises"
import { randomUUID } from "node:crypto"

export class DatabaseError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string
  constructor(status: number, code: string, requestId?: string) {
    super(`Database request failed (${status}, ${code})`)
    this.status=status; this.code=code; this.requestId=requestId
  }
}
export type DatabaseConfig = { baseUrl: string; token: string; tenant: string; namespace: string; timeoutMs: number }
export const databaseConfig = (): DatabaseConfig => ({
  baseUrl: process.env.ORIGINCHAIN_BASE_URL ?? "",
  token: process.env.ORIGINCHAIN_TOKEN ?? "",
  tenant: process.env.ORIGINCHAIN_TENANT ?? "",
  namespace: process.env.ORIGINCHAIN_NAMESPACE ?? "tnsa_speech",
  timeoutMs: Number(process.env.ORIGINCHAIN_TIMEOUT_MS ?? 8000),
})
/** HTTP engine tenant IDs use Crockford base32; dashboard UUIDs encode the same 128 bits. */
export function normalizeTenant(tenant:string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) return tenant
  const alphabet="0123456789ABCDEFGHJKMNPQRSTVWXYZ"
  let value=BigInt("0x"+tenant.replaceAll("-","")), encoded=""
  for(let i=0;i<26;i++){encoded=alphabet[Number(value%32n)]+encoded;value/=32n}
  return encoded
}
export class OriginChain {
  readonly options: DatabaseConfig
  constructor(options = databaseConfig()) {
    this.options = {...options,tenant:normalizeTenant(options.tenant)}
    if (!options.baseUrl || !options.token || !options.tenant) throw new Error("OriginChain endpoint, token and tenant are required")
    const url = new URL(options.baseUrl)
    if (url.protocol !== "https:" && !(process.env.NODE_ENV === "test" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("OriginChain requires HTTPS")
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid OriginChain base URL")
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(options.namespace)) throw new Error("Invalid database namespace")
  }
  tenantPath(path: string) { return `/v1/tenants/${encodeURIComponent(this.options.tenant)}${path}` }
  async request<T>(path: string, init: {method?: string; body?: unknown; text?: string; idempotencyKey?: string; signal?: AbortSignal} = {}): Promise<T> {
    const method = init.method ?? "GET"
    const headers: Record<string,string> = { Authorization: `Bearer ${this.options.token}` }
    if (init.text !== undefined) headers["Content-Type"] = "text/plain"
    else if (init.body !== undefined) headers["Content-Type"] = "application/json"
    if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey
    const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(this.options.timeoutMs)])
    // Retry reads and idempotent writes once, within the same overall deadline.
    const retryable = method === "GET" || !!init.idempotencyKey || path.endsWith("/query")
    for (let attempt=0;;attempt++) {
      const res = await fetch(this.options.baseUrl.replace(/\/$/, "") + path, {method, headers, body:init.text ?? (init.body === undefined ? undefined : JSON.stringify(init.body)), signal, redirect:"error"})
      if (!res.ok) {
        const retryAfter = Number(res.headers.get("retry-after") ?? "0")
        const error = await res.json().catch(() => ({})) as {error?: string; request_id?: string}
        if (attempt === 0 && retryable && [429,502,503,504].includes(res.status) && retryAfter <= 2) {
          await delay(Math.max(200, retryAfter * 1000), undefined, {signal}); continue
        }
        throw new DatabaseError(res.status, typeof error.error === "string" ? error.error.slice(0,80) : "request_failed", error.request_id)
      }
      // Never report a durability-degraded write as a confirmed successful ticket.
      if (res.headers.get("x-oc-replication") === "degraded") throw new DatabaseError(503,"replication_degraded")
      const body = await res.text()
      return (body ? JSON.parse(body) : undefined) as T
    }
  }
  schemas(signal?: AbortSignal) { return this.request<string[]>(this.tenantPath("/schemas"), {signal}) }
  ready(signal?: AbortSignal) { return this.request<{read_ready:boolean; write_ready:boolean; status:string}>("/ready?require=write", {signal}) }
  schema(table: string) {
    if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error("Invalid table")
    return `${this.options.namespace}.${table}`
  }
  async list<T>(table: string, signal?: AbortSignal): Promise<T[]> {
    const rows = await this.request<{id:string; payload:string}[]>(this.tenantPath("/query"), {method:"POST",body:{op:"limit",n:500,child:{op:"scan",schema:this.schema(table)}},signal})
    if (!Array.isArray(rows)) throw new DatabaseError(502,"invalid_response")
    if (rows.length >= 500) throw new DatabaseError(503,"dataset_limit_exceeded")
    return rows.map(row => JSON.parse(row.payload) as T)
  }
  async get<T>(table: string, id: string, signal?: AbortSignal): Promise<T | null> {
    try {
      const row = await this.request<{payload:string}>(this.tenantPath(`/rows/${this.schema(table)}/${encodeURIComponent(id)}`), {signal})
      return JSON.parse(row.payload) as T
    } catch (e) { if (e instanceof DatabaseError && e.status === 404) return null; throw e }
  }
  put(table: string, id: string, value: unknown, signal?: AbortSignal, idempotencyKey: string = randomUUID()) {
    return this.request(this.tenantPath(`/rows/${this.schema(table)}`), {method:"POST",body:{id,payload:JSON.stringify(value)},idempotencyKey,signal})
  }
}
let singleton: OriginChain | undefined
export const database = () => singleton ??= new OriginChain()
export const TABLES = ["customers","orders","regions","calendar","tickets","documents","weather"] as const
