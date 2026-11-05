// Types for the OriginChainDB knowledge base (copied from the Platform's Sandarbh engine).

export type Role = "admin" | "editor" | "viewer"

/** Same memory taxonomy as the Python engine (schemas.MemoryType). */
export type MemoryType =
  | "episodic"
  | "semantic"
  | "working"
  | "user"
  | "organizational"
  | "task"
  | "interaction"
  | "context"
  | "output"
  | "source"

export type TaskClass = "factual" | "analytical" | "creative" | "correction"

export type SeedFact = { entity: string; attribute: string; value: string }

export type SeedDocument = {
  id: string
  title: string
  kind: string
  date: string
  importance: number
  content: string
  /** Roles allowed to read; omitted = everyone in the tenant. */
  acl?: Role[]
  facts?: SeedFact[]
}

export type SeedEntity = { id: string; label: string; kind: string; aliases: string[] }

export type TenantSeed = {
  id: string
  name: string
  tagline: string
  assistantName: string
  entities: SeedEntity[]
  relations: { from: string; to: string; rel: string }[]
  documents: SeedDocument[]
}
