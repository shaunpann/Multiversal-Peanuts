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

// Facts a supplier does not advertise. The agent cannot see any of this from
// the discovery feed — it has to pay the verification service to find out,
// which is the whole point: the cheapest quote is the one that fails.
export const SUPPLIER_RECORDS: Record<
  string,
  { registration: "active" | "lapsed"; openDisputes: number; yearsTrading: number }
> = {
  sup_00: { registration: "lapsed", openDisputes: 2, yearsTrading: 3 },
  sup_01: { registration: "active", openDisputes: 0, yearsTrading: 9 },
  sup_02: { registration: "active", openDisputes: 1, yearsTrading: 12 },
};
