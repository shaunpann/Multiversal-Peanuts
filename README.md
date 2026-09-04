# Multiversal Peanuts — agentic cross-border B2B settlement on XRPL

An AI agent sources and vets suppliers, negotiates terms, and pays for the
services it needs to make that decision — unattended, over x402. The contract
itself is settled through milestone escrows on the XRP Ledger, released as
real-world trade conditions are met.

> **Find your supplier anywhere. Negotiate anywhere. Settle through the protocol.**
> Neither party has to join a marketplace.

---

## Two payment planes

The distinction is the whole design. Autonomy is scoped by reversibility and
size, not by "deciding vs paying".

| | Plane 1 — x402 service calls | Plane 2 — XRPL escrow |
|---|---|---|
| **Who authorises** | the agent, unattended | a human, once |
| **What moves** | 0.10–0.25 XRP per call | the contract value |
| **Buys** | supplier verification, freight quotes, customs classification, inspection | the goods |
| **Bound by** | a funded agent wallet + policy engine | milestone conditions + refund deadline |

Plane 1 is what makes this agentic: the agent spends its own money to learn
things that change what it does next. In the demo run it **pays to verify the
cheapest supplier, discovers a lapsed registration and two open disputes, and
rejects it in favour of a more expensive one**. No human sees those candidates.

---

## Architecture

```
                       ┌──────────────────────────┐
   mandate ──────────► │       Buyer Agent        │
   (human, once)       │  discover · verify ·     │
                       │  negotiate · recommend   │
                       └───┬──────────────────┬───┘
                           │                  │
              x402 pay-per-call        settlement API
                           │                  │
                  ┌────────▼────────┐   ┌─────▼──────────────┐
                  │ Paid services   │   │ Settlement service │
                  │ verify-business │   │  N escrows, one    │
                  │ freight-quote   │   │  per milestone     │
                  │ customs-check   │   └─────┬──────────────┘
                  │ inspection      │         │
                  └────────┬────────┘         │
                           │                  ▼
                  ┌────────▼──────────────────────────────┐
                  │            XRP Ledger (testnet)        │
                  │  Payment ×5        EscrowCreate ×3     │
                  │  (agent → merchant) EscrowFinish ×3    │
                  └────────────────────────────────────────┘
                                     ▲
                  ┌──────────────────┴───────┐
                  │   Verification Agent     │
                  │ evidence → preimage      │
                  └──────────────────────────┘
```

**Ownership** — `src/agents/` + `src/x402/client.ts` (intelligence) ·
`src/xrpl/` + `src/x402/middleware.ts` + `src/server/` (money) ·
`src/frontend/` (presentation). The three talk over the settlement API and the
event bus, never by importing each other's internals.

---

## Run it

```bash
npm install
cp .env.example .env      # ANTHROPIC_API_KEY optional
npm start                 # http://localhost:3000
```

Wallets are created and funded from the testnet faucet on first boot and cached
in `.wallets.json`. In the dashboard: **Run the deal** → approve the recommended
deal when it appears in Panel A → **Simulate carrier dispatch** to release the
final milestone.

```bash
npm run smoke       # create + finish one conditional escrow on testnet
npm run balances    # the four accounts and what they hold
npm run typecheck
```

Without `ANTHROPIC_API_KEY` the agents fall back to deterministic negotiation —
the settlement path is identical, so the demo never depends on a key. With one,
negotiation runs on `claude-opus-5` with structured outputs.

---

## Verified run (XRPL Testnet)

Deal `TX-EC029B` — 50 tables, S$27,850, Melaka Furniture Collective.

**Escrows (6 XRP, representing the contract at demo scale)**

