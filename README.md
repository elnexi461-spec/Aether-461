# Aether
### A stateful agent for personal workflows and Web3 research

Aether explores how an AI agent can combine persistent state, retrieval, browser-based research, and paid tool calls in one Cloudflare-native system. The project was built for Cloudflare Agents Day 2026.

> **Project status:** Experimental. Treat the repository as an engineering prototype, not a production financial system. Review the implementation and deployment configuration before using it with real accounts, funds, or sensitive data.

## Why this project exists

Many agent demos are short-lived scripts: they accept a prompt, call a model, and stop. Aether investigates a different design: an agent that can retain useful state between runs and connect reasoning to tools and external services.

The project brings together two example workflows:

- **Research and retrieval:** organize information and retrieve relevant context using a vector search layer.
- **Web3 discovery:** explore ecosystem information and investigate potential opportunities. Any financial decision or transaction should remain subject to explicit human review.

## System map

```text
User / scheduled trigger
        |
        v
Cloudflare Agent runtime
        |
        +------> D1: durable application state
        |
        +------> Vectorize + BGE Large: retrieval
        |
        +------> Browser Rendering: web research
        |
        +------> x402 / Coinbase SDK: payment integration
        |
        v
Structured result + persisted state
```

This diagram describes the intended component boundaries; it is not a guarantee that every path is fully wired or production-hardened.

## Technology choices

| Area | Technology | Role |
|---|---|---|
| Runtime | Cloudflare Workers / Agents SDK | Agent execution |
| Persistence | Cloudflare D1 | Durable application state |
| Retrieval | Cloudflare Vectorize + BGE Large | Semantic search / RAG |
| Browser access | Cloudflare Browser Rendering | Web research workflows |
| Payment integration | x402 protocol + Coinbase SDK | Exploring paid tool calls |

## Engineering questions this project explores

- How should an agent separate reasoning from tool execution?
- Which state belongs in durable storage rather than in the prompt?
- How can retrieval provide relevant context without making the model's output automatically trustworthy?
- Where should human approval sit before an action with external or financial consequences?
- How should tool failures, retries, and partial results be surfaced?

## Safety and trust boundaries

Aether touches external services and Web3-related workflows, so a responsible deployment should:

- Keep API keys and credentials in environment or platform secrets, never in source control.
- Use read-only credentials wherever possible.
- Require explicit confirmation before any transaction, transfer, or irreversible action.
- Treat retrieved pages and model-generated content as untrusted input.
- Add spend limits, timeouts, retry caps, and audit logs before enabling unattended operation.
- Test against mock data or a development environment before connecting real accounts.

The README does not claim that these controls are all implemented. Verify the code and deployment settings before relying on them.

## Repository status and next steps

This repository is an evolving prototype. Before treating it as a deployable service, document the exact setup steps, required bindings, environment variables, test commands, and current implementation status for each workflow.

Useful next milestones:

1. Add a reproducible local or preview-environment setup.
2. Add tests for state persistence, retrieval, and tool failure paths.
3. Document which agent actions are read-only and which can cause side effects.
4. Add structured logs and a clear approval boundary for sensitive actions.
5. Publish a short demo showing a real, verified workflow.

## License

Check the repository's license file for the terms that apply to this project.
