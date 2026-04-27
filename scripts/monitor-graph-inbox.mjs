#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { listGraphMessages, normalizeGraphMessage } from "../src/services/graph.js";
import { normalizeEmailEvent, processInboundConversation } from "../src/orchestrator.js";

const args = parseArgs(process.argv.slice(2));
const statePath = path.resolve(args.state || ".runtime/graph-inbox-monitor-state.json");
const outputDir = path.resolve(args.outputDir || ".runtime/inbox-monitor");
const jsonlPath = path.resolve(args.jsonl || path.join(outputDir, "inbox-monitor.jsonl"));
const csvPath = path.resolve(args.csv || path.join(outputDir, "inbox-monitor.csv"));
const logPath = path.resolve(args.log || path.join(outputDir, "monitor.log"));
const folder = args.folder || "inbox";
const top = Number(args.top || 100);
const maxPages = Number(args.maxPages || 3);
const overlapMinutes = Number(args.overlapMinutes || 15);
const intervalSeconds = Number(args.intervalSeconds || 300);
const pollForever = args.once !== "true";
const maxCycles = Number(args.maxCycles || 0);

await fs.mkdir(path.dirname(statePath), { recursive: true });
await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
await fs.mkdir(path.dirname(csvPath), { recursive: true });
await fs.mkdir(path.dirname(logPath), { recursive: true });

let cycle = 0;
do {
  cycle += 1;
  const state = await readJson(statePath, {
    processed_message_ids: [],
    last_processed_received_at: "",
    total_processed: 0,
    last_run_started_at: "",
    last_run_finished_at: ""
  });

  state.last_run_started_at = new Date().toISOString();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const since = computeSince(state.last_processed_received_at, overlapMinutes);
  const messages = await listGraphMessages({ folder, top, maxPages, since });
  const processedIds = new Set(state.processed_message_ids || []);
  const normalizedMessages = messages
    .map(normalizeGraphMessage)
    .filter((message) => message?.email?.id)
    .sort((a, b) => Date.parse(a.email.received_at || 0) - Date.parse(b.email.received_at || 0));

  const newRows = [];
  let newestReceivedAt = state.last_processed_received_at || "";
  let skipped = 0;

  for (const normalized of normalizedMessages) {
    const messageId = normalized.email.id;
    const receivedAt = normalized.email.received_at || "";
    if (processedIds.has(messageId)) {
      continue;
    }

    const envelope = normalizeEmailEvent(normalized);
    if (!envelope.messageText || !envelope.messageText.trim()) {
      skipped += 1;
      processedIds.add(messageId);
      continue;
    }

    const result = await processInboundConversation(envelope);
    const row = {
      processed_at: new Date().toISOString(),
      mailbox: process.env.EMAIL_MAILBOX || "",
      folder,
      received_at: receivedAt,
      message_id: messageId,
      thread_id: normalized.thread_id,
      inbound_sender: normalized.contact.email,
      inbound_subject: normalized.email.subject,
      decision_intent: result.decision.intent,
      decision_category: result.decision.category,
      handling_mode: result.decision.handling_mode,
      urgency: result.decision.urgency,
      confidence: result.decision.confidence,
      escalate: result.decision.escalate,
      auto_send_eligible: result.decision.auto_send_eligible,
      suggestion_subject: result.suggestion.subject || "",
      suggestion_body: result.suggestion.body || (result.suggestion.segments || []).join(" "),
      provider: result.suggestion.provider,
      generator_error: result.diagnostics.generator_error || "",
      guardrail_issues: (result.diagnostics.guardrail_issues || []).join("; "),
      inbound_body: envelope.messageText
    };

    newRows.push(row);
    processedIds.add(messageId);
    if (!newestReceivedAt || Date.parse(receivedAt) > Date.parse(newestReceivedAt)) {
      newestReceivedAt = receivedAt;
    }
  }

  if (newRows.length) {
    await appendJsonl(jsonlPath, newRows);
    await appendCsv(csvPath, newRows);
  }

  state.processed_message_ids = Array.from(processedIds).slice(-5000);
  state.last_processed_received_at = newestReceivedAt;
  state.total_processed = Number(state.total_processed || 0) + newRows.length;
  state.last_cycle = {
    cycle,
    since,
    fetched_messages: normalizedMessages.length,
    processed_messages: newRows.length,
    skipped_empty_messages: skipped
  };
  state.last_run_finished_at = new Date().toISOString();
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  await appendLog(
    logPath,
    `[${state.last_run_finished_at}] cycle=${cycle} fetched=${normalizedMessages.length} processed=${newRows.length} skipped=${skipped} since=${since}`
  );

  if (!pollForever) {
    break;
  }

  if (maxCycles > 0 && cycle >= maxCycles) {
    break;
  }

  await sleep(intervalSeconds * 1000);
} while (true);

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    index += 1;
  }
  return out;
}

function computeSince(lastProcessedReceivedAt, overlapMinutes) {
  if (!lastProcessedReceivedAt) {
    return new Date(Date.now() - 60 * 60 * 1000).toISOString();
  }
  return new Date(Date.parse(lastProcessedReceivedAt) - overlapMinutes * 60 * 1000).toISOString();
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function appendJsonl(filePath, rows) {
  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.appendFile(filePath, `${lines}\n`, "utf8");
}

async function appendCsv(filePath, rows) {
  if (!rows.length) {
    return;
  }

  const headers = Object.keys(rows[0]);
  let prefix = "";
  try {
    await fs.access(filePath);
  } catch {
    prefix = `${headers.join(",")}\n`;
  }

  const body = rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(",")).join("\n");
  await fs.appendFile(filePath, `${prefix}${body}\n`, "utf8");
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

async function appendLog(filePath, line) {
  await fs.appendFile(filePath, `${line}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