| Milestone | % | Amount | EscrowCreate | EscrowFinish |
|---|---|---|---|---|
| Production started | 30 | 1.8 XRP | [`B33A37E8…`](https://testnet.xrpl.org/transactions/B33A37E8A6DB39088D2AACF57774C84E728518CA326067D5DBB1558DA1A6B945) | [`1E7E5D65…`](https://testnet.xrpl.org/transactions/1E7E5D655E8096F9D7A97BA2119129944DB038C3F6492A5D8F79AED5F8E19991) |
| Inspection passed | 30 | 1.8 XRP | [`CE8F2879…`](https://testnet.xrpl.org/transactions/CE8F287950CF75E0F3F27BB722C36755EE8C2524D2FB85CA33B70549896F330A) | [`A7642524…`](https://testnet.xrpl.org/transactions/A764252405FF93427963649CE35046696878BED87E07D3D5B5ACDA396CC0FC53) |
| Delivery confirmed | 40 | 2.4 XRP | [`BAB7B40C…`](https://testnet.xrpl.org/transactions/BAB7B40C0170ED3D5211F69A0A46B0808F1DD2E6C7A1D9CEC8F6CD998B942990) | [`CA25FE72…`](https://testnet.xrpl.org/transactions/CA25FE723160D63685A76B7CB1872AEABFC794DEEF64C124BB2F48BB812B56B2) |

**x402 payments the agent authorised on its own — 0.9 XRP over 5 calls**

| Service | Price | Payment |
|---|---|---|
| verify-business (SUP-A → rejected) | 0.25 | [`A0EDF343…`](https://testnet.xrpl.org/transactions/A0EDF343E1470CC5E29B938F5EEC14C2994EAB0DA2BE0AF5DAB2AE6B8E039120) |
| verify-business (SUP-B → selected) | 0.25 | [`4F787109…`](https://testnet.xrpl.org/transactions/4F787109B343498B9C9FB0933D7AB25E6028BD83F39C71027ED6ECD5D77C0E6D) |
| freight-quote | 0.10 | [`58661C18…`](https://testnet.xrpl.org/transactions/58661C1808364739DF1F4B78A798EEAE49D15FD1A4F127CBF5CBF67911BEBEF2) |
| customs-check | 0.10 | [`4278C04A…`](https://testnet.xrpl.org/transactions/4278C04AF5276FAF20B558AFED3D049FA45E7095B1D25A24ACB8A9D31C5C4E62) |
| inspection | 0.20 | [`0ED6E061…`](https://testnet.xrpl.org/transactions/0ED6E0617575F7D9B8D3100D6E1B13417CCAB3B8801B503499E9B60F1C187D92) |

Every transaction carries `SourceTag 402402` and memos tying it to the deal,
milestone, and a SHA-256 of the agreed terms — so agent activity is filterable
on-ledger, per [Track and Measure Agent Behavior](https://xrpl.org/docs/agents/track-agent-behavior).

---

## Trust model — stated plainly

**One escrow releases once, all-or-nothing.** `EscrowFinish` cannot pay out part
of an amount, so a 30/30/40 structure is three escrows created up front, each
with its own condition and its own `CancelAfter`.

**The ledger cannot verify a delivery.** XRPL conditional escrow supports one
condition type, `PREIMAGE-SHA-256`; the ledger only checks that a fulfillment
hashes to the stored condition. So the verification agent holds the preimage and
reveals it when evidence passes. That agent is a trusted oracle, and we do not
pretend otherwise. What the ledger *does* guarantee:

- the funds cannot move anywhere except to the named supplier;
- not even the buyer can retract them before `CancelAfter`;
- if the oracle never releases, `EscrowCancel` refunds the buyer without needing
  the supplier's or the oracle's cooperation (`POST /settlement/cancel`).

**Spending controls are enforced below the model.** `PolicyEngine` sits in the
payment path, so no prompt can talk past a limit — per-call cap, per-deal budget,
service allowlist, call count, and an auto-approval threshold above which a human
is asked. And the agent's authority is denominated in a **funded account**: it
holds its own allowance and cannot spend more than its balance, whatever it
decides.

---

## What is real and what is simulated

**Real:** every XRPL transaction, the crypto-conditions (hand-rolled DER
encoding, self-tested at boot), the x402 challenge/verify round trip including
nonce replay protection and `delivered_amount` checks, the policy engine, the
approval gate, LLM negotiation when a key is present.

**Simulated:** the supplier is an agent playing a counterparty rather than a real
company; the paid services return fixtures instead of calling real registries and
inspectors; the carrier webhook is a button. Each is a swap of one adapter — the
settlement path does not change.

**Amounts:** the demo escrows 6 XRP on testnet to represent a S$27,850 contract.
`TokenEscrow` and `fixTokenEscrowV1` are enabled on mainnet, so RLUSD escrow is
the production path; it needs trust lines on both sides and the issuer's
trust-line-locking flag, which is why the demo settles in XRP.

---

## Next

- RLUSD via `TokenEscrow` once trust lines and the issuer flag are provisioned
- Real registry, inspection and carrier adapters behind the same x402 endpoints
- Credentials / permissioned domains to gate who may act as an oracle
- Batch the three `EscrowCreate`s once `Batch` (XLS-56) is enabled
