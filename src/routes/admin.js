import express from "express";
import { config } from "../config.js";
import {
  beginGraphAuthCodeLogin,
  completeGraphAuthCodeLogin,
  getGraphAuthStatus,
  isGraphAuthRequiredError,
  listGraphCorrespondenceWithSender,
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
import { hydrateHistoricalEmailIndex } from "../services/historical-email-index.js";

export const adminRouter = express.Router();
const EMAIL_AUTH_COOKIE = "email_auth_persisted";
const QUEUE_HISTORY_WINDOW_DAYS = 30;

function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function hasPersistedEmailAuthCookie(req) {
  const cookieHeader = String(req.headers.cookie || "");
  if (!cookieHeader) {
    return false;
  }
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${EMAIL_AUTH_COOKIE}=`) && part.split("=")[1] === "1");
}

adminRouter.get("/api/review/summary", route(async (_req, res) => {
  res.json(await getReviewSummary());
}));

adminRouter.get("/api/review/items", route(async (req, res) => {
  if (!req.query.source || req.query.source === "email") {
    await hydrateHistoricalEmailIndex();
  }
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
    "draft_options",
    "selected_draft_variant",
    "notes",
    "review_decision",
    "review_justification",
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
  const hydration = await hydrateHistoricalEmailIndex();
  const existingEmailItems = await listReviewItems({ source: "email" });
  const knownSourceMessageIds = new Set(existingEmailItems.map((item) => item.source_message_id).filter(Boolean));
  const syncState = await getSyncState("email");
  const latestKnownReceivedAt = existingEmailItems
    .map((item) => item.received_at || item.created_at)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const queueWindowStart = new Date(Date.now() - QUEUE_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let effectiveSince = req.body.since || "";
  let effectiveUntil = req.body.until || "";
  if (!effectiveSince) {
    if (syncState.last_polled_at) {
      effectiveSince = syncState.last_polled_at;
    } else if (latestKnownReceivedAt) {
      effectiveSince = new Date(Date.parse(latestKnownReceivedAt) - 5 * 60 * 1000).toISOString();
    } else {
      effectiveSince = queueWindowStart;
    }
  }
  if (!effectiveSince || Date.parse(effectiveSince) < Date.parse(queueWindowStart)) {
    effectiveSince = queueWindowStart;
  }

  const requestedTop = Number(req.body.top || config.email.sync.defaultTop);
  const requestedMaxPages = Number(req.body.maxPages || config.email.sync.incrementalMaxPages);

  let messages = [];
  await updateSyncState("email", {
    in_progress: true,
    phase: "fetching",
    progress_total: 0,
    progress_current: 0,
    status_text: "Fetching emails from inbox..."
  });
  try {
    messages = await listGraphMessages({
      folder: "inbox",
      since: effectiveSince,
      until: effectiveUntil,
      top: requestedTop,
      maxPages: requestedMaxPages,
      allowDeviceCode: false
    });
  } catch (error) {
    if (isGraphAuthRequiredError(error)) {
      await updateSyncState("email", {
        in_progress: false,
        phase: "auth_required",
        status_text: "Email sign-in required. Click Email Login."
      });
      return res.status(401).json({
        error: "graph_auth_required",
        message: error.message,
        prompt: error.prompt || null
      });
    }
    await updateSyncState("email", {
      in_progress: false,
      phase: "error",
      status_text: error.message || "Email sync failed"
    });
    throw error;
  }

  await updateSyncState("email", {
    in_progress: true,
    phase: "processing",
    progress_total: messages.length,
    progress_current: 0,
    status_text: `Processing 0/${messages.length} emails...`
  });

  const items = [];
  let skippedAlreadyIndexed = 0;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
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

    if ((index + 1) % 5 === 0 || index === messages.length - 1) {
      await updateSyncState("email", {
        in_progress: true,
        phase: "processing",
        progress_total: messages.length,
        progress_current: index + 1,
        status_text: `Processing ${index + 1}/${messages.length} emails...`
      });
    }
  }

  await updateSyncState("email", {
    in_progress: false,
    phase: "completed",
    last_polled_at: new Date().toISOString(),
    last_effective_since: effectiveSince,
    last_effective_until: effectiveUntil || "",
    full_history_seeded: true,
    full_history_pending_more: false,
    fetched_count: messages.length,
    processed_count: items.length,
    skipped_already_indexed: skippedAlreadyIndexed,
    progress_total: messages.length,
    progress_current: messages.length,
    status_text: `Sync complete. Processed ${items.length} new, skipped ${skippedAlreadyIndexed} already indexed.`
  });

  res.json({
    historical_import: hydration,
    full_history_mode: false,
    full_history_until: effectiveUntil || "",
    processed: items.length,
    fetched: messages.length,
    skipped_already_indexed: skippedAlreadyIndexed,
    since: effectiveSince,
    items
  });
}));

adminRouter.get("/api/review/items/:id/history", route(async (req, res) => {
  const itemId = String(req.params.id || "");
  const all = await listReviewItems();
  const selected = all.find((entry) => entry.id === itemId);
  if (!selected) {
    return res.status(404).json({ error: "not_found" });
  }

  const senderEmail = String(selected.sender_email || "").trim();
  if (!senderEmail) {
    return res.json({ sender_email: "", history: [], truncated: false });
  }

  const perFolderTop = Math.max(10, Math.min(100, Number(req.query.perFolderTop || 50)));
  const perFolderMaxPages = Math.max(1, Math.min(20, Number(req.query.maxPages || 8)));
  const maxResults = Math.max(10, Math.min(300, Number(req.query.limit || 80)));
  const messages = await listGraphCorrespondenceWithSender({
    senderEmail,
    perFolderTop,
    perFolderMaxPages,
    maxResults
  });

  const history = messages.map((message) => {
    const from = message.from?.emailAddress?.address || message.sender?.emailAddress?.address || "";
    const to = (message.toRecipients || []).map((entry) => entry.emailAddress?.address).filter(Boolean);
    return {
      id: message.id || "",
      conversation_id: message.conversationId || "",
      subject: message.subject || "",
      direction: String(from).toLowerCase() === senderEmail.toLowerCase() ? "inbound" : "outbound",
      from,
      to,
      at: message.receivedDateTime || message.sentDateTime || message.createdDateTime || "",
      preview: message.bodyPreview || "",
      body: message.body?.content || ""
    };
  });

  return res.json({
    sender_email: senderEmail,
    history,
    truncated: messages.length >= maxResults
  });
}));

adminRouter.get("/api/review/poll/email/status", route(async (_req, res) => {
  const status = await getSyncState("email");
  res.json(status);
}));

adminRouter.get("/api/review/auth/email/status", route(async (_req, res) => {
  const status = await getGraphAuthStatus();
  const persisted = hasPersistedEmailAuthCookie(_req);
  res.json({ ...status, browser_persisted: persisted });
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
  res.cookie(EMAIL_AUTH_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/"
  });
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
