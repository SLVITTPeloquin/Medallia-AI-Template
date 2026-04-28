import express from "express";
import { config } from "../config.js";
import {
  beginGraphAuthCodeLogin,
  completeGraphAuthCodeLogin,
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
import { getSyncState, updateSyncState } from "../services/sync-state.js";

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
  const existingEmailItems = await listReviewItems({ source: "email" });
  const knownSourceMessageIds = new Set(existingEmailItems.map((item) => item.source_message_id).filter(Boolean));
  const syncState = await getSyncState("email");
  const latestKnownReceivedAt = existingEmailItems
    .map((item) => item.received_at || item.created_at)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  let effectiveSince = req.body.since || "";
  if (!effectiveSince) {
    if (syncState.last_polled_at) {
      effectiveSince = syncState.last_polled_at;
    } else if (latestKnownReceivedAt) {
      effectiveSince = new Date(Date.parse(latestKnownReceivedAt) - 5 * 60 * 1000).toISOString();
    } else {
      effectiveSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  }

  let messages = [];
  try {
    messages = await listGraphMessages({
      folder: "inbox",
      since: effectiveSince,
      until: req.body.until || "",
      top: Number(req.body.top || 50),
      maxPages: Number(req.body.maxPages || 12),
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
  let skippedAlreadyIndexed = 0;
  for (const message of messages) {
    const normalized = normalizeGraphMessage(message);
    const sourceMessageId = normalized?.email?.id || message.id || "";
    if (sourceMessageId && knownSourceMessageIds.has(sourceMessageId)) {
      skippedAlreadyIndexed += 1;
      continue;
    }

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
    const saved = await upsertReviewItem(item);
    if (saved.source_message_id) {
      knownSourceMessageIds.add(saved.source_message_id);
    }
    items.push(saved);
  }

  await updateSyncState("email", {
    last_polled_at: new Date().toISOString(),
    last_effective_since: effectiveSince,
    fetched_count: messages.length,
    processed_count: items.length,
    skipped_already_indexed: skippedAlreadyIndexed
  });

  res.json({
    processed: items.length,
    fetched: messages.length,
    skipped_already_indexed: skippedAlreadyIndexed,
    since: effectiveSince,
    items
  });
}));

adminRouter.get("/api/review/auth/email/status", route(async (_req, res) => {
  const status = await getGraphAuthStatus();
  res.json(status);
}));

adminRouter.get("/api/review/auth/email/start", route(async (_req, res) => {
  const status = await beginGraphAuthCodeLogin();
  if (status.status === "authenticated") {
    return res.redirect("/admin/?auth=ok");
  }
  if (status.url) {
    return res.redirect(status.url);
  }
  return res.status(500).json({ error: "auth_start_failed" });
}));

adminRouter.get("/api/review/auth/email/callback", route(async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const authError = String(req.query.error || "");
  const authErrorDescription = String(req.query.error_description || "");

  if (authError) {
    const message = authErrorDescription || authError;
    const html = `<!doctype html><html><body><script>window.opener&&window.opener.postMessage({type:'graph_auth_result',status:'error',message:${JSON.stringify(
      message
    )}},'*');window.close();</script>Sign-in failed. You can close this window.</body></html>`;
    return res.status(400).send(html);
  }

  await completeGraphAuthCodeLogin({ code, state });
  const html = `<!doctype html><html><body><script>window.opener&&window.opener.postMessage({type:'graph_auth_result',status:'ok'},'*');window.close();</script>Sign-in complete. You can close this window.</body></html>`;
  return res.send(html);
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
