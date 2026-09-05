// src/agents/contextReader.ts
//
// The buyer's context, read rather than typed.
//
// Discovery and negotiation happen on WhatsApp, email, or a trade-show stand —
// which means the facts the agent needs already exist, as prose, in a thread
// somewhere. This turns that thread into a structured brief: what is being
// bought, in what quantity, against what budget, and which suppliers have
// quoted what.
//
// Real path: Claude reads the thread. Fallback: a deliberately narrow pattern
// scan for lines that pair a company with a price, used only when no API key
// is configured. The fallback is clearly labelled in what it returns, and the
// buyer always sees and can correct the result before the agent spends
// anything on it.

import Anthropic from "@anthropic-ai/sdk";

const READER_MODEL = "claude-opus-5";

export interface ParsedSupplier {
  name: string;
  contact: string;
  unitPriceUSD: number;
  leadTimeDays?: number;
  note?: string;
}

export interface ParsedBrief {
  productName: string;
  quantity: number;
  maxBudgetUSD: number;
  deadlineDays: number;
  suppliers: ParsedSupplier[];
  method: "ai" | "fallback";
  /** What the reader believes it understood, shown back to the buyer. */
  summary: string;
}

export async function readContext(text: string): Promise<ParsedBrief> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackRead(text);
  try {
    return await aiRead(text, apiKey);
  } catch (err) {
    console.error("[contextReader] AI read failed, falling back to pattern scan:", err);
    return fallbackRead(text);
  }
}

