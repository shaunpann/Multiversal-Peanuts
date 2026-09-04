# Ripple — Hacker Resources

> **Developer resources for building AI-native applications on XRPL** — Use this guide to find the documentation, SDKs, wallets, x402 tooling, and starter projects relevant to the challenge.

---

## 🚀 Start Here

If you're new to XRPL or the challenge stack, we recommend starting with:

1. **[XRPL Developer Portal](https://xrpl.org/)** — Main entry point for XRPL documentation, concepts, tutorials, and developer resources.
2. **[XRPL AI Starter Kit](https://ripple.com/insights/xrpl-ai-starter-kit/)** — Starting point for building AI agents that can interact with XRPL.
3. Choose an **XRPL SDK** for your preferred programming language.
4. Explore the **x402 tooling** below for machine-to-machine payments.
5. Use a **testnet wallet / faucet** while prototyping before considering mainnet deployment.

---

## Agent skill: xrpl-agentic-resources

This repo ships an installable agent skill that pre-loads the resources below into your coding agent so it can fetch exactly what a task needs. It covers agent wallets, x402 pay-per-call, agent credit, RLUSD, and the XLS specs, and it keeps live amendment and fee status current.

It works in Claude Code, Cursor, and Codex (all read the same `SKILL.md` format). From the repo root:

```
bash skills/install.sh
```

Then invoke `/xrpl-agentic-resources` in your agent. On first use run `bash skills/xrpl-agentic-resources/scripts/refresh.sh` to clone the vendored repos (Open Wallet Standard, t54 x402-secure, t54 rlusd-skills, XRPL dev-portal skills, XRPL-Standards) and re-crawl the live docs. What it bundles:

* `resources/xrpl-llms.txt` the full xrpl.org page index
* `resources/xrpl-amendments.json` live amendment status (check `enabled` before asserting a feature is on mainnet)
* `resources/xrpl-fee-settings.json` live reserves and base fee (cite these, never hardcode)
* fresh docs indexes for t54, XRPL x402, and claw.credit

See [skills/README.md](./skills/README.md) for per-agent install details.

---

## 📖 Core References

### XRPL Developer Portal

**[xrpl.org](https://xrpl.org/)**

The primary developer resource for the XRP Ledger.

Use it for:

* XRPL concepts and architecture
* Transaction types
* Accounts and wallets
* Tokens and payments
* Network interaction
* Tutorials and examples
* API references

### XRPL Documentation

**[XRPL Docs](https://xrpl.org/docs)**

The main XRPL technical documentation.

Useful when you need deeper information on specific XRPL functionality, transaction types, APIs, or implementation details.

### XRPL `llms.txt`

**[xrpl.org/llms.txt](https://xrpl.org/llms.txt)**

Machine-readable documentation index designed to make it easier for LLMs and AI coding tools to navigate XRPL documentation.

Useful if you are building with:

* AI coding assistants
* Agent frameworks
* LLM-based developer tools
* Automated documentation retrieval

### XRPL AI Starter Kit

**[XRPL AI Starter Kit](https://ripple.com/insights/xrpl-ai-starter-kit/)**

The primary starting point for this challenge.

Use the Starter Kit to explore how AI agents can interact with XRPL functionality and incorporate blockchain actions into agentic workflows.

---

## 🤖 AI, Agent & x402 Tools

These resources are particularly relevant for building autonomous agents, machine-to-machine payments, and AI-native products.

### RLUSD Testnet Faucet

**[tryrlusd.com](https://tryrlusd.com/)**

Use the faucet to obtain testnet RLUSD for development and prototyping.

Recommended for testing payment flows without using real assets.

### RLUSD CLI

**[GitHub — RLUSD CLI](https://github.com/t54-labs/rlusd-cli)**

Command-line tooling for working with RLUSD.

Useful for developers who want to interact with RLUSD directly from their terminal or integrate CLI-based workflows into development and testing.

### RLUSD Agent Skills

**[GitHub — RLUSD Agent Skills](https://github.com/t54-labs/rlusd-skills)**

Agent skills designed to help AI agents interact with RLUSD-related functionality.

Useful for teams exploring agent-native payment and transaction workflows.

### XRPL CLI

**[GitHub — xrpl-up](https://github.com/ripple/xrpl-up)**

Command-line tooling for interacting with and developing on XRPL.

Useful for quickly testing XRPL interactions without needing to build a full application interface.

---

## 💸 x402 & Machine-to-Machine Payments

### XRPL x402 Facilitator

**[XRPL x402 Facilitator](https://xrpl-x402.t54.ai/#setup)**

Reference implementation and setup resources for enabling x402 payment flows on XRPL.

Start here if your agent needs to:

* Access a paid API
* Purchase a digital service
* Pay another machine or agent
* Trigger a service after payment
* Demonstrate an autonomous commercial loop

### x402Secure Service

**[x402secure.com](https://www.x402secure.com/)**

Supporting infrastructure for building x402-enabled services.

Useful for teams exploring secured agentic payment and service-access workflows.

### x402 XRPL SDK

**[GitHub — x402-secure](https://github.com/t54-labs/x402-secure)**

SDK and implementation tooling for building x402 payment flows with XRPL.

Useful when integrating machine-to-machine payments directly into your application or agent architecture.

### Claw Credit

**[claw.credit](https://www.claw.credit/)**

Autonomous agent credit infrastructure using x402.

Useful as a reference for exploring how AI agents could access credit and participate in more advanced autonomous economic activity.

### OpenWallet Standard

**[openwallet.sh](https://openwallet.sh/)**
**[OpenWallet Documentation](https://docs.openwallet.sh/)**

An open standard for:

* Local wallet storage
* Delegated agent access
* Policy-gated signing
* Wallet interoperability across blockchain ecosystems

OpenWallet has begun supporting XRPL and may be useful for teams exploring **controlled wallet access for autonomous agents**.

---

## 👛 Wallets

You may use any suitable wallet for your application. The following wallets support different XRPL user experiences across mobile and browser environments.

### Reown / WalletConnect

**[XRPL RPC Reference](https://docs.reown.com/advanced/multichain/rpc-reference/xrpl-rpc)**

**Platform:** Mobile + Browser

Useful for applications that want to connect users to external wallets through WalletConnect-compatible flows.

### Xaman

**[xaman.app](https://xaman.app/)**

**Platform:** Mobile

A mobile wallet for interacting with XRPL applications and transactions.

### Joey

**[joeywallet.xyz](https://joeywallet.xyz/)**

**Platform:** Mobile

Mobile wallet option for XRPL users.

### Girin Wallet

**[girin.app](https://www.girin.app/)**

**Platform:** Mobile

Mobile wallet option for XRPL applications.

### Crossmark

**[crossmark.io](https://crossmark.io/)**

**Platform:** Browser

Browser-based wallet option for XRPL applications.

### GemWallet

**[gemwallet.app](https://gemwallet.app/)**

**Platform:** Browser

Browser wallet for connecting web applications to XRPL accounts.

---

## 🧰 XRPL SDKs

Choose the SDK that best matches your application's technology stack.

### JavaScript / TypeScript — `xrpl.js`

**[GitHub](https://github.com/XRPLF/xrpl.js)**
**[API Documentation](https://js.xrpl.org/)**

Recommended for JavaScript and TypeScript applications.

Suitable for:

* Web applications
* Node.js backends
* AI-agent services
* Rapid prototypes

### Python — `xrpl-py`

**[GitHub](https://github.com/XRPLF/xrpl-py)**

XRPL SDK for Python.

Suitable for:

* Python-based agents
* AI and ML applications
* Backend services
* Scripts and automation

### Java — `xrpl4j`

**[GitHub](https://github.com/XRPLF/xrpl4j)**

XRPL SDK for Java.

Suitable for Java-based services and applications.

### Rust — `xrpl-rust`

**[GitHub](https://github.com/XRPLF/xrpl-rust)**

XRPL SDK for Rust.

Useful for developers building Rust-based infrastructure, services, or applications.

### `xrpl-connect`

**[GitHub](https://github.com/XRPL-Commons/xrpl-connect)**

Unified wallet SDK for XRPL applications.

Useful for applications that want to support multiple wallet providers through a common integration layer.

### `xrpl-mpp-sdk`

**[GitHub — xrpl-mpp-sdk](https://github.com/ripple/xrpl-mpp-sdk)**

XRPL SDK for MPP-related functionality.

---

## 🏗️ Scaffolding & Developer Tools

If you want to get a prototype running quickly, these projects can help reduce setup time.

### Scaffold-XRP

**[GitHub — Scaffold-XRP](https://github.com/XRPL-Commons/scaffold-xrp)**

Application scaffolding for building on XRPL.

Useful for rapidly creating a starting application structure rather than setting up an XRPL project from scratch.

### Bedrock

**[GitHub — Bedrock](https://github.com/XRPL-Commons/Bedrock)**

Developer tooling from XRPL Commons for accelerating XRPL application development.

---

## 🧭 Suggested Build Path

If you're unsure where to begin, a simple development path is:

```text
Understand XRPL
      ↓
XRPL Developer Portal
      ↓
Explore the XRPL AI Starter Kit
      ↓
Choose your SDK
      ↓
Build your AI Agent
      ↓
Connect Agent Skills / Services
      ↓
Integrate x402
      ↓
Connect an XRPL Wallet
      ↓
Execute Testnet Transactions
      ↓
Demonstrate the Commercial Loop
```

For this challenge, focus on getting the **end-to-end product journey working first**.

You do not need to use every tool listed in this document.

Choose the resources that best support your architecture and product.

---

## ✅ Recommended Hacker Checklist

### Getting Started

* Read the XRPL Developer Portal
* Review the XRPL AI Starter Kit
* Select your preferred XRPL SDK
* Set up your development environment
* Create or connect a testnet wallet

### Building

* Implement the core AI-agent workflow
* Connect the agent to the services or resources it needs
* Integrate x402 for machine-to-machine payments
* Integrate XRPL transaction functionality
* Test failure and payment states
* Record successful transaction hashes

### Before Submission

* Confirm the core customer journey works
* Confirm at least one successful XRPL transaction
* Document your XRPL AI Starter Kit integration
* Document your x402 flow
* Add your architecture diagram
* Add transaction hashes or explorer references
* Make sure your repository setup instructions work
* Complete the builder feedback questions

---

## 💡 Building for the Challenge

Remember that the objective is not to use every available XRPL feature.

Focus on demonstrating a compelling relationship between:

```text
Customer Problem
      +
AI Agent
      +
Autonomous Decision-Making
      +
Machine-to-Machine Payment
      +
XRPL
      =
A Better Product or New Business Model
```

> **Build the product first. Use XRPL and x402 where they make the product possible or meaningfully better.**
