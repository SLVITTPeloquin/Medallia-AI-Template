const INTENT_RULES = [
  { intent: "housekeeping", patterns: ["towel", "linens", "housekeeping", "clean", "blanket", "pillow"] },
  { intent: "maintenance", patterns: ["ac", "air", "broken", "leak", "toilet", "light", "tv", "maintenance"] },
  { intent: "amenity_hours", patterns: ["pool", "gym", "spa", "restaurant", "hours", "open", "close"] },
  { intent: "late_checkout", patterns: ["late checkout", "check out late", "checkout"] },
  { intent: "parking_fees", patterns: ["parking", "fee", "resort fee", "charge"] },
  { intent: "billing_documents", patterns: ["receipt", "invoice", "folio", "statement"] },
  { intent: "billing_dispute", patterns: ["bill", "billing", "charged", "refund", "credit", "duplicate charge", "unauthorized charge"] },
  { intent: "complaint", patterns: ["unhappy", "disappointed", "complaint", "upset", "bad service"] }
];

const URGENT_PATTERNS = [
  "emergency",
  "urgent",
  "unsafe",
  "hurt",
  "injury",
  "fire",
  "smoke",
  "lockout",
  "stuck",
  "flood"
];

function escapeRegex(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesPattern(text = "", pattern = "") {
  const escaped = escapeRegex(pattern).replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

export function classifyIntent(messageText = "") {
  const text = messageText.toLowerCase();
  for (const rule of INTENT_RULES) {
    if (rule.patterns.some((pattern) => matchesPattern(text, pattern))) {
      return rule.intent;
    }
  }
  return "general_request";
}

export function detectUrgency(messageText = "") {
  const text = messageText.toLowerCase();
  return URGENT_PATTERNS.some((pattern) => matchesPattern(text, pattern)) ? "high" : "normal";
}
