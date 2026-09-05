// src/tools/xrplTools.test.ts
//
// Step 1 deliverable: standalone proof that XRPL escrow settlement works,
// independent of the agent orchestration layer. Run with:
//   npm run test:xrpl
//
// Flow: fund buyer + supplier testnet wallets -> buyer locks funds in a
// conditional escrow -> "verification agent" (buyer, who holds the
// fulfillment in this standalone demo) finishes the escrow -> print both
// real testnet tx hashes.

import {
  getClient,
  createFundedWallet,
  generateEscrowCondition,
  createEscrow,
  finishEscrow,
} from "./xrplTools";

async function main() {
  console.log("=================================================");
  console.log("🚀 XRPL ESCROW SETTLEMENT — STANDALONE TEST");
  console.log("=================================================\n");

  const client = await getClient();

  try {
    const buyer = await createFundedWallet(client, "buyer");
    const supplier = await createFundedWallet(client, "supplier");

    // Verification agent generates the release condition up front and keeps
    // the fulfillment private until its checks pass (see verificationAgent.ts).
    const { condition, fulfillment } = generateEscrowCondition();
    console.log(`[test] Generated escrow condition: ${condition}`);

    const amountDrops = String(5 * 1_000_000); // 5 XRP, for a cheap demo
    const dealMemo = { agent_id: "settlement-protocol-v0", deal_id: `DEAL-${Date.now()}`, action: "lock_escrow" };

    const created = await createEscrow({
      client,
      fromWallet: buyer.wallet,
      toAddress: supplier.address,
      amountDrops,
      condition,
      cancelAfterSeconds: 7 * 24 * 60 * 60, // 7-day refund safety net
      memo: dealMemo,
    });

    if (created.resultCode !== "tesSUCCESS") {
      throw new Error(`EscrowCreate failed: ${created.resultCode}`);
    }

    // Simulate verification passing -> release funds to supplier.
    const finished = await finishEscrow({
      client,
      submitterWallet: buyer.wallet, // in the real flow, the verification agent's wallet submits this
      ownerAddress: buyer.address,
      sequence: created.sequence,
      condition,
      fulfillment,
      memo: { ...dealMemo, action: "release_escrow" },
    });

    console.log("\n=================================================");
    console.log("✅ RESULT");
    console.log("=================================================");
    console.log(`EscrowCreate tx : ${created.txHash}  (${created.resultCode})`);
    console.log(`EscrowFinish tx : ${finished.txHash}  (${finished.resultCode})`);
    console.log(`Explorer        : https://testnet.xrpl.org/transactions/${created.txHash}`);
    console.log(`Explorer        : https://testnet.xrpl.org/transactions/${finished.txHash}`);
  } finally {
    await client.disconnect();
  }
}

main().catch((err) => {
  console.error("\n❌ TEST FAILED:", err);
  process.exit(1);
});
