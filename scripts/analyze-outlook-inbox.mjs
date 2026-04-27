#!/usr/bin/env node
import "dotenv/config";
import { analyzeMailbox, formatMailboxAnalysis } from "../src/services/mailbox-analysis.js";

const args = parseArgs(process.argv.slice(2));

const options = {
  inboxTop: Number(args.inboxTop || args.top || 100),
  sentTop: Number(args.sentTop || args.top || 100),
  maxPages: Number(args.maxPages || 2),
  days: Number(args.days || 14),
  sampleSize: Number(args.sampleSize || 8)
};
const format = args.format || "markdown";

try {
  const result = await analyzeMailbox(options);
  console.log(formatMailboxAnalysis(result, format));
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
