# X-Loom — Autonomous B2B Procurement & XRPL Settlement

> **An AI-native B2B trade platform combining multi-agent autonomous negotiation with cryptographic settlement on the XRP Ledger.**

X-Loom decouples complex B2B trade into autonomous software agents (Buyer, Supplier, Verification, Logistics) that handle discovery, quote evaluation, policy enforcement, and document verification in seconds. Agreed deal terms are locked into programmatic **XRPL Escrows** via HTTP **x402 payment rails**, releasing funds only upon cryptographic or telemetry verification.

---

## 🛠 Project Architecture

```
                      +------------------------------------------+
                      |         Person C: UI / Dashboard          |
                      |   (Next.js / Real-Time Event Feed)       |
                      +--------------------+---------------------+
                                           |
                                 Starts Trade Loop /
                                 Displays Agent Logs
                                           v
+-----------------------------------------------------------------------------------+
|                            Person A: AI Agent Engine                              |
|                                                                                   |
|  +------------------+     +--------------------+     +-------------------------+  |
|  |    BuyerAgent    |<--->|   SupplierAgent    |     |    VerificationAgent    |  |
|  |  (Policy/Bids)   |     | (Quote Evaluation) |     |  (Inspection/Telemetry) |  |
|  +--------+---------+     +--------------------+     +------------+------------+  |
|           |                                                       |               |
|           +-----------------------+-------------------------------+               |
|                                   |                                               |
|                        `orchestrator.ts` Execution                        |
+-----------------------------------|-----------------------------------------------+
                                    |
                       HTTP POST / Payload Handshake
                       (`DealTerms` JSON Contract)
                                    v
+-----------------------------------------------------------------------------------+
|                       Person B: Settlement Infrastructure                         |
|                                                                                   |
|  +-------------------------------------+   +-----------------------------------+  |
|  |          Express Server API         |   |        x402 Payment Rail          |  |
|  |  (`http://localhost:3001/api/...`)  |---|   (Machine-to-Machine Payments)   |  |
|  +------------------+------------------+   +-----------------------------------+  |
|                     |                                                             |
|                     v                                                             |
|    +-------------------------------------------------+                            |
|    |           XRPL Testnet Blockchain               |                            |
|    |   (`EscrowCreate` / `EscrowFinish` / RLUSD)    |                            |
|    +-------------------------------------------------+                            |
+-----------------------------------------------------------------------------------+
```

---

## 🚀 Key Features

* **Autonomous Procurement & Bidding:** The **Buyer Agent** formulates opening strategies based on budget ceilings, evaluates supplier counter-offers, and enforces auto-approval spending thresholds.
* **Multi-Agent Orchestration:** Sequenced communication loop across sourcing, negotiation, verification, and logistics.
* **On-Chain XRPL Settlement:** Eliminates wire delays and counterparty default risk by creating conditional XRPL Escrows (`EscrowCreate`) programmatically upon agreement.
* **x402 Protocol Integration:** Native HTTP 402 payment headers enable autonomous machine-to-machine service access and settlement.
* **Human-in-the-Loop Governance:** Autonomous execution operates under strict spending limits; high-value purchases automatically request one-click human sign-off.

---

## 📁 Repository Structure

```text
.
├── src/
│   ├── agents/                  # Person A: Agent Logic
│   │   ├── buyerAgent.ts        # Strategy, policy checks, auto-approval limits
│   │   ├── supplierAgent.ts     # Supplier negotiation logic & counter-offers
│   │   ├── verificationAgent.ts # Document verification & logistics checks
│   │   ├── orchestrator.ts      # Multi-agent orchestrator & HTTP settlement handoff
│   │   └── test-runner.ts       # CLI verification runner
│   ├── tools/                   # Agent Tools & Telemetry Data
│   │   ├── agentTools.ts        # Mock supplier search & verification tools
│   │   └── mockData.ts          # Suppliers & shipping telemetry data
│   ├── shared/                  # Shared Type System
│   │   └── types.ts             # BuyerIntent, DealTerms, AgentLogEvent types
│   ├── server/                  # Person B: Settlement Express Server
│   └── frontend/                # Person C: Next.js / React UI Dashboard
├── skills/                      # Agent skill resources & installer
└── README.md
```

---

## 💻 Tech Stack & Hackathon Tooling

* **Agent Logic:** TypeScript (`tsx`), Node.js
* **Blockchain Settlement:** [XRPL JavaScript SDK (`xrpl.js`)](https://github.com/XRPLF/xrpl.js), XRPL Testnet
* **Machine Payments:** [x402-secure SDK](https://github.com/t54-labs/x402-secure) / [XRPL x402 Facilitator](https://xrpl-x402.t54.ai/#setup)
* **Frontend:** Next.js, React, Tailwind CSS

---

## ⚡ Quick Start & Verification

### 1. Prerequisites
Ensure you have **Node.js v18+** installed.

### 2. Installation
Clone the repository and install dependencies:

```bash
git clone https://github.com/your-org/x-loom.git
cd x-loom
npm install
```

### 3. Run the Person A CLI Agent Test
You can execute and verify the complete 6-stage agent orchestration loop directly in your terminal without external API dependencies:

```bash
npx tsx src/agents/test-runner.ts
```

---

## 🔌 API Contract (Person A ↔ Person B Handshake)

The AI Orchestrator hands off agreed negotiation terms to Person B’s settlement server via a standard POST request:

* **Endpoint:** `POST /api/settlement/create-escrow`
* **Payload (`DealTerms` Schema):**

```json
{
  "dealId": "DEAL-1725472442000",
  "supplierName": "Shenzhen Precision Tech",
  "unitPriceUSD": 30,
  "quantity": 100,
  "totalPriceUSD": 3000,
  "deliveryDays": 5,
  "inspectionPassed": false,
  "status": "TERMS_AGREED"
}
```

---

## 🔗 XRPL & x402 Resources Used

* **[XRPL Developer Portal](https://xrpl.org/):** Protocol references for Escrow transactions (`EscrowCreate`, `EscrowFinish`).
* **[XRPL JavaScript SDK (`xrpl.js`)](https://js.xrpl.org/):** Transaction signing and WebSocket interaction.
* **[x402 Facilitator](https://xrpl-x402.t54.ai/#setup):** Machine-to-machine HTTP payment handshake.
* **[RLUSD Faucet](https://tryrlusd.com/):** Testnet stablecoin provisioning.