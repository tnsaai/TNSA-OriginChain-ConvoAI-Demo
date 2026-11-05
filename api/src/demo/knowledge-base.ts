// OriginChainDB demo tenant for the Sandarbh Context Playground.
// Fictional company, customers and figures. Safe to show publicly.

import type { TenantSeed } from "./kb-types.ts"

export const ORIGINCHAINDB: TenantSeed = {
  id: "originchaindb",
  name: "OriginChainDB",
  tagline: "Tamper-evident ledger database for regulated industries",
  assistantName: "OriginChainDB Copilot",
  entities: [
    { id: "meridian", label: "Meridian Logistics", kind: "customer", aliases: ["meridian", "meridian logistics"] },
    { id: "priya", label: "Priya Nair", kind: "person", aliases: ["priya", "priya nair"] },
    { id: "kestrel", label: "ABC", kind: "customer", aliases: ["abc", "kestrel", "kestrel health", "kestral"] },
    { id: "ledger-db", label: "OriginChain Ledger DB", kind: "product", aliases: ["ledger db", "originchain ledger", "ledger database", "originchaindb"] },
    { id: "plan-growth", label: "Growth plan", kind: "plan", aliases: ["growth plan", "growth tier", "growth"] },
    { id: "plan-enterprise", label: "Enterprise plan", kind: "plan", aliases: ["enterprise plan", "enterprise tier", "enterprise"] },
    { id: "plan-starter", label: "Starter plan", kind: "plan", aliases: ["starter plan", "starter"] },
    { id: "region-mumbai", label: "Mumbai region (ap-south-1)", kind: "region", aliases: ["mumbai", "ap-south-1", "india region", "india"] },
    { id: "region-frankfurt", label: "Frankfurt region (eu-central-1)", kind: "region", aliases: ["frankfurt", "eu-central-1"] },
    { id: "region-virginia", label: "Virginia region (us-east-1)", kind: "region", aliases: ["virginia", "us-east-1"] },
    { id: "inc-2291", label: "INC-2291 replication lag", kind: "incident", aliases: ["inc-2291", "replication incident", "replication lag", "frankfurt incident"] },
    { id: "zk-proofs", label: "Zero-knowledge audit proofs", kind: "feature", aliases: ["zero-knowledge", "zk proofs", "audit proofs", "v3.3"] },
    { id: "dpdp", label: "DPDP Act", kind: "regulation", aliases: ["dpdp", "data protection"] },
    { id: "residency", label: "Data residency", kind: "topic", aliases: ["data residency", "residency", "data localisation", "data localization", "in-country"] },
    { id: "nodes", label: "Ledger nodes", kind: "metric", aliases: ["nodes", "node"] },
    { id: "discount-policy", label: "Discount policy", kind: "policy", aliases: ["discount", "discounts"] },
  ],
  relations: [
    { from: "meridian", to: "plan-growth", rel: "subscribes_to" },
    { from: "meridian", to: "priya", rel: "contact" },
    { from: "meridian", to: "region-mumbai", rel: "deployed_in" },
    { from: "meridian", to: "residency", rel: "requires" },
    { from: "residency", to: "region-mumbai", rel: "served_by" },
    { from: "residency", to: "dpdp", rel: "governed_by" },
    { from: "inc-2291", to: "region-frankfurt", rel: "affected" },
    { from: "kestrel", to: "region-frankfurt", rel: "deployed_in" },
    { from: "kestrel", to: "plan-enterprise", rel: "subscribes_to" },
    { from: "plan-enterprise", to: "zk-proofs", rel: "includes" },
    { from: "ledger-db", to: "zk-proofs", rel: "ships" },
  ],
  documents: [
    {
      id: "doc-overview",
      title: "Product overview: OriginChain Ledger DB 3.2",
      kind: "product",
      date: "2026-08-01",
      importance: 0.6,
      content:
        "OriginChain Ledger DB is a tamper-evident ledger database. Every write is hash-chained and independently verifiable, so auditors can prove a record was never altered.\n\n" +
        "It speaks the PostgreSQL wire protocol, so existing drivers and ORMs work unchanged. Clusters run 3 to 64 ledger nodes, and each node stores a full verifiable copy of the chain.\n\n" +
        "Typical customers are logistics, healthcare and financial-services teams that must prove data integrity to regulators.",
    },
    {
      id: "doc-pricing-2026",
      title: "Price sheet (effective 2026-07-01)",
      kind: "pricing",
      date: "2026-07-01",
      importance: 0.9,
      content:
        "Starter plan: $499 per month, includes 3 ledger nodes. Additional nodes are not available on Starter.\n\n" +
        "Growth plan: $2,400 per month, includes 10 ledger nodes. Additional nodes cost $180 per node per month.\n\n" +
        "Enterprise plan: $6,500 per month base, includes 16 ledger nodes, 99.99% SLA, zero-knowledge audit proofs and a named TAM. Additional nodes cost $150 per node per month.\n\n" +
        "Annual commitments receive 2 months free.",
      facts: [
        { entity: "plan-growth", attribute: "monthly_price", value: "$2,400" },
        { entity: "plan-growth", attribute: "extra_node_price", value: "$180" },
        { entity: "plan-enterprise", attribute: "monthly_price", value: "$6,500" },
        { entity: "plan-enterprise", attribute: "included_nodes", value: "16" },
        { entity: "plan-enterprise", attribute: "extra_node_price", value: "$150" },
      ],
    },
    {
      id: "doc-pricing-2025",
      title: "Price sheet (archived, 2025)",
      kind: "pricing",
      date: "2025-03-01",
      importance: 0.3,
      content:
        "Growth plan: $1,900 per month, includes 10 ledger nodes. Additional nodes cost $150 per node per month.\n\n" +
        "Enterprise plan: $5,200 per month base, includes 16 ledger nodes and a 99.95% SLA. Additional nodes cost $120 per node per month.",
      facts: [
        { entity: "plan-growth", attribute: "monthly_price", value: "$1,900" },
        { entity: "plan-growth", attribute: "extra_node_price", value: "$150" },
        { entity: "plan-enterprise", attribute: "monthly_price", value: "$5,200" },
        { entity: "plan-enterprise", attribute: "included_nodes", value: "16" },
        { entity: "plan-enterprise", attribute: "extra_node_price", value: "$120" },
      ],
    },
    {
      id: "doc-meridian",
      title: "Account record: Meridian Logistics",
      kind: "account",
      date: "2026-09-15",
      importance: 0.85,
      content:
        "Meridian Logistics is on the Growth plan with 14 ledger nodes, deployed in the Mumbai region (ap-south-1).\n\n" +
        "Renewal date: 2026-11-30; Meridian contracts renew annually. Primary contact: Priya Nair, Head of Platform Engineering.\n\n" +
        "Meridian must keep all shipment ledgers inside India to satisfy customer contracts and the DPDP Act. They asked about zero-knowledge audit proofs for their customs partners.",
      facts: [
        { entity: "meridian", attribute: "plan", value: "Growth" },
        { entity: "meridian", attribute: "nodes", value: "14" },
        { entity: "meridian", attribute: "region", value: "Mumbai (ap-south-1)" },
        { entity: "meridian", attribute: "renewal_date", value: "2026-11-30" },
      ],
    },
    {
      id: "doc-kestrel",
      title: "Account record: ABC",
      kind: "account",
      date: "2026-08-20",
      importance: 0.5,
      content:
        "ABC is on the Enterprise plan with 22 ledger nodes, deployed in the Frankfurt region (eu-central-1). Renewal date: 2027-02-01.",
      facts: [
        { entity: "kestrel", attribute: "plan", value: "Enterprise" },
        { entity: "kestrel", attribute: "region", value: "Frankfurt (eu-central-1)" },
      ],
    },
    {
      id: "doc-residency",
      title: "Data residency and regions",
      kind: "compliance",
      date: "2026-06-10",
      importance: 0.7,
      content:
        "OriginChainDB runs in three regions: Mumbai (ap-south-1), Frankfurt (eu-central-1) and Virginia (us-east-1).\n\n" +
        "Region pinning keeps every ledger node, backup and audit proof inside the chosen region. Mumbai-pinned clusters satisfy in-country storage requirements under India's DPDP Act.\n\n" +
        "Cross-region replication is opt-in and disabled by default for pinned clusters.",
    },
    {
      id: "doc-sla",
      title: "Service levels",
      kind: "sla",
      date: "2026-07-01",
      importance: 0.5,
      content:
        "Starter and Growth plans carry a 99.95% monthly uptime SLA. Enterprise carries 99.99% with a 15-minute P1 response time.\n\n" +
        "Service credits: 10% of the monthly fee for each 0.1% below target, capped at 50%.",
    },
    {
      id: "doc-inc-2291",
      title: "Incident report INC-2291: replication lag in Frankfurt",
      kind: "incident",
      date: "2026-09-28",
      importance: 0.65,
      content:
        "On 2026-09-28 between 09:12 and 10:04 UTC, ledger replication in the Frankfurt region (eu-central-1) lagged by up to 11 minutes after a storage-controller firmware update.\n\n" +
        "No data was lost and hash-chain verification passed throughout. Only clusters in Frankfurt were affected; Mumbai and Virginia were unaffected.\n\n" +
        "Affected Enterprise customers receive service credits under the SLA.",
    },
    {
      id: "doc-release-33",
      title: "Release notes: Ledger DB 3.3 (upcoming)",
      kind: "release",
      date: "2026-09-30",
      importance: 0.55,
      content:
        "Ledger DB 3.3 introduces zero-knowledge audit proofs: share a proof that a record exists and is unaltered without revealing its contents. General availability: 2026-11-15.\n\n" +
        "Zero-knowledge audit proofs are included in the Enterprise plan and available as a $900 per month add-on for Growth.",
      facts: [{ entity: "zk-proofs", attribute: "ga_date", value: "2026-11-15" }],
    },
    {
      id: "doc-migration",
      title: "Migration guide: PostgreSQL to OriginChainDB",
      kind: "guide",
      date: "2026-05-12",
      importance: 0.35,
      content:
        "Migrations take three steps: snapshot the source with pg_dump, replay it with origin-import which hash-chains every row, then switch the application connection string.\n\n" +
        "Most teams migrate a 500 GB database in under a day with no application code changes.",
    },
    {
      id: "doc-discount-internal",
      title: "Internal: discount approval policy",
      kind: "policy",
      date: "2026-07-01",
      importance: 0.6,
      acl: ["admin"],
      content:
        "Account executives may offer up to 10% off list price without approval. Discounts between 10% and 18% need VP Sales approval. Anything above 18% requires the CFO.\n\n" +
        "Renewals that upgrade plan tier may stack an extra 5% loyalty discount.",
    },
  ],
}
