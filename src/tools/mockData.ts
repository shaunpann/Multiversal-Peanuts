// src/tools/mockData.ts

export const MOCK_SUPPLIERS = [
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