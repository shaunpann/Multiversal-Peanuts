# Peanuts — agentic cross-border B2B settlement on XRPL

> Find your supplier anywhere. Negotiate anywhere. Settle here.
>
> An AI agent vets the suppliers you already deal with — paying for its own
> registry checks, unattended — and XRPL escrow holds the money until delivery
> is verified. Neither party has to join a marketplace.

---

## The gap this fills

| Order size | Instrument available today |
|---|---|
| Under ~$2k | Just wire it. The loss is survivable. |
| **$5k – $100k, supplier not on a marketplace** | **Nothing.** |
| Over ~$100k | Letter of credit — bank facility, fees, days of document work. |

Alibaba Trade Assurance solves counterparty risk only for suppliers listed on
Alibaba, transacting on Alibaba. Most SMEs already have their suppliers, or
find them through WhatsApp, a referral, or a trade show. Below the practical
letter-of-credit threshold and outside a marketplace, the only instrument is
*wire 30% and hope*.

Peanuts is not another marketplace. It is the layer you bring a deal to once
you already have one.

---

## Two payment planes

The separation is the design. Autonomy is scoped by reversibility and size, not
by "deciding vs paying".

| | Plane 1 — x402 service calls | Plane 2 — XRPL escrow |
|---|---|---|
| **Who authorises** | the agent, unattended | a human, once |
| **Amount** | 0.10 – 0.25 XRP per call | the contract value |
| **Buys** | the information needed to decide | the goods |
| **Bounded by** | policy engine + the agent's own funded account | escrow condition + refund deadline |

Plane 1 is what makes this agentic: the agent spends its own money to learn
things that change what it does next. In the demo run it **pays to check the
cheapest supplier, finds a lapsed registration and $47,200 of unresolved
disputes, and picks a more expensive one instead.**

---

## Flow

```
  BUYER          BUYER AGENT              MERCHANT           SUPPLIER
 (human)        (own wallet)           (service APIs)        (human)
    │                 │                       │                  │
    │ 1. paste the    │                       │                  │
    │    WhatsApp     │                       │                  │
    │    thread ─────►│  2. read it into a brief                 │
    │                 │                       │                  │
    │                 │  3. GET verify ──────►│                  │
    │                 │◄──── 402 + nonce ─────┤                  │
    │                 │  ── XRPL Payment ────►│   ← autonomous   │
    │                 │  GET + X-PAYMENT ────►│                  │
    │                 │◄──── registry ────────┤                  │
    │                 │  (per supplier, then freight + customs)  │
    │                 │                       │                  │
    │ 4. recommend    │  negotiate ──────────────────────────────►
    │◄────────────────┤                       │                  │
    │                                                            │
    │ 5. APPROVE ── the only human gate ───────────────────────► │
    │ 6. invite link ──────────────────────────────────────────► │
    │                                       7. payout address ───┤
    │        ┌───────────────────────────────────────────────┐   │
    │        │ EscrowCreate — locked, condition + CancelAfter │  │
    │        └───────────────────────────────────────────────┘   │
    │                                       8. delivery evidence ┤
    │              VERIFICATION AGENT judges it                  │
    │        ┌───────────────────────────────────────────────┐   │
    │        │ EscrowFinish — supplier paid                  │──►│
    │        └───────────────────────────────────────────────┘   │
```

If nobody ever releases, `EscrowCancel` returns the funds to the buyer after
`CancelAfter` — without needing the supplier's or the oracle's cooperation.

---

## Run it

```bash
npm install
cp .env.example .env      # optional; see below
npm run server            # http://localhost:3000
```

Testnet wallets are created and funded from the faucet on first boot and cached
under `data/`.

**Buyer page** — `Start an order` → paste the thread you already have with your
suppliers (or hit `Use a sample thread`) → `Read this`, which fills the brief and
the supplier rows → `Check them and recommend one` → approve → send the supplier
the invite link.

The form starts empty on purpose: what fills it is the agent reading your
messages, not a prefilled demo.

**Supplier page** — open the invite link, generate a testnet address, submit
delivery evidence.

**Agent dashboard** — `/agent.html`: balances, spending policy, every autonomous
payment ever made, sourcing runs, and settled deals.

| Script | What it does |
|---|---|
| `npm run server` | the web app |
| `npm run test:agents` | CLI agent loop against the mock catalogue |
| `npm run test:xrpl` | escrow create/finish on testnet |
| `npm run test:xrpl:refund` | the refund path |

### Environment

```bash
PORT=3000
CANCEL_AFTER_SECONDS=604800   # 7 days; shorten to demo the refund path
ANTHROPIC_API_KEY=            # optional
```

Without an API key the app still runs end to end: context reading falls back to
a labelled pattern scan and evidence review to a labelled rule-based check.
Both fallbacks say so in the UI. With a key, `claude-opus-5` reads the thread
and vision judges delivery photos.

---

## Verified on XRPL Testnet

One complete run, September 2026.

**Autonomous payments — agent authorised, no human involved**

