// src/tools/mockData.ts

export const MOCK_SUPPLIERS = [
  {
    supplierId: "sup_00",
    supplierName: "Dongguan Rapid Manufacturing",
    unitPriceUSD: 31,
    quantity: 100,
    totalPriceUSD: 3100,
    leadTimeDays: 6,
  },
  {
    supplierId: "sup_01",
    supplierName: "Shenzhen Precision Tech",
    unitPriceUSD: 35,
    quantity: 100,
    totalPriceUSD: 3500,
    leadTimeDays: 5,
  },
  {
    supplierId: "sup_02",
    supplierName: "Global Components Ltd",
    unitPriceUSD: 38,
    quantity: 100,
    totalPriceUSD: 3800,
    leadTimeDays: 4,
  },
];

// MAKE SURE "export" IS IN FRONT OF THIS LINE:
export const MOCK_SHIPMENT_DATA = {
  status: "DISPATCHED",
  carrier: "DHL Express",
  declaredWeightKg: 120.5,
  actualWeightKg: 120.2,
};

export interface RegistryRecord {
  registration: "active" | "lapsed";
  openDisputes: number;
  yearsTrading: number;
  /* Everything below is what a real registry pull returns and what makes the
     verdict legible to a human reading over the agent's shoulder. */
  legalName: string;
  registrationNo: string;
  jurisdiction: string;
  incorporated: string;
  paidUpCapitalUSD: number;
  directors: number;
  employees: string;
  disputeDetail?: string;
  tradeReferences: number;
  onSanctionsList: boolean;
  lastFiling: string;
  creditBand: "A" | "B" | "C" | "D";
}

export function normaliseSupplierName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Facts a supplier does not advertise. The buyer brings the supplier — from
 * WhatsApp, a trade show, wherever — and none of this is visible in that
 * conversation. The agent has to pay the registry to find out, which is the
 * whole point: the cheapest quote is the one that fails.
 *
 * Keyed by normalised company name. Stubbed for the demo; in production the
 * paid endpoint fronts a real registry (ACRA, SSM, 企查查) and nothing above
 * it changes.
 */
const KNOWN_RECORDS: Record<string, RegistryRecord> = {
  [normaliseSupplierName("Dongguan Rapid Manufacturing")]: {
    registration: "lapsed",
    openDisputes: 2,
    yearsTrading: 3,
    legalName: "Dongguan Rapid Manufacturing Co., Ltd",
    registrationNo: "91441900MA55X3K21P",
    jurisdiction: "Guangdong, CN",
    incorporated: "2023-02-14",
    paidUpCapitalUSD: 1_400,
    directors: 1,
    employees: "<10",
    disputeDetail: "2 unresolved supply disputes totalling US$47,200, both filed 2026",
    tradeReferences: 0,
    onSanctionsList: false,
    lastFiling: "2024-11-30 (overdue)",
    creditBand: "D",
  },
  [normaliseSupplierName("Shenzhen Precision Tech")]: {
    registration: "active",
    openDisputes: 0,
    yearsTrading: 9,
    legalName: "Shenzhen Precision Technology Co., Ltd",
    registrationNo: "91440300MA5DA7Q19X",
    jurisdiction: "Shenzhen, CN",
    incorporated: "2017-06-08",
    paidUpCapitalUSD: 720_000,
    directors: 4,
    employees: "120–180",
    tradeReferences: 6,
    onSanctionsList: false,
    lastFiling: "2026-04-02 (current)",
    creditBand: "A",
  },
  [normaliseSupplierName("Global Components Ltd")]: {
    registration: "active",
    openDisputes: 1,
    yearsTrading: 12,
    legalName: "Global Components (HK) Limited",
    registrationNo: "HK-2014-0887431",
    jurisdiction: "Hong Kong SAR",
    incorporated: "2014-03-21",
    paidUpCapitalUSD: 310_000,
    directors: 2,
    employees: "40–60",
    disputeDetail: "1 open dispute over a late 2025 shipment, US$8,900, in mediation",
    tradeReferences: 3,
    onSanctionsList: false,
    lastFiling: "2026-01-18 (current)",
    creditBand: "B",
  },
  [normaliseSupplierName("Johor Timberworks")]: {
    registration: "lapsed",
    openDisputes: 1,
    yearsTrading: 4,
    legalName: "Johor Timberworks Sdn Bhd",
    registrationNo: "202201009887 (1455231-P)",
    jurisdiction: "Johor, MY",
    incorporated: "2022-03-30",
    paidUpCapitalUSD: 2_300,
    directors: 2,
    employees: "10–25",
    disputeDetail: "1 open dispute, US$15,400, filed by a Singapore buyer in 2026",
    tradeReferences: 1,
    onSanctionsList: false,
    lastFiling: "2025-06-11 (overdue)",
    creditBand: "C",
  },
  [normaliseSupplierName("Melaka Furniture Collective")]: {
    registration: "active",
    openDisputes: 0,
    yearsTrading: 11,
    legalName: "Melaka Furniture Collective Sdn Bhd",
    registrationNo: "201501022145 (1145889-K)",
    jurisdiction: "Melaka, MY",
    incorporated: "2015-07-02",
    paidUpCapitalUSD: 540_000,
    directors: 3,
    employees: "80–120",
    tradeReferences: 5,
    onSanctionsList: false,
    lastFiling: "2026-03-09 (current)",
    creditBand: "A",
  },
};

/**
 * A company the demo has never heard of still gets an answer — derived
 * deterministically from the name, so the same supplier always returns the
 * same record rather than flickering between runs.
 */
export function registryLookup(name: string): RegistryRecord {
  const key = normaliseSupplierName(name);
  const known = KNOWN_RECORDS[key];
  if (known) return known;

  let h = 7;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const lapsed = h % 7 === 0;
  const disputes = h % 5 === 0 ? 1 + (h % 3) : 0;
  const years = 2 + (h % 18);

  return {
    registration: lapsed ? "lapsed" : "active",
    openDisputes: disputes,
    yearsTrading: years,
    legalName: name,
    registrationNo: `UNVERIFIED-${(h % 900000 + 100000).toString()}`,
    jurisdiction: "not on file",
    incorporated: `${2026 - years}-01-01`,
    paidUpCapitalUSD: 5_000 + (h % 400_000),
    directors: 1 + (h % 4),
    employees: h % 3 === 0 ? "<10" : "10–50",
    disputeDetail: disputes ? `${disputes} open dispute(s) on file` : undefined,
    tradeReferences: h % 6,
    onSanctionsList: false,
    lastFiling: lapsed ? "overdue" : "current",
    creditBand: lapsed ? "D" : (["A", "B", "C"] as const)[h % 3],
  };
}
