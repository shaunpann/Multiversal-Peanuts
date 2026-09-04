import type { Request } from "express";
import { SUPPLIERS } from "../shared/fixtures.js";

export interface PaidService {
  id: string;
  path: string;
  priceXrp: number;
  description: string;
  handler: (req: Request) => unknown;
}

/**
 * The services the buyer agent pays for on its own authority. These are the
 * "Agent/API fees" revenue line: small, per-call, and consumed by a machine
 * rather than a person.
 */
export const SERVICES: PaidService[] = [
  {
    id: "verify-business",
    path: "/api/verify-business/:supplierId",
    priceXrp: 0.25,
    description: "Company registry, dispute history and trading record for one supplier",
    handler: (req) => {
      const supplier = SUPPLIERS.find((s) => s.id === req.params.supplierId);
      if (!supplier) return { error: "unknown supplier" };
      const { registration, disputes, yearsTrading } = supplier.hidden;
      const passed = registration === "active" && disputes === 0;
      return {
        supplierId: supplier.id,
        name: supplier.name,
        registration,
        openDisputes: disputes,
        yearsTrading,
        verdict: passed ? "pass" : "fail",
        reason: passed
          ? `Registration active, no open disputes, ${yearsTrading} years trading.`
          : `Registration ${registration}, ${disputes} open dispute(s).`,
      };
    },
  },
  {
    id: "freight-quote",
    path: "/api/freight-quote",
    priceXrp: 0.1,
    description: "Cross-border freight rates and transit times, Johor/Melaka to Singapore",
    handler: () => ({
      options: [
        { carrier: "Wira Logistics", transitDays: 3, costSgd: 1450 },
        { carrier: "Straits Freight", transitDays: 2, costSgd: 1890 },
      ],
      recommended: "Wira Logistics",
    }),
  },
  {
    id: "inspection",
    path: "/api/inspection/:supplierId",
    priceXrp: 0.2,
    description: "Book a third-party pre-shipment inspection and return the report",
    handler: (req) => ({
      supplierId: req.params.supplierId,
      inspector: "SGS Malaysia",
      unitsSampled: 8,
      defectsFound: 0,
      verdict: "pass",
      reportId: `INSP-${Date.now().toString(36).toUpperCase()}`,
    }),
  },
  {
    id: "customs-check",
    path: "/api/customs-check",
    priceXrp: 0.1,
    description: "HS classification and duty exposure for the shipment",
    handler: () => ({
      hsCode: "9403.30",
      dutyRatePct: 0,
      notes: "ATIGA preferential rate applies with a Form D certificate of origin.",
    }),
  },
];

export function serviceById(id: string): PaidService | undefined {
  return SERVICES.find((s) => s.id === id);
}
