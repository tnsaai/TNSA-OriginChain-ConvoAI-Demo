// Mock OriginChainDB back office for the Realtime Voice playground.
// Fictional customers, orders and figures, consistent with the Context Playground tenant. Server-only.

export type Customer = {
  id: string
  name: string
  plan: "Starter" | "Growth" | "Enterprise"
  region: string
  contact: { name: string; role: string; email: string }
  nodes: number
  arrInr: number
  renewal: string
}

export type Order = {
  id: string
  customerId: string
  item: string
  quantity: number
  placed: string
  status: "processing" | "provisioning" | "shipped" | "delivered" | "on_hold"
  eta: string
  carrier?: string
  tracking?: string
  lastUpdate: string
  note?: string
}

export type RegionHealth = {
  id: string
  name: string
  status: "operational" | "degraded" | "maintenance"
  replicationLagMs: number
  nodesHealthy: number
  nodesTotal: number
  p99WriteMs: number
  incident?: string
}

export type CalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  attendees: string[]
  customerId?: string
  location: string
}

export type Ticket = {
  id: string
  customerId: string
  summary: string
  priority: "low" | "normal" | "high" | "urgent"
  status: "open" | "investigating" | "resolved"
  created: string
}

export const CUSTOMERS: Customer[] = [
  {
    id: "meridian",
    name: "Meridian Logistics",
    plan: "Growth",
    region: "ap-south-1",
    contact: { name: "Priya Nair", role: "Head of Platform", email: "priya.nair@meridian.example" },
    nodes: 12,
    arrInr: 4_200_000,
    renewal: "2027-01-15",
  },
  {
    id: "kestrel",
    name: "ABC",
    plan: "Enterprise",
    region: "eu-central-1",
    contact: { name: "Jonas Weber", role: "CTO", email: "jonas.weber@kestrel.example" },
    nodes: 32,
    arrInr: 18_600_000,
    renewal: "2026-12-01",
  },
  {
    id: "harbor",
    name: "Harbor Pay",
    plan: "Enterprise",
    region: "us-east-1",
    contact: { name: "Dana Brooks", role: "VP Engineering", email: "dana.brooks@harborpay.example" },
    nodes: 24,
    arrInr: 12_900_000,
    renewal: "2027-04-30",
  },
  {
    id: "sahyadri",
    name: "Sahyadri Agritech",
    plan: "Starter",
    region: "ap-south-1",
    contact: { name: "Rohan Kulkarni", role: "Founder", email: "rohan@sahyadri.example" },
    nodes: 3,
    arrInr: 640_000,
    renewal: "2026-11-20",
  },
]

export const ORDERS: Order[] = [
  {
    id: "OC-20417",
    customerId: "meridian",
    item: "Ledger node expansion (HSM-backed appliance)",
    quantity: 4,
    placed: "2026-10-09",
    status: "shipped",
    eta: "2026-10-24",
    carrier: "BlueDart",
    tracking: "BD7781204561IN",
    lastUpdate: "Departed Bhiwandi hub, out for regional delivery",
  },
  {
    id: "OC-20388",
    customerId: "kestrel",
    item: "Zero-knowledge audit proofs add-on (v3.3 early access)",
    quantity: 1,
    placed: "2026-10-02",
    status: "provisioning",
    eta: "2026-10-28",
    lastUpdate: "Waiting for Frankfurt replication to stabilise after INC-2291",
    note: "Provisioning is paused on the Frankfurt cluster until replication lag is under 50 ms.",
  },
  {
    id: "OC-20452",
    customerId: "harbor",
    item: "Dedicated audit export pipeline",
    quantity: 1,
    placed: "2026-10-18",
    status: "processing",
    eta: "2026-11-04",
    lastUpdate: "Security review approved, capacity reserved in us-east-1",
  },
  {
    id: "OC-20311",
    customerId: "sahyadri",
    item: "Starter to Growth plan upgrade",
    quantity: 1,
    placed: "2026-09-21",
    status: "on_hold",
    eta: "pending",
    lastUpdate: "Awaiting purchase order from customer finance",
  },
  {
    id: "OC-20199",
    customerId: "meridian",
    item: "Mumbai residency attestation pack",
    quantity: 1,
    placed: "2026-08-30",
    status: "delivered",
    eta: "2026-09-06",
    lastUpdate: "Delivered and countersigned by Priya Nair",
  },
]

