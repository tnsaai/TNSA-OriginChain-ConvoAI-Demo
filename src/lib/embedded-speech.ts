import {randomBytes} from "node:crypto"
import type {AddressInfo} from "node:net"

let endpoint: Promise<{base:string; key:string}> | undefined

/** Start the shared HTTP handler inside the Next.js process. */
export function embeddedSpeech() {
  endpoint ??= start().catch(error => {
    endpoint = undefined
    throw error
  })
  return endpoint
}

async function start() {
  process.env.SANSAR_HOSTED_ONLY = "1"
  process.env.SPEECH_API_KEYS ||= randomBytes(32).toString("hex")
  const {config} = await import("../server/speech/config.ts")
  const key = config.apiKeys[0]
  if (!key) throw new Error("SPEECH_API_KEYS is required")
  const {server} = await import("../server/speech/server.ts")
  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject)
        server.unref()
        resolve()
      })
    })
  }
  return {base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, key}
}
