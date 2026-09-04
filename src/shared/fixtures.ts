import type { Mandate, Milestone, Supplier } from "./types.js";

/** The buyer's standing mandate. The human sets this, then steps back. */
export const DEMO_MANDATE: Mandate = {
  prompt:
    "I need 50 custom solid-oak dining tables from a Malaysian manufacturer, " +
    "under S$600 per unit, delivered to Singapore within 4 weeks.",
  units: 50,
  product: "custom solid-oak dining tables",
  maxUnitPrice: 600,
  deliveryDays: 28,
  requireVerifiedSupplier: true,
};

/**
 * Discovery returns name, price and lead time. Everything under `hidden` is
 * only obtainable by paying the verification service - which is the point:
 * the agent has to spend money to find out that the cheapest quote is a trap.
 */
export const SUPPLIERS: Supplier[] = [
  {
    id: "SUP-A",
    name: "Johor Timberworks Sdn Bhd",
    country: "MY",
    unitPrice: 560,
    leadDays: 21,
    hidden: { registration: "lapsed", disputes: 2, yearsTrading: 3 },
  },
  {
    id: "SUP-B",
    name: "Melaka Furniture Collective",
    country: "MY",
    unitPrice: 580,
    leadDays: 26,
    hidden: { registration: "active", disputes: 0, yearsTrading: 9 },
  },
  {
    id: "SUP-C",
    name: "Penang Hardwood Industries",
    country: "MY",
    unitPrice: 645,
    leadDays: 24,
    hidden: { registration: "active", disputes: 1, yearsTrading: 12 },
  },
];

export const DEMO_MILESTONES: Milestone[] = [
  {
    id: "production",
    label: "Production started",
    pct: 30,
    evidence: "workshop photos with timestamps",
    deadlineDays: 30,
  },
  {
    id: "inspection",
    label: "Inspection passed",
    pct: 30,
    evidence: "third-party inspection report",
    deadlineDays: 45,
  },
  {
    id: "delivery",
    label: "Delivery confirmed",
    pct: 40,
    evidence: "carrier tracking webhook",
    deadlineDays: 60,
  },
];
