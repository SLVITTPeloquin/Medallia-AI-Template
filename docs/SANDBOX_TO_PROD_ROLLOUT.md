# Sandbox to Production Rollout (Medallia Zingle AI Responses)

## 1. Goal

Ship AI-assisted replies in a controlled sequence:

1. Sandbox suggestion-only
2. Production suggestion-only
3. Production limited auto-send for low-risk intents

## 2. Scope by Environment

### Sandbox/Test

- Ingest message events from test channels only
- Generate AI drafts for agent review only (no auto-send)
- Log intent, confidence, retrieval evidence, and final agent action
- Validate guardrails and escalation behavior

### Production (Phase 1)

- Suggestion-only in live environment
- Human approval required for every outbound message
- Daily quality review for hallucinations and policy errors

### Production (Phase 2)

- Auto-send allowed only for low-risk intents and high confidence
- Human review required for all policy-sensitive and high-impact intents
- Kill-switch enabled to immediately disable auto-send

## 3. Entry Criteria for Production

Move from sandbox to production suggestion-only only if all are true:

- At least 2 weeks of sandbox pilot data
- Hallucination rate below 1% on audited sample
- No unresolved critical safety/policy defects
- Response latency and reliability within targets
- Stakeholder sign-off from operations and compliance owner

## 4. Auto-Send Eligibility Rules

Allow auto-send only when all are true:

- Intent is in approved low-risk list (for example: towels, housekeeping ETA ack, amenity hours already documented)
- Confidence >= configured threshold
- Retrieved knowledge evidence exists and is fresh
- No safety/legal/billing/compensation signals
- No guardrail violations

Always require human review:

- Safety, health, lockout, outage
- Billing disputes, refunds, credits, compensation
- Complaints with reputational risk
- Missing or conflicting policy evidence

## 5. Quality Gates and KPIs

Track weekly:

- Suggestion latency (P50, P95)
- Agent acceptance rate (send as-is)
- Edit distance between AI draft and final sent text
- Escalation precision/recall
- Hallucination and policy violation rate

Recommended initial targets:

- P50 <= 2s, P95 <= 5s
- Acceptance rate >= 35% at start, then improve
- Hallucination rate < 1%

## 6. Release and Rollback Controls

Required controls:

- Feature flags by environment, property, and intent class
- Versioned prompt/template pack with changelog
- One-click rollback to last known good prompt/template version
- Auto-send kill-switch

## 7. Weekly Operating Cadence

1. Review audit samples and defect categories.
2. Update prompt/template pack based on top failure modes.
3. Re-run eval set and compare to prior week.
4. Promote changes only if quality gates pass.

## 8. Implementation Checklist

- Define allowed intents for each phase
- Implement environment-aware config and feature flags
- Implement confidence + guardrail gating before send
- Add full event/audit logging for generated and sent responses
- Create dashboards for quality and latency
- Define on-call owner and incident runbook for response errors
