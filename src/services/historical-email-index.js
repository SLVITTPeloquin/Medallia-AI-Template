import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { buildReviewItem, listReviewItems, upsertReviewItem } from "./review-store.js";
import { getSyncState, updateSyncState } from "./sync-state.js";

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function parseNumber(value, fallback = 0.5) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeGuardrailIssues(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (!value) {
    return [];
  }
  return String(value)
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function latestBackfillJsonlPath() {
  const dir = path.join(config.runtimeDir, "backfill");
  let entries = [];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const candidates = entries
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => ({
      name,
      fullPath: path.join(dir, name)
    }));

  if (!candidates.length) {
    return null;
  }

  const stats = await Promise.all(
    candidates.map(async (file) => ({
      ...file,
      mtimeMs: (await fs.stat(file.fullPath)).mtimeMs
    }))
  );

  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0].fullPath;
}

function buildImportedResult(row) {
  return {
    decision: {
      category: row.decision_category || "other",
      intent: row.decision_intent || "general_request",
      handling_mode: row.handling_mode || "human_triage",
      confidence: parseNumber(row.confidence, 0.5),
      urgency: row.urgency || "normal",
      escalate: parseBoolean(row.escalate, false),
      auto_send_eligible: parseBoolean(row.auto_send_eligible, false)
    },
    suggestion: {
      provider: row.provider || "openai",
      mode: "preview",
      subject: row.suggestion_subject || row.inbound_subject || "",
      body: row.suggestion_body || "",
      action_checklist: []
    },
    diagnostics: {
      guardrail_issues: normalizeGuardrailIssues(row.guardrail_issues),
      generator_error: row.generator_error || ""
    },
    evidence: {
      facts: [],
      playbook: {
        handlingMode: row.handling_mode || "human_triage",
        automationScope: "Imported historical processed item",
        approvedResponsePattern: "Imported from historical backfill",
        instructions: [],
        forbidden: []
      }
    }
  };
}

export async function hydrateHistoricalEmailIndex({ force = false } = {}) {
  const existing = await listReviewItems({ source: "email" });
  if (existing.length > 0 && !force) {
    return { imported: 0, skipped: 0, reason: "already_indexed" };
  }

  const syncState = await getSyncState("email");
  if (syncState.historical_import_completed && !force && existing.length > 0) {
    return { imported: 0, skipped: 0, reason: "import_previously_completed" };
  }

  const jsonlPath = await latestBackfillJsonlPath();
  if (!jsonlPath) {
    return { imported: 0, skipped: 0, reason: "no_backfill_file" };
  }

  const knownMessageIds = new Set(existing.map((item) => item.source_message_id).filter(Boolean));
  const content = await fs.readFile(jsonlPath, "utf8");
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let imported = 0;
  let skipped = 0;

  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }

    const messageId = String(row.message_id || "").trim();
    if (!messageId || knownMessageIds.has(messageId)) {
      skipped += 1;
      continue;
    }

    const envelope = {
      channel: "email",
      sourceEventId: messageId,
      threadId: row.thread_id || "",
      contact: {
        id: row.inbound_sender || "",
        name: row.inbound_sender || "",
        email: row.inbound_sender || "",
        phone: ""
      },
      subject: row.inbound_subject || "",
      messageText: row.inbound_body || "",
      recentThreadSummary: "",
      metadata: {
        provider: "microsoft-graph",
        emailId: messageId
      }
    };

    const normalized = {
      email: {
        id: messageId,
        subject: row.inbound_subject || "",
        body: row.inbound_body || "",
        received_at: row.received_at || ""
      }
    };

    const item = buildReviewItem({
      source: "email",
      envelope,
      normalized,
      result: buildImportedResult(row),
      receivedAt: row.received_at || new Date().toISOString()
    });

    await upsertReviewItem(item);
    knownMessageIds.add(messageId);
    imported += 1;
  }

  await updateSyncState("email", {
    historical_import_completed: true,
    historical_imported_count: imported,
    historical_import_skipped_count: skipped,
    historical_import_source: jsonlPath,
    historical_imported_at: new Date().toISOString()
  });

  return { imported, skipped, source: jsonlPath };
}
