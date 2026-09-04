import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * Claude powers the negotiation. The demo still runs without a key - every
 * caller supplies a deterministic fallback - so a missing key degrades the
 * reasoning, never the settlement path.
 */
export const LLM_ENABLED = Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = "claude-opus-5";
let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export async function think<T>(
  schema: z.ZodType<T>,
  system: string,
  prompt: string,
): Promise<T | undefined> {
  if (!LLM_ENABLED) return undefined;
  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(schema) },
    });
    if (response.stop_reason === "refusal") return undefined;
    return response.parsed_output ?? undefined;
  } catch (err) {
    // A negotiation is not worth failing a settlement over.
    // eslint-disable-next-line no-console
    console.warn(`[llm] falling back to deterministic logic: ${String(err)}`);
    return undefined;
  }
}
