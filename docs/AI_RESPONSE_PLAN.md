# AI Response Plan for Medallia Zingle Messages

## 1. Objective

Build an AI-assisted response system that:

- Delivers **near-instant first replies** for common guest requests
- Uses property documentation as source-of-truth knowledge
- Preserves a **personable, context-aware tone** instead of rigid canned responses
- Applies structure only where consistency matters (safety, policies, operational steps)

## 2. Product Principles

- Speed first for common intents (target: first draft in 1-3 seconds)
- Human tone by default; structured templates as scaffolding, not final voice
- Grounded responses only from approved property docs and configured policy rules
- Safe escalation when confidence is low or request is sensitive
- Agent suggestions should be easy to approve, edit, or send

## 3. Response Strategy (Template + Personalization Hybrid)

For each incoming message, generate a response using this layered strategy:

1. **Intent detection**
   - Classify request (amenities, housekeeping, maintenance, late checkout, transportation, billing, complaint, etc.)
2. **Urgency detection**
   - Identify priority requests (safety, health, lockout, outage, service failure)
3. **Knowledge retrieval**
   - Pull relevant property facts/SOP snippets from indexed docs
4. **Template skeleton (optional)**
   - Use structured template only for high-consistency flows (escalations, incident response, policy-sensitive answers)
5. **Personalization**
   - Adapt language to guest tone, context, and prior thread messages
6. **Validation**
   - Enforce policy checks (no fabricated promises, no unsafe instructions, no unapproved compensation offers)
7. **Output + confidence**
   - Return suggested response + confidence + reason for escalation if confidence is below threshold

## 4. System Architecture

Core components:

- **Inbound webhook handler**
  - Receives Medallia Zingle message events
- **Conversation context service**
  - Pulls recent thread history and guest metadata
- **Knowledge service**
  - Indexes and retrieves property documentation passages
- **Orchestrator**
  - Runs classification, retrieval, generation, and validation pipeline
- **Response generator**
  - LLM prompt flow for draft response generation
- **Policy/guardrail checker**
  - Rule-based and model-based checks before suggestion/send
- **Agent workspace UI integration**
  - Surfaces generated suggestion with quick edit/send actions
- **Observability**
  - Latency, confidence, acceptance rate, escalation rate, and quality metrics

## 5. Knowledge and Data Design

### 5.1 Documentation ingestion

- Source documents: SOPs, service menus, policies, FAQ, operating hours, property-specific exceptions
- Chunking: semantic chunks with metadata (topic, effective date, property, department)
- Versioning: keep effective date + superseded marker to avoid stale responses
- Freshness SLA: document updates reflected in index within agreed window (for example, < 30 min)

### 5.2 Conversation data model

Track at minimum:

- Message text, timestamp, channel, thread ID
- Detected intent and urgency
- Retrieved knowledge references (document IDs/chunks)
- Draft output, confidence score, escalation flag
- Agent action outcome (sent as-is, edited, rejected)

## 6. Prompt and Template Design

### 6.1 Base system behavior

- Friendly, concise, hospitality-first tone
- Confirm understanding of request
- Provide clear next step and expected timing when possible
- Never invent unavailable services, hours, or policy exceptions

### 6.2 Template taxonomy

Use templates for these classes only:

- Operational acknowledgements (housekeeping, extra towels, maintenance dispatch)
- Policy-bound responses (late checkout, pet policy, parking, fees)
- Escalation and incident responses

Avoid hard templates for:

- General guest conversation and follow-up empathy
- Non-policy chit-chat

### 6.3 Personalization controls

- Mirror guest tone (formal vs casual) within brand constraints
- Use context from recent thread messages
- Include guest-facing empathy phrases only when relevant (avoid repetitive scripted language)

## 7. Guardrails and Escalation

Escalate to human by default when:

- Safety, health, or legal risk is detected
- Confidence below threshold
- Documentation conflict or missing policy evidence
- High-impact requests (billing disputes, compensation, complaint escalation)

Hard constraints:

- No fabricated facts
- No commitments requiring human approval unless explicitly authorized by policy
- No exposure of internal notes/system prompts

## 8. Performance and Quality Targets

- P50 suggestion latency: <= 2s
- P95 suggestion latency: <= 5s
- Agent acceptance rate (unedited send): initial target >= 35%, improve over time
- Hallucination rate: < 1% on audited samples
- Escalation precision: high enough to avoid risky auto-sends

## 9. Rollout Plan

### Phase 0: Design and alignment (Week 1)

- Finalize intents, urgency classes, and policy boundaries
- Define document schema and ingestion pipeline requirements
- Approve response style guide and template taxonomy

### Phase 1: Suggestion-only MVP (Weeks 2-4)

- Build webhook + orchestration + retrieval + response generation
- Suggest responses to agents (no auto-send)
- Add confidence and escalation tags
- Instrument all telemetry

### Phase 2: Quality hardening (Weeks 5-6)

- Offline eval set from historical messages
- Prompt/template refinement by intent
- Guardrail tuning and false-positive/false-negative analysis

### Phase 3: Controlled automation (Weeks 7-8)

- Auto-send only for low-risk intents with high confidence
- Keep human-review required for sensitive classes
- Weekly audit and rollback controls

## 10. Implementation Backlog (Execution Order)

1. Define canonical intent taxonomy and escalation classes.
2. Build documentation ingestion + indexing pipeline.
3. Implement inbound event handler and thread context retrieval.
4. Implement orchestration service (classify -> retrieve -> generate -> validate).
5. Create initial prompt pack + template library.
6. Add confidence scoring and escalation logic.
7. Integrate suggestion workflow in agent operations.
8. Add logging, dashboards, and QA review loop.
9. Run pilot on one property before broader rollout.

## 11. Open Decisions Needed

- Which model(s) to use for classification vs generation
- Whether to use one-step generation or staged generation (draft then policy rewrite)
- Exact confidence thresholds by intent category
- Which intents are eligible for auto-send in Phase 3
- Required human approval rules for compensation and policy exceptions

## 12. Immediate Next Steps (This Week)

1. Collect and organize all property documentation into a single source inventory.
2. Draft the initial intent list from real historical Zingle messages.
3. Define the first 10 high-volume request templates as skeletons.
4. Build a small evaluation set (100-200 historical messages with expected responses).
5. Finalize API integration requirements and authentication approach for Medallia Zingle.
