# Medallia-AI-Template

This repository will be used to design and build AI template replies for **Medallia Zingle**.

## Purpose

The goal is to create reusable, high-quality response templates that can help teams reply faster while maintaining consistent tone, accuracy, and policy alignment.
The rollout starts in a sandbox/test environment and then moves to production with explicit safety gates.

## Initial Scope

- Define template categories (for example: first response, follow-up, escalation, resolution)
- Draft prompt patterns for each category
- Establish quality guidelines (tone, clarity, compliance)
- Set up evaluation criteria for response quality and consistency

## API Planning

We need to plan how we will integrate with the Medallia Zingle API before implementation:

- Authentication and credential handling
- Endpoint mapping for incoming and outgoing messages
- Data model for conversations, metadata, and templates
- Trigger strategy (manual, assisted, or automated suggestions)
- Error handling, rate limits, retries, and observability
- Security and audit logging requirements

## Next Steps

1. Confirm API capabilities and required permissions.
2. Define an initial architecture for template generation and delivery.
3. Build a minimal proof of concept for one message flow.
4. Add test cases and quality checks before production rollout.
5. Run a sandbox pilot with suggestion-only mode before any production auto-send.

## Planning Document

Detailed implementation plan: [`docs/AI_RESPONSE_PLAN.md`](docs/AI_RESPONSE_PLAN.md)

## Working Assets

- Sandbox to production rollout guide: [`docs/SANDBOX_TO_PROD_ROLLOUT.md`](docs/SANDBOX_TO_PROD_ROLLOUT.md)
- Initial template library: [`docs/TEMPLATE_LIBRARY_V1.md`](docs/TEMPLATE_LIBRARY_V1.md)
- Prompt pack for AI response generation: [`docs/PROMPT_PACK_V1.md`](docs/PROMPT_PACK_V1.md)
- Sandbox MVP run guide: [`docs/SANDBOX_MVP_QUICKSTART.md`](docs/SANDBOX_MVP_QUICKSTART.md)
- Sandbox integration guide: [`docs/SANDBOX_INTEGRATIONS.md`](docs/SANDBOX_INTEGRATIONS.md)
- Outbound reporting script guide: [`docs/OUTBOUND_COUNTS.md`](docs/OUTBOUND_COUNTS.md)
- Outlook inbox analysis guide: [`docs/OUTLOOK_INBOX_ANALYSIS.md`](docs/OUTLOOK_INBOX_ANALYSIS.md)
- Zingle API call guide: [`docs/ZINGLE_API_CALLS.md`](docs/ZINGLE_API_CALLS.md)
- Azure diagnostics MCP server guide: [`docs/AZURE_MCP_SERVER.md`](docs/AZURE_MCP_SERVER.md)

## Sandbox MVP Service

This repository now includes a runnable Node/Express MVP service with:

- `POST /webhooks/zingle/sms` and `POST /webhooks/zingle/email` for sandbox ingress
- Shared orchestration pipeline: classify -> retrieve -> generate -> guardrail check -> confidence scoring
- Channel-specific preview output:
  - SMS returns ordered `segments`
  - Email returns `subject` and formatted `body`
- Environment guardrails: sandbox-only preview behavior with production rejection enabled by default

## Outlook Analysis

The repo also includes mailbox analysis tooling for Microsoft Outlook service inboxes:

- `npm run preview:email -- --top 5` to preview recent email classifications
- `npm run analyze:outlook -- --days 14 --top 100` to analyze inbox categories, human reply patterns, and automation candidates
