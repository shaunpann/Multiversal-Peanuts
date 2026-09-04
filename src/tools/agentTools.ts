// src/tools/agentTools.ts
import { DealTerms, SupplierQuote } from "../shared/types";
import { MOCK_SUPPLIERS, MOCK_SHIPMENT_DATA } from "./mockData"; // Import from mockData.ts

// Tool 1: searchSuppliers()
export const searchSuppliers = async (productName: string): Promise<SupplierQuote[]> => {
  // Returns imported data instead of inline array
  return MOCK_SUPPLIERS; 
};

// Tool 2: evaluateInvoice()
export const evaluateInvoice = (terms: DealTerms, maxBudget: number): boolean => {
  return terms.totalPriceUSD <= maxBudget;
};

// Tool 3: verifyDocuments()
export const verifyDocuments = async (dealId: string): Promise<{ passed: boolean; certificateId: string }> => {
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { 
    passed: true, 
    certificateId: `CERT-INSPECT-${Math.floor(Math.random() * 899999 + 100000)}` 
  };
};

// Tool 4: checkShipmentStatus()
export const checkShipmentStatus = async (trackingNumber: string) => {
  return { 
    ...MOCK_SHIPMENT_DATA,
    trackingNumber 
  };
};