export const REGIONS: RegionHealth[] = [
  { id: "ap-south-1", name: "Mumbai", status: "operational", replicationLagMs: 18, nodesHealthy: 48, nodesTotal: 48, p99WriteMs: 41 },
  {
    id: "eu-central-1",
    name: "Frankfurt",
    status: "degraded",
    replicationLagMs: 212,
    nodesHealthy: 37,
    nodesTotal: 40,
    p99WriteMs: 96,
    incident: "INC-2291: elevated replication lag after a storage firmware rollout. Mitigation in progress, ETA 2 hours.",
  },
  { id: "us-east-1", name: "Virginia", status: "operational", replicationLagMs: 22, nodesHealthy: 56, nodesTotal: 56, p99WriteMs: 38 },
]

export const CALENDAR: CalendarEvent[] = [
  {
    id: "ev-1",
    title: "Meridian quarterly business review",
    start: "2026-10-23T10:30:00+05:30",
    end: "2026-10-23T11:30:00+05:30",
    attendees: ["Priya Nair", "Aarav Mehta (AE)", "Isha Rao (SE)"],
    customerId: "meridian",
    location: "Meridian HQ, Mumbai",
  },
  {
    id: "ev-2",
    title: "Kestrel incident follow-up (INC-2291)",
    start: "2026-10-22T18:00:00+05:30",
    end: "2026-10-22T18:30:00+05:30",
    attendees: ["Jonas Weber", "SRE on call", "Isha Rao (SE)"],
    customerId: "kestrel",
    location: "Video call",
  },
  {
    id: "ev-3",
    title: "Harbor Pay audit pipeline kickoff",
    start: "2026-10-27T20:00:00+05:30",
    end: "2026-10-27T21:00:00+05:30",
    attendees: ["Dana Brooks", "Aarav Mehta (AE)"],
    customerId: "harbor",
    location: "Video call",
  },
  {
    id: "ev-4",
    title: "Sahyadri upgrade check-in",
    start: "2026-10-24T15:00:00+05:30",
    end: "2026-10-24T15:30:00+05:30",
    attendees: ["Rohan Kulkarni", "Isha Rao (SE)"],
    customerId: "sahyadri",
    location: "Pune office",
  },
]

export const WEATHER: Record<string, { city: string; tempC: number; condition: string; rainChance: number; wind: string }> = {
  mumbai: { city: "Mumbai", tempC: 31, condition: "Humid with passing showers", rainChance: 60, wind: "SW 14 km/h" },
  pune: { city: "Pune", tempC: 27, condition: "Partly cloudy", rainChance: 20, wind: "W 9 km/h" },
  bengaluru: { city: "Bengaluru", tempC: 24, condition: "Overcast, light drizzle in the evening", rainChance: 45, wind: "E 11 km/h" },
  delhi: { city: "Delhi", tempC: 29, condition: "Hazy sunshine", rainChance: 5, wind: "NW 7 km/h" },
  frankfurt: { city: "Frankfurt", tempC: 9, condition: "Cool and cloudy", rainChance: 35, wind: "W 18 km/h" },
  virginia: { city: "Ashburn, Virginia", tempC: 14, condition: "Clear skies", rainChance: 10, wind: "N 12 km/h" },
}

// Tickets created during the demo live in memory for the life of the dev server.
const tickets: Ticket[] = [
  {
    id: "SUP-7731",
    customerId: "kestrel",
    summary: "Write latency spikes in Frankfurt since Monday",
    priority: "high",
    status: "investigating",
    created: "2026-10-20T09:12:00Z",
  },
]

export function findCustomer(query: string): Customer | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  return CUSTOMERS.find(
    (c) => c.id === q || c.name.toLowerCase().includes(q) || q.includes(c.id) || q.includes(c.name.toLowerCase().split(" ")[0])
  )
}

export function listTickets(customerId?: string) {
  return tickets.filter((t) => !customerId || t.customerId === customerId)
}

export function createTicket(input: Omit<Ticket, "id" | "status" | "created">): Ticket {
  const ticket: Ticket = {
    ...input,
    id: `SUP-${7732 + tickets.length}`,
    status: "open",
    created: new Date().toISOString(),
  }
  tickets.push(ticket)
  return ticket
}
