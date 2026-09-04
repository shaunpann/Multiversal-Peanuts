import crypto from "node:crypto";

/**
 * XRPL conditional escrow accepts exactly one condition type: PREIMAGE-SHA-256
 * crypto-conditions. The ledger only checks "does this fulfillment hash to the
 * stored condition" - it cannot verify a real-world event. So the trust model
 * is explicit: whoever holds the preimage can release the funds, and nothing
 * else can move them. CancelAfter is what protects the buyer if it is never
 * released.
 *
 * Encoding (DER, per the crypto-conditions spec):
 *   condition   = A0 25 80 20 <32-byte sha256(preimage)> 81 01 <cost>
 *   fulfillment = A0 22 80 20 <32-byte preimage>
 * where cost is the preimage length in bytes.
 */

export interface ConditionPair {
  condition: string;
  fulfillment: string;
  preimage: Buffer;
}

export function generateCondition(): ConditionPair {
  const preimage = crypto.randomBytes(32);
  return {
    preimage,
    condition: conditionFor(preimage),
    fulfillment: fulfillmentFor(preimage),
  };
}

export function conditionFor(preimage: Buffer): string {
  const digest = crypto.createHash("sha256").update(preimage).digest();
  const cost = preimage.length;
  return Buffer.concat([
    Buffer.from([0xa0, 0x25, 0x80, 0x20]),
    digest,
    Buffer.from([0x81, 0x01, cost]),
  ])
    .toString("hex")
    .toUpperCase();
}

export function fulfillmentFor(preimage: Buffer): string {
  return Buffer.concat([Buffer.from([0xa0, 0x22, 0x80, 0x20]), preimage])
    .toString("hex")
    .toUpperCase();
}

/**
 * EscrowFinish with a fulfillment costs more than a normal transaction:
 * 330 drops plus 10 drops per 16 bytes of fulfillment. Left to autofill the
 * transaction is rejected for insufficient fee, which is a classic first-time
 * XRPL footgun - so we always set Fee explicitly.
 */
export function escrowFinishFeeDrops(fulfillmentHex: string): string {
  const bytes = fulfillmentHex.length / 2;
  return String(330 + 10 * Math.ceil(bytes / 16) + 100); // + margin
}

/** Sanity check against the documented vector for sha256("") at cost 0. */
export function selfTest(): boolean {
  const empty = conditionFor(Buffer.alloc(0));
  return (
    empty ===
    "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100"
  );
}

/** Preimages never leave the process. In production this is an HSM or a KMS. */
class PreimageVault {
  private store = new Map<string, ConditionPair>();

  put(dealId: string, milestoneId: string, pair: ConditionPair): void {
    this.store.set(`${dealId}:${milestoneId}`, pair);
  }

  get(dealId: string, milestoneId: string): ConditionPair | undefined {
    return this.store.get(`${dealId}:${milestoneId}`);
  }

  reset(): void {
    this.store.clear();
  }
}

export const vault = new PreimageVault();
