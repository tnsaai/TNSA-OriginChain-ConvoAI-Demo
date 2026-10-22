import { Resolver } from "node:dns"
import { Agent } from "undici"

// Optional server-only resolver override. TLS still verifies the API hostname normally.
// Leave unset in environments whose resolver already sees the newly published hostname.
const dnsServer = process.env.SPEECH_DNS_SERVER
const resolver = dnsServer ? new Resolver({ timeout: 3000, tries: 2 }) : undefined
if (dnsServer) resolver!.setServers([dnsServer])
export const speechDispatcher = resolver ? new Agent({connect:{lookup(hostname, options, callback) {
  resolver.resolve4(hostname, (error, addresses) => {
    if (error) { callback(error, "", 4); return }
    if (options.all) callback(null, addresses.map(address => ({address, family:4})))
    else callback(null, addresses[0], 4)
  })
}}}) : undefined

export { fetch as speechFetch } from "undici"
