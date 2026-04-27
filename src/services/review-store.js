import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const STORE_PATH = path.join(config.runtimeDir, "review-items.json");
const NOTES_LOG_PATH = path.join(config.runtimeDir, "review-notes.jsonl");

function stableId(...parts) {
  return crypto.createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 24);
}

function priorityFor(result) {
  if (result.decision.urgency === "high" || result.decision.escalate || result.decision.confidence < 0.6) {
    return "high";
  }
  if (result.decision.confidence < 0.8 || result.decision.handling_mode.includes("review")) {
    return "medium";
  }
  return "low";
}

function buildMarkers(result) {
  const markers = [];
  if (result.decision.escalate) {
    markers.push("Human review required before sending.");
  }
  if (result.decision.confidence < 0.6) {
    markers.push("Low confidence: verify category, facts, and wording.");
  }
  if (result.decision.handling_mode.includes("review")) {
    markers.push("Review category guidance before approving.");
  }
  for (const issue of result.diagnostics.guardrail_issues || []) {
    markers.push(`Guardrail: ${issue.replace(/_/g, " ")}`);
  }
  if (!markers.length) {
    markers.push("Review for tone and property-specific details.");
  }
  return markers;
}

function buildActionChecklist(result) {
  const suggested = result?.suggestion?.action_checklist;
  if (Array.isArray(suggested) && suggested.length) {
    const normalized = suggested
      .map((item, index) => {
        const label = String(item?.label || "").trim();
        if (!label) {
          return null;
        }
        return {
          id:
            String(item?.id || "")
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "") || `task_${index + 1}`,
          label,
          required: item?.required !== false,
          done: false
        };
      })
      .filter(Boolean)
      .slice(0, 6);
    if (normalized.length) {
      return normalized;
    }
  }

  const list = [
    { id: "confirm_context", label: "Confirm sender context and request details", required: true, done: false },
    { id: "review_tone", label: "Review tone and human touch edits", required: true, done: false },
    { id: "verify_facts", label: "Verify property facts and policy statements", required: true, done: false }
  ];

  if (result.decision.escalate || result.decision.handling_mode.includes("review")) {
    list.push({
      id: "manager_or_specialist",
      label: "Confirm specialist/manager review when required",
      required: true,
      done: false
    });
  }

  if ((result.diagnostics.guardrail_issues || []).length) {
    list.push({
      id: "resolve_guardrails",
      label: "Resolve guardrail flags in the draft",
      required: true,
      done: false
    });
  }

  return list;
}

function computeCanSend(item) {
  const checklist = Array.isArray(item.action_checklist) ? item.action_checklist : [];
  const requiredDone = checklist.filter((task) => task.required).every((task) => task.done);
  const categoryApproved = item.category_review === "yes";
  const hasDraft = Boolean((item.draft_body || "").trim());
  return requiredDone && categoryApproved && hasDraft && item.status !== "sent";
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function writeStore(items) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify({ items }, null, 2), "utf8");
}

