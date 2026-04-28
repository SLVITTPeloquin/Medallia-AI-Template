import express from "express";
import { normalizeEmailEvent, processInboundConversation } from "../orchestrator.js";
import { buildReviewItem, upsertReviewItem } from "../services/review-store.js";
import { appendAuditEvent } from "../services/audit-log.js";

export const outlookRouter = express.Router();

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeAddinPayload(body = {}) {
  const sender = body.sender || {};
  return {
    event_id: body.item_id || body.internet_message_id || "",
    thread_id: body.conversation_id || "",
    contact: {
      id: sender.email || "",
      name: sender.name || "",
      email: sender.email || ""
    },
    email: {
      id: body.item_id || "",
      subject: body.subject || "",
      body: body.body || "",
      received_at: body.received_at || new Date().toISOString()
    },
    recent_thread_summary: body.recent_thread_summary || "",
    provider: "outlook-addin"
  };
}

outlookRouter.post("/api/outlook/draft", route(async (req, res) => {
  const normalized = normalizeAddinPayload(req.body || {});
  const envelope = normalizeEmailEvent(normalized);
  const result = await processInboundConversation(envelope);
  const item = buildReviewItem({
    source: "email",
    envelope,
    normalized,
    result,
    receivedAt: normalized.email.received_at
  });
  const saved = await upsertReviewItem(item);

  const audit = await appendAuditEvent({
    eventType: "draft_generated",
    actor: req.body.actor || {},
    payload: {
      item_id: saved.id,
      outlook_item_id: req.body.item_id || "",
      conversation_id: req.body.conversation_id || "",
      sender: req.body.sender || {},
      subject: envelope.subject,
      category: saved.category,
      intent: saved.intent,
      confidence: saved.confidence,
      draft_subject: saved.draft_subject,
      draft_body: saved.draft_body,
      draft_options: saved.draft_options,
      action_checklist: saved.action_checklist
    },
    req
  });

  return res.json({
    item_id: saved.id,
    audit_id: audit.id,
    category: saved.category,
    intent: saved.intent,
    confidence: saved.confidence,
    handling_mode: saved.handling_mode,
    priority: saved.priority,
    draft_subject: saved.draft_subject,
    draft_body: saved.draft_body,
    draft_options: saved.draft_options,
    action_checklist: saved.action_checklist,
    review_markers: saved.review_markers,
    guardrail_issues: saved.guardrail_issues
  });
}));

outlookRouter.post("/api/outlook/audit", route(async (req, res) => {
  const audit = await appendAuditEvent({
    eventType: req.body.event_type || "addin_event",
    actor: req.body.actor || {},
    payload: req.body.payload || {},
    req
  });
  return res.status(201).json({ audit_id: audit.id });
}));