| Service | Price | Transaction |
|---|---|---|
| verify-business (Dongguan → rejected) | 0.25 XRP | [`7B9B3A1D…`](https://testnet.xrpl.org/transactions/7B9B3A1DD46534C2A514BD519A9873AC797E26AD74EC6D2C85C67D213CE01BEB) |
| verify-business (Shenzhen → selected) | 0.25 XRP | [`6FB6955C…`](https://testnet.xrpl.org/transactions/6FB6955C5A3D1A45B68A004F710916371B50D195FDFE7D65A6DC616089EB63D2) |
| freight-quote | 0.10 XRP | [`836D5F09…`](https://testnet.xrpl.org/transactions/836D5F09C5FF5113D6056E4AF1B506178D24BDCA2D893A5C8A7F28485E4CCAF6) |
| customs-check | 0.10 XRP | [`1869AD49…`](https://testnet.xrpl.org/transactions/1869AD490C7616D38BDAD693BF6DECF0803B6677E8A02712E50BCAC02C3C2294) |

**Settlement — human approved once**

| Step | Transaction |
|---|---|
| EscrowCreate (funds locked) | [`E096312B…`](https://testnet.xrpl.org/transactions/E096312B11E64AA260EB89261B3324A3C4834FFBD0380DC8A1DE1A89432AF695) |
| EscrowFinish (supplier paid) | [`39D0DEC2…`](https://testnet.xrpl.org/transactions/39D0DEC27EB84FDC576639A3181948E4FF74CE707CF93B568968905B0E7B6858) |

Every transaction carries `SourceTag 20260530` and memos binding it to the deal
and action, so agent activity is filterable on-ledger — see
[Track and Measure Agent Behavior](https://xrpl.org/docs/agents/track-agent-behavior).

Measured on testnet: **~6 s to validated, 12 drops per payment.** Five agent
payments cost 0.00006 XRP in fees — roughly 0.005% overhead on a 0.25 XRP
purchase, which is why a 25-cent API call can exist as a business model at all.

---

## Trust model, stated plainly

**One escrow releases once, all-or-nothing.** `EscrowFinish` cannot pay out part
of an amount.

**The ledger cannot verify a delivery.** XRPL conditional escrow supports one
condition type, `PREIMAGE-SHA-256`; the ledger only checks that a fulfillment
hashes to the stored condition. The verification agent holds the preimage and
reveals it when evidence passes — **it is a trusted oracle, and we do not
pretend otherwise.** What the ledger does guarantee:

- the funds cannot move anywhere except to the named supplier;
- not even the buyer can retract them before `CancelAfter`;
- if the oracle never releases, the buyer is refunded without anyone's consent.

**Spending controls sit below the model.** `PolicyEngine` runs inside the
payment path — per-call cap, per-deal budget, service allowlist, call limit, and
an auto-approval threshold above which a human is asked. No prompt can talk past
it. And the agent's authority is denominated in a **funded XRPL account**: its
maximum possible loss is its balance.

**When the fallback reviewer is handed a photo it cannot see**, it returns
`NEEDS_MANUAL_REVIEW` rather than guessing.

---

## What is real, and what is stubbed

**Real:** every XRPL transaction; crypto-conditions; the x402 challenge/verify
round trip including nonce replay protection, per-run idempotency and
`delivered_amount` checks; the policy engine; the human approval gate; the
supplier invite flow; Claude reasoning when a key is configured.

**Stubbed:** the registry, freight, inspection and customs services return
fixture data. The paid endpoint and the payment are genuine — the data behind
them is not. Swapping in ACRA (SG), SSM (MY) or 企查查 (CN) is an adapter behind
the same 402, changing nothing above it.

**The supplier agent is a simulation** — both sides of the negotiation are our
code, standing in for a real counterparty.

**x402 is implemented, not imported.** The challenge/pay/retry flow follows the
HTTP 402 pattern but is our own implementation, not the
[t54 XRPL x402](https://xrpl-x402.t54.ai/docs/overview) SDK, so it is not
interoperable with other x402 merchants yet.

---

## Layout

```
src/
├── agents/
│   ├── contextReader.ts     read a WhatsApp/email thread into a brief
│   ├── orchestrator.ts      shortlist → verify → negotiate → recommend
│   ├── buyerAgent.ts        bidding strategy and approval thresholds
│   ├── supplierAgent.ts     simulated counterparty
│   └── verificationAgent.ts release-or-refund decision
├── x402/
│   ├── services.ts          the paid service catalogue
│   ├── middleware.ts        merchant: 402 challenge, nonce, delivery check
│   ├── client.ts            agent: policy gate, pay, retry with proof
│   └── wallets.ts           the agent's own funded account
├── shared/policy.ts         spending controls, enforced below the model
├── tools/xrplTools.ts       escrow create / finish / cancel
└── server/
    ├── index.ts             settlement API, paid routes, agent endpoints
    ├── evidenceReviewer.ts  Claude vision, with an honest fallback
    └── store.ts             deals, wallets, durable receipt ledger

public/                      buyer page, supplier page, agent dashboard
data/                        deals, wallet seeds, receipt ledger (gitignored)
```

## Next

- Milestone escrows (30 / 30 / 40) — several escrows created up front, each
  with its own condition and deadline
- RLUSD via `TokenEscrow` (enabled on mainnet with `fixTokenEscrowV1`); needs
  trust lines and the issuer's trust-line-locking flag
- Real registry, inspection and carrier adapters behind the same paid endpoints
- The t54 x402 SDK in place of our own implementation, for interoperability
- Payment channels for high-frequency agent calls, settling once per session