async function appendNoteLog(entry) {
  await fs.mkdir(path.dirname(NOTES_LOG_PATH), { recursive: true });
  await fs.appendFile(NOTES_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

function normalizeStoredItem(item) {
  const normalized = {
    ...item,
    action_checklist: Array.isArray(item.action_checklist)
      ? item.action_checklist
      : [
          { id: "confirm_context", label: "Confirm sender context and request details", required: true, done: false },
          { id: "review_tone", label: "Review tone and human touch edits", required: true, done: false },
          { id: "verify_facts", label: "Verify property facts and policy statements", required: true, done: false }
        ],
    category_review: item.category_review || "pending",
    category_review_notes: item.category_review_notes || ""
  };
  normalized.can_send = computeCanSend(normalized);
  return normalized;
}

export function buildReviewItem({ source, envelope, normalized, result, receivedAt }) {
  const draftBody = result.suggestion.body || (result.suggestion.segments || []).join("\n\n");
  const sourceMessageId =
    normalized?.email?.id || normalized?.message?.id || envelope.metadata?.emailId || envelope.metadata?.messageId || envelope.sourceEventId;
  const id = stableId(source, sourceMessageId, envelope.threadId, envelope.messageText.slice(0, 120));

  const item = {
    id,
    source,
    channel: envelope.channel,
    status: "new",
    priority: priorityFor(result),
    received_at: receivedAt || new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_message_id: sourceMessageId || "",
    thread_id: envelope.threadId || "",
    sender_name: envelope.contact.name || "",
    sender_email: envelope.contact.email || "",
    sender_phone: envelope.contact.phone || "",
    subject: envelope.subject || "",
    inbound_body: envelope.messageText,
    category: result.decision.category,
    intent: result.decision.intent,
    handling_mode: result.decision.handling_mode,
    confidence: result.decision.confidence,
    urgency: result.decision.urgency,
    escalate: result.decision.escalate,
    auto_send_eligible: result.decision.auto_send_eligible,
    draft_subject: result.suggestion.subject || "",
    draft_body: draftBody,
    original_draft_body: draftBody,
    provider: result.suggestion.provider,
    review_markers: buildMarkers(result),
    action_checklist: buildActionChecklist(result),
    category_review: "pending",
    category_review_notes: "",
    guardrail_issues: result.diagnostics.guardrail_issues || [],
    generator_error: result.diagnostics.generator_error || "",
    notes: "",
    evidence: result.evidence || {}
  };
  item.can_send = computeCanSend(item);
  return item;
}

export async function upsertReviewItem(item) {
  const items = (await readStore()).map(normalizeStoredItem);
  const index = items.findIndex((existing) => existing.id === item.id);
  if (index >= 0) {
    items[index] = {
      ...items[index],
      ...item,
      status: items[index].status === "sent" ? "sent" : item.status,
      notes: items[index].notes || item.notes || "",
      updated_at: new Date().toISOString()
    };
    items[index].can_send = computeCanSend(items[index]);
  } else {
    items.unshift({ ...item, can_send: computeCanSend(item) });
  }
  await writeStore(items);
  return index >= 0 ? items[index] : items[0];
}

export async function listReviewItems({ status, source } = {}) {
  const items = (await readStore()).map(normalizeStoredItem);
  return items
    .filter((item) => !status || item.status === status)
    .filter((item) => !source || item.source === source)
    .sort((a, b) => Date.parse(b.received_at || b.created_at) - Date.parse(a.received_at || a.created_at));
}

export async function updateReviewItem(id, patch) {
  const items = (await readStore()).map(normalizeStoredItem);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  const before = items[index];
  items[index] = {
    ...items[index],
    ...patch,
    updated_at: new Date().toISOString()
  };
  items[index].can_send = computeCanSend(items[index]);
  await writeStore(items);
  if (
    patch.notes !== undefined ||
    patch.category_review !== undefined ||
    patch.category_review_notes !== undefined ||
    patch.action_checklist !== undefined
  ) {
    await appendNoteLog({
      item_id: id,
      at: new Date().toISOString(),
      status: items[index].status,
      notes: patch.notes ?? before.notes ?? "",
      category_review: patch.category_review ?? before.category_review ?? "pending",
      category_review_notes: patch.category_review_notes ?? before.category_review_notes ?? "",
      action_checklist: patch.action_checklist ?? before.action_checklist ?? []
    });
  }
  return items[index];
}

export async function markReviewItemSent(id) {
  const item = await updateReviewItem(id, {});
  if (!item) {
    return { item: null, reason: "not_found" };
  }
  if (!item.can_send) {
    return { item, reason: "checklist_incomplete" };
  }
  const updated = await updateReviewItem(id, { status: "sent", sent_at: new Date().toISOString() });
  return { item: updated, reason: null };
}

export async function getReviewSummary() {
  const items = await readStore();
  const summary = {
    total: items.length,
    new: 0,
    in_review: 0,
    ready: 0,
    sent: 0,
    high_priority: 0,
    email: 0,
    zingle: 0
  };
  for (const item of items) {
    if (summary[item.status] !== undefined) {
      summary[item.status] += 1;
    }
    if (item.priority === "high") {
      summary.high_priority += 1;
    }
    if (summary[item.source] !== undefined) {
      summary[item.source] += 1;
    }
  }
  return summary;
}
