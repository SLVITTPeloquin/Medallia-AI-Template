#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { listGraphMessages, normalizeGraphMessage } from "../src/services/graph.js";
import { normalizeEmailEvent, processInboundConversation } from "../src/orchestrator.js";

const args = parseArgs(process.argv.slice(2));
const top = Number(args.top || 50);
const maxPages = Number(args.maxPages || 1);
const since = args.since || "";
const until = args.until || "";
const format = (args.format || "json").toLowerCase();
const outputPath = args.output ? path.resolve(args.output) : "";

try {
  const messages = await listGraphMessages({
    folder: "inbox",
    top,
    maxPages,
    since,
    until
  });

  const processed = [];
  let skipped = 0;

  for (const message of messages) {
    const normalized = normalizeGraphMessage(message);
    const envelope = normalizeEmailEvent(normalized);
    if (!envelope.messageText || !envelope.messageText.trim()) {
      skipped += 1;
      continue;
    }

    const result = await processInboundConversation(envelope);
    processed.push({
      received_at: message.receivedDateTime || "",
      message_id: normalized.email.id,
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
    });
  }

  const payload =
    format === "csv"
      ? toCsv(processed)
      : JSON.stringify(
          {
            mailbox: process.env.EMAIL_MAILBOX || "",
            since,
            until,
            count: processed.length,
            skipped_empty_messages: skipped,
            items: processed
          },
          null,
          2
        );

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, payload, "utf8");
    console.log(outputPath);
  } else {
    console.log(payload);
  }
} catch (error) {
  console.error(`[error] ${error.message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) {
      continue;
    }
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function escapeCsv(value) {
  const stringValue = String(value ?? "");
  if (!/[",\n]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  if (!rows.length) {
    return "";
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCsv(row[header])).join(","))
  ];
  return `${lines.join("\n")}\n`;
}
