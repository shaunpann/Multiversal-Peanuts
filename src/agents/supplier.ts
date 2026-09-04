import { z } from "zod";
import type { Quote, Supplier } from "../shared/types.js";
import { bus } from "../shared/events.js";
import { think } from "./llm.js";

const ResponseSchema = z.object({
  accept: z.boolean(),
  unitPrice: z.number(),
  leadDays: z.number(),
  message: z.string(),
});

/**
 * Stands in for the counterparty. In production this is the supplier's own
 * agent on the other side of an email or WhatsApp thread; for the hackathon it
 * negotiates against a floor it will not cross.
 */
export class SupplierAgent {
  private readonly floor: number;

  constructor(private readonly supplier: Supplier) {
    this.floor = Math.round(supplier.unitPrice * 0.94);
  }

  openingQuote(units: number): Quote {
    const quote: Quote = {
      supplierId: this.supplier.id,
      unitPrice: this.supplier.unitPrice,
      units,
      total: this.supplier.unitPrice * units,
      leadDays: this.supplier.leadDays,
      note: "Opening quote, ex-works.",
    };
    bus.emitEvent(
      "supplier_agent",
      "quoted",
      `${this.supplier.name} quotes S$${quote.unitPrice}/unit, ${quote.leadDays} days lead time`,
      { data: { ...quote } },
    );
    return quote;
  }

  async respondTo(counterPrice: number, units: number): Promise<Quote> {
    const llm = await think(
      ResponseSchema,
      `You are the sales agent for ${this.supplier.name}, a Malaysian furniture manufacturer. ` +
        `Your absolute floor is S$${this.floor} per unit - never go below it. ` +
        `Your list price is S$${this.supplier.unitPrice}. Concede slowly and stay commercial.`,
      `The buyer counter-offers S$${counterPrice} per unit for ${units} units, settled through ` +
        `milestone escrow so you carry no payment risk. Accept, or counter above your floor.`,
    );

    const settled = llm
      ? { unitPrice: Math.max(this.floor, Math.round(llm.unitPrice)), note: llm.message, accept: llm.accept }
      : this.deterministic(counterPrice);

    const unitPrice = settled.accept ? Math.max(this.floor, counterPrice) : settled.unitPrice;
    const quote: Quote = {
      supplierId: this.supplier.id,
      unitPrice,
      units,
      total: unitPrice * units,
      leadDays: this.supplier.leadDays,
      note: settled.note,
    };
    bus.emitEvent(
      "supplier_agent",
      settled.accept ? "accepted" : "countered",
      `${this.supplier.name}: ${settled.note} (S$${unitPrice}/unit)`,
      { data: { ...quote } },
    );
    return quote;
  }

  private deterministic(counterPrice: number): { accept: boolean; unitPrice: number; note: string } {
    if (counterPrice >= this.floor) {
      return { accept: true, unitPrice: counterPrice, note: "Agreed, on escrow terms." };
    }
    const split = Math.round((this.supplier.unitPrice + counterPrice) / 2);
    const unitPrice = Math.max(this.floor, split);
    return { accept: false, unitPrice, note: `Best we can do on this volume is S$${unitPrice}.` };
  }
}
