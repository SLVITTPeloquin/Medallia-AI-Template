import { requiresHumanReviewForHandlingMode } from "./automation-playbook.js";

const SENSITIVE_INTENTS = new Set(["billing_dispute", "complaint"]);

const FORBIDDEN_PROMISE_PATTERNS = [
  /\bfree\b/i,
  /\brefund\b/i,
  /\bcredit\b/i,
  /\bguarantee\b/i
];

export function validateDraft({ intent, urgency, draft, handlingMode }) {
  const issues = [];

  if (!draft || draft.length < 10) {
    issues.push("draft_too_short");
  }

  for (const pattern of FORBIDDEN_PROMISE_PATTERNS) {
    if (pattern.test(draft)) {
      issues.push("unapproved_compensation_or_guarantee");
      break;
    }
  }

  const requiresEscalation =
    urgency === "high" || SENSITIVE_INTENTS.has(intent) || requiresHumanReviewForHandlingMode(handlingMode);

  return {
    issues,
    requiresEscalation,
    isSafe: issues.length === 0
  };
}
