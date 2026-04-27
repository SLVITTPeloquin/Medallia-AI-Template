#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { getCategoryPlaybook } from "../src/services/automation-playbook.js";

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input || "/tmp/medallia-analysis/history_mar2026_full.json";
const outputPath = args.output || path.resolve("docs/MARCH_2026_AUTOMATION_MATRIX.csv");

const raw = await fs.readFile(inputPath, "utf8");
const jsonStart = raw.indexOf("{");
if (jsonStart < 0) {
  throw new Error(`Could not locate JSON payload in ${inputPath}`);
}

const data = JSON.parse(raw.slice(jsonStart));
const stats = new Map();

for (const pair of data.analyzed_pairs || []) {
  const category = pair.analysis?.inbound_category || "other";
  if (!stats.has(category)) {
    stats.set(category, {
      category,
      march_volume: 0,
      matched_human_responses: 0,
      high_automation_count: 0,
      medium_automation_count: 0,
      low_automation_count: 0
    });
  }

  const current = stats.get(category);
  current.march_volume += 1;
  if (pair.actual_response) {
    current.matched_human_responses += 1;
  }
  const automation = pair.analysis?.automation_candidate || "medium";
  const key = `${automation}_automation_count`;
  if (key in current) {
    current[key] += 1;
  }
}

const rows = [...stats.values()]
  .sort((a, b) => b.march_volume - a.march_volume)
  .map((row) => {
    const playbook = getCategoryPlaybook(row.category);

    return {
      category: row.category,
      march_volume: row.march_volume,
      matched_human_responses: row.matched_human_responses,
      match_rate: formatRate(row.matched_human_responses, row.march_volume),
      high_automation_count: row.high_automation_count,
      medium_automation_count: row.medium_automation_count,
      low_automation_count: row.low_automation_count,
      recommended_handling: playbook.handlingMode,
      automation_scope: playbook.automationScope,
      approved_ai_response_pattern: playbook.approvedResponsePattern
    };
  });

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

function formatRate(numerator, denominator) {
  if (!denominator) {
    return "0.00";
  }
  return (numerator / denominator).toFixed(2);
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
