import { isAutoEligibleHandlingMode, requiresHumanReviewForHandlingMode } from "./automation-playbook.js";

const INTENT_WEIGHTS = {
  housekeeping: 0.1,
  maintenance: 0.08,
  amenity_hours: 0.08,
  billing_documents: 0.09,
  billing_dispute: -0.08,
  complaint: -0.1,
  general_request: 0
};

const CATEGORY_WEIGHTS = {
  billing_and_receipts: -0.03,
  reservation_inquiries: 0.02,
  transportation_and_facilities: 0.04,
  group_sales_or_travel_trade: -0.06,
  collaboration_and_partnerships: -0.06,
  marketing_and_media: -0.06,
  service_complaints: -0.08
};

const LOW_RISK_INTENTS = new Set(["housekeeping", "maintenance", "amenity_hours", "billing_documents", "general_request"]);

export function scoreConfidence({ intent, urgency, factCount, guardrailIssues, handlingMode, messageText = "", category = "" }) {
  let score = 0.62;

  score += INTENT_WEIGHTS[intent] || 0;
  score += CATEGORY_WEIGHTS[category] || 0;
  score += Math.min(0.16, Number(factCount || 0) * 0.04);
  score -= Math.min(0.36, (guardrailIssues || []).length * 0.12);
  if (requiresHumanReviewForHandlingMode(handlingMode)) {
    score -= 0.1;
  }
  if (urgency === "high") {
    score -= 0.16;
  }

  const text = `${messageText}`.toLowerCase();
  if (/(refund|chargeback|fraud|lawsuit|attorney|urgent)/i.test(text)) {
    score -= 0.08;
  }
  if (text.length < 60) {
    score -= 0.03;
  } else if (text.length > 1200) {
    score -= 0.04;
  }
  if (text) {
    let checksum = 0;
    for (let index = 0; index < text.length; index += 37) {
      checksum = (checksum + text.charCodeAt(index) * (index + 1)) % 997;
    }
    const deterministicOffset = (checksum / 997 - 0.5) * 0.1;
    score += deterministicOffset;
  }

  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export function canAutoSend({ appEnv, allowProdAutosend, intent, confidence, requiresEscalation, handlingMode }) {
  if (appEnv !== "production") {
    return false;
  }
  if (!allowProdAutosend) {
    return false;
  }
  if (requiresEscalation) {
    return false;
  }
  return LOW_RISK_INTENTS.has(intent) && isAutoEligibleHandlingMode(handlingMode) && confidence >= 0.85;
}
