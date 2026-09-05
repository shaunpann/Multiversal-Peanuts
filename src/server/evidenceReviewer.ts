// src/server/evidenceReviewer.ts
//
// The verification agent's actual decision-making: given what the supplier
// submitted (a tracking number, a note, optionally a photo), decide whether
// the delivery evidence supports releasing escrowed funds.
//
// Real path: calls the Claude API (vision + reasoning) with the deal terms
// and the submitted evidence, and asks for a verdict. Requires the caller's
// own ANTHROPIC_API_KEY in .env — never hardcoded, never logged, read once
// at call time. Falls back to a clearly-labeled rule-based check when no key
// is configured, so the app still runs end-to-end without one.

import Anthropic from "@anthropic-ai/sdk";

export interface EvidenceInput {
  productName: string;
  amountUSD: number;
  quantityDescription: string; // e.g. "100 units" — from the deal terms, free text
  trackingNumber: string;
  note: string;
  imageBase64?: string;
  imageMediaType?: string; // e.g. "image/jpeg"
}

export interface VerificationVerdict {
  passed: boolean;
  reasoning: string;
  method: "ai" | "fallback";
  /**
   * True when the fallback check was asked to judge something it structurally
   * cannot (a photo, without a vision model available) — it did NOT quietly
   * decide on your behalf. The caller must route this to a human instead of
   * treating `passed` as a real verdict; `passed` is meaningless in this case.
   */
  needsManualReview?: boolean;
}

const VERDICT_MODEL = "claude-sonnet-5";

export async function reviewEvidence(input: EvidenceInput): Promise<VerificationVerdict> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fallbackReview(input);
  }

  try {
    return await aiReview(input, apiKey);
  } catch (err) {
    console.error("[evidenceReviewer] AI review failed, falling back to rule-based check:", err);
    return fallbackReview(input);
  }
}

async function aiReview(input: EvidenceInput, apiKey: string): Promise<VerificationVerdict> {
  const client = new Anthropic({ apiKey });

  const content: Anthropic.MessageParam["content"] = [
    {
      type: "text",
      text:
        `You are a cargo/delivery verification agent deciding whether to release escrowed ` +
        `funds for a cross-border B2B trade. Deal terms:\n` +
        `- Product: ${input.productName}\n` +
        `- Quantity: ${input.quantityDescription}\n` +
        `- Value: $${input.amountUSD}\n\n` +
        `Supplier-submitted evidence:\n` +
        `- Tracking number: ${input.trackingNumber || "(none provided)"}\n` +
        `- Note: ${input.note || "(none)"}\n` +
        (input.imageBase64 ? `- A photo is attached below.\n` : `- No photo attached.\n`) +
        `\nDecide PASS or FAIL. FAIL if the tracking number is missing/malformed, the note ` +
        `indicates damage/shortfall/mismatch, or an attached photo doesn't plausibly match the ` +
        `declared product/quantity. Respond with ONLY a JSON object: {"passed": boolean, "reasoning": string}.`,
    },
  ];

  if (input.imageBase64 && input.imageMediaType) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: input.imageMediaType as any, data: input.imageBase64 },
    });
  }

  const response = await client.messages.create({
    model: VERDICT_MODEL,
    max_tokens: 300,
    messages: [{ role: "user", content }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

  return {
    passed: Boolean(parsed.passed),
    reasoning: String(parsed.reasoning ?? "No reasoning returned."),
    method: "ai",
  };
}

/**
 * Deterministic stand-in used only when ANTHROPIC_API_KEY is not configured.
 *
 * This is deliberately weak, not a drop-in replacement for the AI review: it
 * can check text patterns, but it cannot look at a photo. If the supplier
 * submitted one, pretending to verify it anyway (by silently ignoring it and
 * judging on text alone) would be dishonest about what actually got checked —
 * so this routes those cases to a human instead of auto-deciding.
 */
function fallbackReview(input: EvidenceInput): VerificationVerdict {
  if (input.imageBase64) {
    return {
      passed: false,
      needsManualReview: true,
      method: "fallback",
      reasoning:
        `A photo was submitted, but ANTHROPIC_API_KEY isn't configured, so there is no vision model ` +
        `available to actually look at it. Rather than guess, this needs a human to review the photo ` +
        `and decide manually.`,
    };
  }

  const trackingLooksValid = input.trackingNumber.trim().length >= 4;
  const noteFlagsProblem = /damag|fail|broken|missing|short/i.test(input.note);
  const passed = trackingLooksValid && !noteFlagsProblem;

  return {
    passed,
    reasoning: passed
      ? `[fallback check — set ANTHROPIC_API_KEY for real AI review] No photo submitted; tracking number present and note does not flag a problem.`
      : `[fallback check — set ANTHROPIC_API_KEY for real AI review] ${
          !trackingLooksValid ? "Tracking number missing or too short." : "Note flags a possible delivery problem."
        }`,
    method: "fallback",
  };
}