async function aiRead(text: string, apiKey: string): Promise<ParsedBrief> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: READER_MODEL,
    max_tokens: 2000,
    // A tool definition is the reliable way to get schema-valid arguments
    // back; forcing the call means the model cannot answer in prose.
    tools: [
      {
        name: "record_brief",
        description:
          "Record the procurement brief extracted from the buyer's messages with their suppliers.",
        input_schema: {
          type: "object",
          properties: {
            productName: { type: "string", description: "What is being bought, lowercase, no quantity" },
            quantity: { type: "number", description: "Units required. 0 if not stated." },
            maxBudgetUSD: { type: "number", description: "Total budget ceiling in USD. 0 if not stated." },
            deadlineDays: { type: "number", description: "Days until delivery is needed. 0 if not stated." },
            summary: {
              type: "string",
              description:
                "One sentence, addressed to the buyer, describing what you understood. Say plainly if something was missing.",
            },
            suppliers: {
              type: "array",
              description: "Every supplier who has quoted, in the order they appear.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "Company name as written" },
                  contact: { type: "string", description: "Phone, email or handle, or how they were reached" },
                  unitPriceUSD: { type: "number", description: "Quoted price per unit in USD, converted if quoted otherwise" },
                  leadTimeDays: { type: "number", description: "Quoted lead time in days, 0 if unstated" },
                  note: { type: "string", description: "Anything notable about their offer" },
                },
                required: ["name", "contact", "unitPriceUSD"],
              },
            },
          },
          required: ["productName", "quantity", "maxBudgetUSD", "deadlineDays", "suppliers", "summary"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_brief" },
    messages: [
      {
        role: "user",
        content:
          `Read the following messages between a buyer and their suppliers and extract a ` +
          `procurement brief. Only record what is actually stated — never invent a supplier, ` +
          `a price, or a deadline. If a unit price is given in another currency, convert it to ` +
          `USD and say so in that supplier's note. If a total is quoted rather than a unit ` +
          `price, divide by the quantity.\n\n---\n${text}\n---`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || !("input" in toolUse)) throw new Error("model returned no brief");
  const brief = toolUse.input as Omit<ParsedBrief, "method">;

  return {
    productName: String(brief.productName || "").trim(),
    quantity: Number(brief.quantity) || 0,
    maxBudgetUSD: Number(brief.maxBudgetUSD) || 0,
    deadlineDays: Number(brief.deadlineDays) || 14,
    summary: String(brief.summary || ""),
    suppliers: (brief.suppliers || [])
      .filter((s) => s && s.name && Number(s.unitPriceUSD) > 0)
      .map((s) => ({
        name: String(s.name).trim(),
        contact: String(s.contact || "").trim(),
        unitPriceUSD: Number(s.unitPriceUSD),
        leadTimeDays: Number(s.leadTimeDays) || undefined,
        note: s.note ? String(s.note) : undefined,
      })),
    method: "ai",
  };
}

/**
 * Pattern scan, used only with no API key configured. It looks for lines that
 * pair a company-ish name with a per-unit price and does not attempt to
 * understand anything else. It is much weaker than the model and says so.
 */
function fallbackRead(text: string): ParsedBrief {
  const suppliers: ParsedSupplier[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip the buyer's own brief — a budget or requirement line carries a
    // number too, and reading it as a quote invents a supplier.
    if (/\b(budget|need|needs|require|looking for|want|buying|rfq)\b/i.test(line)) continue;

    const price = line.match(/(?:US)?\$\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:usd|per unit|\/unit|each)/i);
    if (!price) continue;
    const unitPriceUSD = Number((price[1] ?? price[2] ?? "").replace(/,/g, ""));
    if (!unitPriceUSD) continue;

    // The name is whatever precedes the first separator or verb on the line.
    const name = line
      .split(/[:—–|]|\s-\s|\bquoted\b|\bquotes\b|\bsays\b|\boffers?\b|\bat\b/i)[0]
      .replace(/^[\s>*\d.)+]+/, "")
      .replace(/\([^)]*\)/g, "")
      .trim();
    if (!name || name.length < 3 || /^\$/.test(name)) continue;

    const contact = (line.match(/[\w.+-]+@[\w.-]+\.\w+|\+\d[\d\s()-]{6,}/)?.[0] ?? "")
      .replace(/[)\s]+$/, "");
    suppliers.push({ name, contact, unitPriceUSD });
  }

  const quantity =
    Number(text.match(/\b([\d,]{1,7})\s*(?:x\b|units?\b|pcs\b|pieces\b)/i)?.[1]?.replace(/,/g, "")) ||
    Number(text.match(/\b(?:need|want|require|buying|order)\s+([\d,]{1,7})\b/i)?.[1]?.replace(/,/g, "")) ||
    0;

  // Whatever follows the quantity, up to the next clause boundary, is the
  // thing being bought: "need 100 aluminium enclosures, budget..." -> the
  // two words in the middle.
  const productName = (
    text.match(/\b[\d,]{1,7}\s*(?:x\s+|units? of\s+|pcs of\s+)?([a-z][a-z\s/-]{2,45}?)(?=\s*[,.;]|\s+budget\b|\s+by\b|\s+within\b|\s+deliver|\s*$)/im)?.[1] ?? ""
  )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const maxBudgetUSD = Number(
    text.match(/budget[^\d$]{0,15}\$?\s*([\d,]+(?:\.\d+)?)/i)?.[1]?.replace(/,/g, ""),
  ) || 0;

  // "3 weeks" is 21 days, not 3.
  const deadlineMatch = text.match(/\b(\d{1,3})\s*(day|week|month)s?\b/i);
  const deadlineDays = deadlineMatch
    ? Number(deadlineMatch[1]) * ({ day: 1, week: 7, month: 30 }[deadlineMatch[2].toLowerCase()] ?? 1)
    : 14;

  return {
    productName,
    quantity,
    maxBudgetUSD,
    deadlineDays,
    suppliers,
    method: "fallback",
    summary:
      `[pattern scan — set ANTHROPIC_API_KEY for a real read] Found ${suppliers.length} ` +
      `line${suppliers.length === 1 ? "" : "s"} pairing a name with a price. ` +
      `Check every field below before running the agent.`,
  };
}
