// src/agents/test-runner.ts
import { TradeOrchestrator } from "./orchestrator";
import { BuyerIntent, AgentLogEvent } from "../shared/types";

// 1. Define a sample Buyer Intent
const sampleIntent: BuyerIntent = {
  productName: "Custom Anodized Aluminum Enclosures",
  quantity: 100,
  maxBudgetUSD: 4000,
  maxTargetUnitCostUSD: 30, // Target: $30/unit ($3,000 total)
  deadlineDays: 7,
  autoApproveLimitUSD: 5000, // Below limit -> Will auto-approve
};

// 2. Mock Event Logger (Prints agent logs directly to console)
const logEventHandler = (event: AgentLogEvent) => {
  const timestamp = new Date(event.timestamp || Date.now()).toLocaleTimeString();
  const agentBadge = `[${event.agent.toUpperCase()}]`.padEnd(14, " ");
  console.log(`${timestamp} ${agentBadge} | ${event.action} -> ${event.message}`);
};

// 3. Run the Test Flow
async function runTest() {
  console.log("=================================================");
  console.log("🚀 STARTING PERSON A AGENT ORCHESTRATION TEST");
  console.log("=================================================\n");

  const orchestrator = new TradeOrchestrator();

  try {
    // Executes the complete 6-stage agent loop
    await orchestrator.runProcurementLoop(sampleIntent, logEventHandler);

    console.log("\n=================================================");
    console.log("✅ AGENT TEST COMPLETED SUCCESSFULLY!");
    console.log("=================================================");
  } catch (error) {
    console.error("\n❌ TEST FAILED WITH ERROR:", error);
  }
}

runTest();