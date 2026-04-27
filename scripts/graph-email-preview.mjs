#!/usr/bin/env node
import "dotenv/config";
import { listRecentGraphMessages, normalizeGraphMessage } from "../src/services/graph.js";
import { normalizeEmailEvent, processInboundConversation } from "../src/orchestrator.js";

const args = parseArgs(process.argv.slice(2));
const top = Number(args.top || 5);

try {
  const messages = await listRecentGraphMessages({ top });
  const previews = [];
  let skipped = 0;

  for (const message of messages) {
    const normalized = normalizeGraphMessage(message);
    const envelope = normalizeEmailEvent(normalized);
    if (!envelope.messageText || !envelope.messageText.trim()) {
      skipped += 1;
      continue;
    }
    const result = await processInboundConversation(envelope);
    previews.push({
      source: {
        subject: normalized.email.subject,
        sender: normalized.contact.email,
        thread_id: normalized.thread_id
      },
      preview: result.suggestion,
      decision: result.decision
    });
  }

  console.log(
    JSON.stringify(
      {
        mailbox: process.env.EMAIL_MAILBOX || "",
        count: previews.length,
        skipped_empty_messages: skipped,
        previews
      },
      null,
      2
    )
  );
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
