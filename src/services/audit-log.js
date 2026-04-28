import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

const AUDIT_LOG_PATH = path.join(config.runtimeDir, "outlook-addin-audit.jsonl");

function clampString(value, max = 8000) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
}

function sanitizePayload(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => sanitizePayload(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (/token|secret|password|authorization/i.test(key)) {
          return [key, "[redacted]"];
        }
        return [key, sanitizePayload(entry)];
      })
    );
  }
  if (typeof value === "string") {
    return clampString(value);
  }
  return value;
}

export async function appendAuditEvent({ eventType, actor = {}, source = "outlook-addin", payload = {}, req = null } = {}) {
  const event = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    event_type: eventType || "unknown",
    source,
    actor: sanitizePayload(actor),
    payload: sanitizePayload(payload),
    request: req
      ? {
          ip: req.ip || "",
          user_agent: req.get("user-agent") || ""
        }
      : {}
  };

  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}
