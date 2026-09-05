// src/tools/xrplTools.refund-test.ts
//
// Demonstrates the failure/safeguard path: inspection fails -> verification
// agent never reveals the fulfillment -> escrow stays locked until CancelAfter
// elapses on-ledger -> buyer reclaims funds via EscrowCancel.
//
// XRPL enforces CancelAfter itself (a ledger must close with a close time past
// it) — the agent can't shortcut that, which is exactly the guarantee a buyer
// relies on. This script uses a short CancelAfter (a few ledgers) purely so the
// refund path can be demoed live instead of waiting the real 7-day window.
//
// Run with: npm run test:xrpl:refund

import { getClient, createFundedWallet, generateEscrowCondition, createEscrow, cancelEscrow } from "./xrplTools";

const DEMO_CANCEL_AFTER_SECONDS = 5; // real product default is 7 days (see orchestrator.ts)
const POLL_INTERVAL_MS = 4000; // ~1 ledger close
const MAX_WAIT_MS = 60000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=================================================");
  console.log("🚀 XRPL ESCROW REFUND (FAILURE PATH) — STANDALONE TEST");
  console.log("=================================================\n");

  const client = await getClient();

  try {
    const buyer = await createFundedWallet(client, "buyer");
    const supplier = await createFundedWallet(client, "supplier");

    // Verification agent generates the condition but — because inspection
    // will fail in this demo — never learns/reveals the fulfillment.
    const { condition } = generateEscrowCondition();
    console.log(`[test] Generated escrow condition (fulfillment intentionally withheld): ${condition}`);

    const amountDrops = String(5 * 1_000_000); // 5 XRP demo amount
    const dealMemo = { agent_id: "settlement-protocol-v0", deal_id: `DEAL-${Date.now()}`, action: "lock_escrow" };

    const created = await createEscrow({
      client,
      fromWallet: buyer.wallet,
      toAddress: supplier.address,
      amountDrops,
      condition,
      cancelAfterSeconds: DEMO_CANCEL_AFTER_SECONDS,
      memo: dealMemo,
    });

    if (created.resultCode !== "tesSUCCESS") {
      throw new Error(`EscrowCreate failed: ${created.resultCode}`);
    }

    console.log(`\n[test] Simulated inspection FAILED. Funds locked. Waiting for CancelAfter (+${DEMO_CANCEL_AFTER_SECONDS}s) to elapse on-ledger before EscrowCancel can succeed...\n`);

    // Poll EscrowCancel until the ledger's close time has actually passed
    // CancelAfter — tecNO_PERMISSION is the expected/correct rejection until then.
    let waited = 0;
    let lastResultCode = "";
    while (waited < MAX_WAIT_MS) {
      const attempt = await cancelEscrow({
        client,
        ownerWallet: buyer.wallet,
        sequence: created.sequence,
        memo: { ...dealMemo, action: "refund_after_failed_inspection" },
      });
      lastResultCode = attempt.resultCode;

      if (attempt.resultCode === "tesSUCCESS") {
        console.log("\n=================================================");
        console.log("✅ RESULT");
        console.log("=================================================");
        console.log(`EscrowCreate tx : ${created.txHash}  (tesSUCCESS)`);
        console.log(`EscrowCancel tx : ${attempt.txHash}  (tesSUCCESS)`);
        console.log(`Explorer        : https://testnet.xrpl.org/transactions/${created.txHash}`);
        console.log(`Explorer        : https://testnet.xrpl.org/transactions/${attempt.txHash}`);
        return;
      }

      console.log(`[test] EscrowCancel not yet valid (${attempt.resultCode}) — retrying in ${POLL_INTERVAL_MS / 1000}s...`);
      await sleep(POLL_INTERVAL_MS);
      waited += POLL_INTERVAL_MS;
    }

    throw new Error(`EscrowCancel never succeeded within ${MAX_WAIT_MS / 1000}s (last: ${lastResultCode})`);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
