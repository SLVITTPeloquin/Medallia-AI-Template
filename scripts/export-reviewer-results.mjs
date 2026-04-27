#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input || "/tmp/medallia-analysis/history_mar2026_full_v2.json";
const outputPath = args.output || path.resolve("docs/MARCH_2026_REVIEWER_RESULTS.csv");

const raw = await fs.readFile(inputPath, "utf8");
const jsonStart = raw.indexOf("{");
if (jsonStart < 0) {
  throw new Error(`Could not locate JSON payload in ${inputPath}`);
}

const data = JSON.parse(raw.slice(jsonStart));
const rows = (data.analyzed_pairs || []).map((pair) => ({
  conversation_id: pair.conversation_id,
  received_at: pair.inbound?.received_at || "",
  inbound_sender: pair.inbound?.sender || "",
  inbound_subject: pair.inbound?.subject || "",
  base_category: pair.analysis?.base_inbound_category || pair.analysis?.inbound_category || "other",
  refined_category: pair.analysis?.inbound_category || "other",
  handling_mode: pair.playbook?.handlingMode || "",
  automation_candidate: pair.analysis?.automation_candidate || "",
  response_style: pair.analysis?.response_style || "",
  has_actual_response: pair.actual_response ? "yes" : "no",
  actual_response_sender: pair.actual_response?.sender || "",
  actual_response_sent_at: pair.actual_response?.sent_at || "",
  actual_response_usable_for_examples:
    pair.actual_response?.usable_for_examples === undefined
      ? ""
      : pair.actual_response.usable_for_examples
        ? "yes"
        : "no",
  approved_response_pattern: pair.playbook?.approvedResponsePattern || "",
  inbound_summary: pair.analysis?.inbound_summary || "",
  response_summary: pair.analysis?.response_summary || "",
  reason: pair.analysis?.reason || "",
  inbound_body: pair.inbound?.body || "",
  actual_response_body: pair.actual_response?.body || "",
  sample_response: pair.sample_response || ""
}));

const csv = toCsv(rows);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, csv, "utf8");
console.log(outputPath);

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
