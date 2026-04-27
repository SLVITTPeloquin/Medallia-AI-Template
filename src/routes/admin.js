import express from "express";
import { config } from "../config.js";
import {
  beginGraphDeviceCodeLogin,
  getGraphAuthStatus,
  isGraphAuthRequiredError,
  listGraphMessages,
  normalizeGraphMessage
} from "../services/graph.js";
import { listInboundZingleMessages, normalizeZingleMessage } from "../services/zingle.js";
import { normalizeEmailEvent, normalizeSmsEvent, processInboundConversation } from "../orchestrator.js";
import {
  buildReviewItem,
  getReviewSummary,
  listReviewItems,
  markReviewItemSent,
  updateReviewItem,
  upsertReviewItem
} from "../services/review-store.js";

export const adminRouter = express.Router();

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

adminRouter.get("/api/review/summary", route(async (_req, res) => {
  res.json(await getReviewSummary());
}));

adminRouter.get("/api/review/items", route(async (req, res) => {
  const items = await listReviewItems({
    status: req.query.status,
    source: req.query.source
  });
  res.json({ items });
}));

adminRouter.patch("/api/review/items/:id", route(async (req, res) => {
  const patch = {};
  for (const key of [
    "status",
    "draft_subject",
    "draft_body",
    "notes",
    "category_review",
    "category_review_notes",
    "action_checklist"
  ]) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      patch[key] = req.body[key];
    }
  }
  const updated = await updateReviewItem(req.params.id, patch);
  if (!updated) {
    return res.status(404).json({ error: "not_found" });
  }
  return res.json(updated);
}));

adminRouter.post("/api/review/items/:id/send", route(async (req, res) => {
  const { item, reason } = await markReviewItemSent(req.params.id);
  if (!item && reason === "not_found") {
    return res.status(404).json({ error: "not_found" });
  }
  if (reason === "checklist_incomplete") {
    return res.status(400).json({ error: "checklist_incomplete", item });
  }
  return res.json(item);
}));

adminRouter.post("/api/review/poll/email", route(async (req, res) => {
  let messages = [];
  try {
    messages = await listGraphMessages({
      folder: "inbox",
      since: req.body.since || new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      until: req.body.until || "",
      top: Number(req.body.top || 50),
      maxPages: Number(req.body.maxPages || 3),
      allowDeviceCode: false
    });
  } catch (error) {
    if (isGraphAuthRequiredError(error)) {
      return res.status(401).json({
        error: "graph_auth_required",
        message: error.message,
        prompt: error.prompt || null
      });
    }
    throw error;
  }

  const items = [];
  for (const message of messages) {
    const normalized = normalizeGraphMessage(message);
    const envelope = normalizeEmailEvent(normalized);
    if (!envelope.messageText?.trim()) {
      continue;
    }
    const result = await processInboundConversation(envelope);
    const item = buildReviewItem({
      source: "email",
      envelope,
      normalized,
      result,
      receivedAt: message.receivedDateTime || normalized.email.received_at
    });
    items.push(await upsertReviewItem(item));
  }

  res.json({ processed: items.length, items });
}));

adminRouter.get("/api/review/auth/email/status", route(async (_req, res) => {
  const status = await getGraphAuthStatus();
  res.json(status);
}));

adminRouter.post("/api/review/auth/email/start", route(async (_req, res) => {
  const status = await beginGraphDeviceCodeLogin();
  res.json(status);
}));

adminRouter.post("/api/review/poll/zingle", route(async (req, res) => {
  const messages = await listInboundZingleMessages({
    since: req.body.since || new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    until: req.body.until || "",
    pageSize: Number(req.body.pageSize || 100),
    maxPages: Number(req.body.maxPages || 3)
  });

  const items = [];
  for (const message of messages) {
    const normalized = normalizeZingleMessage(message);
    const envelope = normalizeSmsEvent(normalized);
    if (!envelope.messageText?.trim()) {
      continue;
    }
    const result = await processInboundConversation(envelope);
    const item = buildReviewItem({
      source: "zingle",
      envelope,
      normalized,
      result,
      receivedAt: normalized.created_at
    });
    items.push(await upsertReviewItem(item));
  }

  res.json({ processed: items.length, items });
}));

adminRouter.post("/api/review/ingest/zingle", route(async (req, res) => {
  const envelope = normalizeSmsEvent(req.body || {});
  const result = await processInboundConversation(envelope);
  const item = await upsertReviewItem(
    buildReviewItem({
      source: "zingle",
      envelope,
      normalized: req.body || {},
      result,
      receivedAt: req.body.created_at || new Date().toISOString()
    })
  );
  res.status(201).json(item);
}));

adminRouter.get("/api/review/config", (_req, res) => {
  res.json({
    app_env: config.appEnv,
    auto_send_enabled: false,
    mailbox: config.email.mailbox,
    zingle_service_id: config.zingle.serviceId
  });
});
