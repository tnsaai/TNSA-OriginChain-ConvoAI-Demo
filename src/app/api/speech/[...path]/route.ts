import { speechDispatcher, speechFetch } from "@/lib/speech-transport"
import { createPublicKey, verify, type JsonWebKey } from "node:crypto"
export const runtime = "nodejs"
export const maxDuration = 120
const routes = new Set(["agent/turn", "audio/transcriptions", "audio/speech", "audio/turn", "voices", "sources"])
let certs: { at: number; keys: (JsonWebKey & { kid: string })[] } | undefined
async function authorized(req: Request): Promise<boolean> {
  // Public standalone demo: no login. Access verification is opt-in for private deployments.
  if (process.env.WEB_AUTH_MODE !== "cloudflare") return true
  const team = process.env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, "")
  const aud = process.env.CF_ACCESS_AUD
  if (!team || !aud || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return false
  const token = req.headers.get("cf-access-jwt-assertion") || req.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith("CF_Authorization="))?.slice(17)
  if (!token) return false
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return false
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString())
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString())
    const now = Date.now() / 1000
    if (header.alg !== "RS256" || claims.iss !== team || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now) || ![claims.aud].flat().includes(aud)) return false
    if (!certs || Date.now() - certs.at > 300000) {
      const response = await fetch(`${team}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000), cache: "no-store" })
      if (!response.ok) return false
      certs = { at: Date.now(), keys: (await response.json()).keys }
    }
    const key = certs.keys.find(k => k.kid === header.kid)
    return !!key && verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({key, format:"jwk"}), Buffer.from(parts[2], "base64url"))
  } catch { return false }
}
async function relay(req: Request, context: { params: Promise<{path: string[]}> }) {
  if (!await authorized(req)) return Response.json({error:"Sign in through the protected demo domain."}, {status:401})
  const path = (await context.params).path.join("/")
  if (!routes.has(path) || (req.method === "GET") !== (["voices","sources"].includes(path))) return Response.json({error:"Not found"}, {status:404})
  const origin = req.headers.get("origin")
  if (origin && origin !== new URL(req.url).origin) return Response.json({error:"Origin not allowed"},{status:403})
  const base = process.env.SPEECH_API_URL || "http://127.0.0.1:8787"
  const headers = new Headers({"Content-Type":req.headers.get("content-type") || "application/json"})
  if (process.env.SPEECH_API_KEY) headers.set("Authorization", `Bearer ${process.env.SPEECH_API_KEY}`)
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", process.env.CF_ACCESS_CLIENT_ID)
    headers.set("CF-Access-Client-Secret", process.env.CF_ACCESS_CLIENT_SECRET)
  }
  try {
    // Stream bodies with a limit, without buffering audio twice on Vercel.
    let size = 0
    const limit = path === "audio/transcriptions" ? 4 * 1024 * 1024 : 256 * 1024
    const body = req.body?.pipeThrough(new TransformStream({transform(chunk, controller) {
      size += chunk.byteLength
      if (size > limit) throw new Error("Request too large")
      controller.enqueue(chunk)
    }}))
    const upstream = await speechFetch(`${base.replace(/\/$/, "")}/v1/${path}`, {dispatcher:speechDispatcher,method:req.method,headers,body,signal:AbortSignal.any([req.signal, AbortSignal.timeout(110000)]),redirect:"error",duplex:"half"} as Parameters<typeof speechFetch>[1])
    if (!upstream.ok) return Response.json({error: upstream.status === 429 ? "Too many requests. Try again shortly." : "The speech service could not complete this request."}, {status:upstream.status})
    return new Response(upstream.body as unknown as ReadableStream<Uint8Array> | null, {headers:{"Content-Type":upstream.headers.get("content-type") || "application/octet-stream","Cache-Control":"no-store, no-transform","X-Accel-Buffering":"no"}})
  } catch { return Response.json({error:"The speech service is temporarily unavailable."}, {status:502}) }
}
export { relay as GET, relay as POST }
