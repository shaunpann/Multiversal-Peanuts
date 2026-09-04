/**
 * Proves the one hard requirement in the brief: a real XRPL transaction.
 * Creates a conditional escrow on testnet, finishes it with the preimage, and
 * prints both explorer links. Run: npm run smoke
 */
import "dotenv/config";
import { isoTimeToRippleTime } from "xrpl";
import {
  AGENT_SOURCE_TAG,
  disconnect,
  explorerUrl,
  getBalanceXrp,
  getClient,
  getWallets,
  memo,
  resultCodeOf,
  toDrops,
  txFieldOf,
  txHashOf,
} from "../src/xrpl/client.js";
import { escrowFinishFeeDrops, generateCondition, selfTest } from "../src/xrpl/conditions.js";

async function main(): Promise<void> {
  console.log("condition encoding self-test:", selfTest() ? "pass" : "FAIL");
  if (!selfTest()) process.exit(1);

  const client = await getClient();
  const w = await getWallets();
  const pair = generateCondition();

  console.log("\ncreating conditional escrow (1 XRP, buyer -> supplier)...");
  const created = await client.submitAndWait(
    {
      TransactionType: "EscrowCreate",
      Account: w.buyer.address,
      Destination: w.supplier.address,
      Amount: toDrops(1),
      Condition: pair.condition,
      CancelAfter: isoTimeToRippleTime(new Date(Date.now() + 3 * 86_400_000).toISOString()),
      SourceTag: AGENT_SOURCE_TAG,
      Memos: [memo("deal", "SMOKE-TEST")],
    },
    { wallet: w.buyer, autofill: true },
  );
  const createHash = txHashOf(created.result);
  const sequence = txFieldOf<number>(created.result, "Sequence");
  console.log(" ", resultCodeOf(created.result), explorerUrl(createHash), "seq", sequence);

  console.log("\nfinishing it with the preimage (submitted by the agent account)...");
  const finished = await client.submitAndWait(
    {
      TransactionType: "EscrowFinish",
      Account: w.agent.address,
      Owner: w.buyer.address,
      OfferSequence: sequence ?? 0,
      Condition: pair.condition,
      Fulfillment: pair.fulfillment,
      Fee: escrowFinishFeeDrops(pair.fulfillment),
      SourceTag: AGENT_SOURCE_TAG,
    },
    { wallet: w.agent, autofill: true },
  );
  const finishHash = txHashOf(finished.result);
  console.log(" ", resultCodeOf(finished.result), explorerUrl(finishHash));

  console.log("\nsupplier balance:", await getBalanceXrp(w.supplier.address), "XRP");
  await disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await disconnect();
  process.exit(1);
});
