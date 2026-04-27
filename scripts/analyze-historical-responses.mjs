#!/usr/bin/env node
import "dotenv/config";
import { analyzeHistoricalResponses } from "../src/services/historical-response-analysis.js";

const args = parseArgs(process.argv.slice(2));

try {
  const result = await analyzeHistoricalResponses({
    since: args.since || "2026-03-01T00:00:00Z",
    until: args.until || "",
    top: Number(args.top || 100),
    maxPages: Number(args.maxPages || 50),
    sampleSize: Number(args.sampleSize || 10),
    generateOnlyForReplied: args.generateOnlyForReplied !== "false",
    classificationBatchSize: Number(args.classificationBatchSize || 20),
    maxSampleResponses: Number(args.maxSampleResponses || 25),
    repliedOnly: args.repliedOnly === "true",
    checkpointPath: args.checkpointPath || "",
    sampleBatchSize: Number(args.sampleBatchSize || 10)
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`[error] ${error.message}`);
  process.exit(1);
}

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
