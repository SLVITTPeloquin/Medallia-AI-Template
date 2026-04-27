const CATEGORY_PLAYBOOK = {
  billing_documents: {
    handlingMode: "automate",
    automationScope: "Safe to automate for receipt, folio, invoice, and statement requests after verifying stay details.",
    approvedResponsePattern:
      "Thank the sender, confirm the requested billing document will be retrieved, ask for missing stay details if needed, and give a conservative follow-up window.",
    instructions: [
      "Use a calm and operational tone.",
      "Confirm the document request is being processed.",
      "Ask for confirmation number, stay dates, or guest name if needed."
    ],
    forbidden: [
      "Do not mention refunds or adjustments unless the guest asked about them.",
      "Do not promise immediate delivery without verification."
    ]
  },
  billing_disputes_refunds: {
    handlingMode: "ai_draft_with_human_review",
    automationScope: "Use AI for acknowledgement and review language only. Billing disputes and refund outcomes require review.",
    approvedResponsePattern:
      "Acknowledge the concern, state the billing team will review the details, and avoid promising a refund, correction, or resolution timeline without verification.",
    instructions: [
      "Use a calm and empathetic tone.",
      "State that the issue is under review.",
      "Keep any timeline conservative."
    ],
    forbidden: [
      "Do not promise refunds, credits, or reversals.",
      "Do not admit billing error or fault without verification."
    ]
  },
  billing_and_receipts: {
    handlingMode: "split_auto_and_human_review",
    automationScope: "Auto for receipt, folio, and invoice requests. Human review for refunds, disputes, and charge complaints.",
    approvedResponsePattern:
      "Acknowledge the request, confirm document retrieval or review, ask for missing stay details if needed, and give a conservative follow-up window. Do not promise refunds or billing outcomes.",
    instructions: [
      "Use a calm, operational tone.",
      "If the request is for a document, confirm it will be sent or reviewed shortly.",
      "If stay details are missing, ask for confirmation number, stay dates, or guest name.",
      "If the message describes a dispute, say the billing team will review and follow up."
    ],
    forbidden: [
      "Do not promise a refund or adjustment without verification.",
      "Do not admit fault for billing discrepancies.",
      "Do not quote timelines beyond a conservative review window."
    ]
  },
  reservation_inquiries: {
    handlingMode: "ai_draft_with_light_review",
    automationScope: "Suitable for FAQ-style booking questions and policy explanations. Review required for inventory, upgrades, or exceptions.",
    approvedResponsePattern:
      "Answer the policy or booking question directly, use subject-to-availability language where needed, and give a clear next step without guaranteeing special requests.",
    instructions: [
      "Be warm and guest-facing.",
      "Use 'subject to availability' for room placement, upgrades, and similar requests.",
      "Point the guest to reservations or front desk when inventory decisions are required.",
      "Keep the reply concise and actionable."
    ],
    forbidden: [
      "Do not guarantee upgrades, adjoining rooms, or special inventory outcomes.",
      "Do not invent event schedules or availability details."
    ]
  },
  reservation_faq_policy: {
    handlingMode: "automate_for_stable_facts",
    automationScope: "Safe to automate for reservation FAQs and policy explanations when property facts are stable and known.",
    approvedResponsePattern:
      "Answer the guest's policy or informational question directly, use current property facts only, and invite follow-up if the guest needs more detail.",
    instructions: [
      "Use concise, direct language.",
      "Focus on policy or informational questions rather than exceptions.",
      "If the fact may vary, use cautious wording."
    ],
    forbidden: [
      "Do not invent dates, event schedules, or access rules.",
      "Do not guarantee policy exceptions."
    ]
  },
  reservation_changes_or_exceptions: {
    handlingMode: "ai_draft_with_light_review",
    automationScope: "Good for guest-facing drafting on reservation changes, room requests, and exceptions. Review is recommended before send.",
    approvedResponsePattern:
      "Acknowledge the request, explain any availability or policy limits, use subject-to-availability language, and give the next step without guaranteeing special requests.",
    instructions: [
      "Use warm guest-service tone.",
      "Use subject-to-availability language for room requests and changes.",
      "Set the correct next step for reservations or front desk follow-up."
    ],
    forbidden: [
      "Do not guarantee upgrades, adjoining rooms, or exceptions.",
      "Do not confirm inventory or special accommodation without verification."
    ]
  },
  group_sales_or_travel_trade: {
    handlingMode: "ai_draft_with_human_review",
    automationScope:
      "Use AI for acknowledgement and factual policy clarification only. Quotes, inventory, commission, and group terms require sales or reservations review.",
    approvedResponsePattern:
      "Acknowledge the group or travel-trade request, state that the team will review availability and commercial terms, and avoid quoting rates, commissions, or package terms without verification.",
    instructions: [
      "Use professional B2B language.",
      "Allow factual policy clarification only when the property fact is stable and known.",
      "Route rate, commission, contract, and inventory decisions to the appropriate team."
    ],
    forbidden: [
      "Do not quote group rates, commissions, or contract terms without review.",
      "Do not promise room blocks, breakfast inclusion, or payment arrangements without verification."
    ]
  },
  sales_outreach: {
    handlingMode: "human_triage",
    automationScope: "Suitable for auto-filtering, tagging, or controlled acknowledgement. Commercial evaluation remains manual.",
    approvedResponsePattern:
      "Thank the sender briefly, acknowledge receipt, and state the appropriate team will review if relevant.",
    instructions: [
      "Keep the reply short and neutral.",
      "Use routing language rather than acceptance language."
    ],
    forbidden: [
      "Do not imply interest, urgency, or fit.",
      "Do not commit to meetings or commercial next steps."
    ]
  },
  collaboration_and_partnerships: {
    handlingMode: "human_only_or_controlled_acknowledgement",
    automationScope: "Auto-acknowledge or route only. Business evaluation stays human-led.",
    approvedResponsePattern:
      "Thank the sender for the outreach, state the proposal will be reviewed by the appropriate team, and avoid any commitment to partner, sponsor, or meet.",
    instructions: [
      "Keep the tone polite and neutral.",
      "Use review or routing language rather than acceptance language.",
      "Keep the response short."
    ],
    forbidden: [
      "Do not commit to meetings, campaigns, sponsorships, or follow-up dates.",
      "Do not express strategic interest beyond acknowledging receipt."
    ]
  },
  transportation_and_facilities: {
    handlingMode: "automate_for_stable_facts",
    automationScope: "Auto for parking, shuttle, spa, cabana, and amenity basics when facts are known. Human review for event-specific access rules.",
    approvedResponsePattern:
      "Provide the known facility or amenity answer directly. If event-specific rules may vary, state that the team will confirm current details.",
    instructions: [
      "Use direct answers for stable property facts.",
      "If the answer depends on a live event or current schedule, use cautious wording.",
      "Offer the correct contact or next step when booking is required."
    ],
    forbidden: [
      "Do not state event access rules unless they are confirmed.",
      "Do not guarantee availability for facility reservations."
    ]
  },
  marketing_and_media: {
    handlingMode: "human_only_or_acknowledgement",
    automationScope: "Auto-acknowledge only. Marketing decisions remain human-led.",
    approvedResponsePattern:
      "Thank the sender for the proposal and state it will be reviewed by the marketing or communications team if relevant.",
    instructions: [
      "Be brief and professional.",
      "Use neutral review language."
    ],
    forbidden: [
      "Do not commit to demos, coverage, influencer stays, or campaigns.",
      "Do not imply approval or priority review."
    ]
  },
  event_and_meeting_requests: {
    handlingMode: "ai_draft_with_human_review",
    automationScope: "Good for initial intake and clarification. Pricing, contract terms, and custom commitments require human review.",
    approvedResponsePattern:
      "Acknowledge the request, gather missing details, and explain that the events or group team will confirm availability, rates, and logistics.",
    instructions: [
      "Ask for missing date, guest count, or event scope if needed.",
      "Use follow-up language for rates and custom requests.",
      "Keep promises limited to review and follow-up."
    ],
    forbidden: [
      "Do not quote custom rates or group terms without review.",
      "Do not confirm event availability autonomously."
    ]
  },
  service_complaints: {
    handlingMode: "ai_draft_with_human_review",
    automationScope: "Use AI for empathetic acknowledgement and escalation language. Human review should approve any service recovery response.",
    approvedResponsePattern:
      "Acknowledge the concern, apologize for the experience, and explain that the appropriate guest services or leadership team will review and follow up.",
    instructions: [
      "Use empathetic service-recovery tone.",
      "Acknowledge the issue without admitting liability.",
      "Promise review and follow-up rather than compensation."
    ],
    forbidden: [
      "Do not promise refunds, credits, or corrective action without review.",
      "Do not assign blame or admit fault."
    ]
  },
  security_and_trespass_requests: {
    handlingMode: "human_only",
    automationScope: "Acknowledge receipt only. Resolution stays with security or leadership.",
    approvedResponsePattern:
      "Acknowledge the message, state that the matter has been forwarded to the appropriate team, and avoid any substantive decision or promise.",
    instructions: [
      "Use formal, minimal language.",
      "Focus on acknowledgement and routing."
    ],
    forbidden: [
      "Do not reverse decisions or discuss security actions.",
      "Do not provide investigative details or legal interpretations."
    ]
  },
  general_information_requests: {
    handlingMode: "automate",
    automationScope: "Good fit for FAQ responses and policy clarification.",
    approvedResponsePattern:
      "Answer the question directly, clarify the policy or promotion wording, and invite follow-up if the guest needs more detail.",
    instructions: [
      "Keep the response concise.",
      "Prefer direct answers over long explanations."
    ],
    forbidden: [
      "Do not extrapolate beyond known policy text."
    ]
  },
  lost_and_found: {
    handlingMode: "ai_draft_with_human_review",
    automationScope: "Good for acknowledgement and intake. Status updates depend on internal confirmation.",
    approvedResponsePattern:
      "Thank the guest, confirm the item description will be checked with lost and found, and say the team will follow up.",
    instructions: [
      "Use empathetic service tone.",
      "Restate the item briefly when helpful.",
      "Set expectation that the team will investigate."
    ],
    forbidden: [
      "Do not imply the item has been found unless confirmed.",
      "Do not promise return timing."
    ]
  },
  loyalty_and_rewards: {
    handlingMode: "split_auto_and_human_review",
    automationScope: "Auto for routine statement or program guidance. Human review for fraud, account corrections, and exception requests.",
    approvedResponsePattern:
      "For routine requests, explain the process or next step. For account issues, acknowledge the concern and route to the loyalty team for verification.",
    instructions: [
      "Use account-verification language when benefits or balances are involved.",
      "Escalate fraud or profile issues."
    ],
    forbidden: [
      "Do not confirm promotional balances without verification.",
      "Do not modify account data in the response."
    ]
  },
  employment_verification: {
    handlingMode: "automate_routing",
    automationScope: "Auto-route to HR or employment verification contact.",
    approvedResponsePattern:
      "Acknowledge the request and direct the sender to the HR or verification contact without disclosing employee information in the reply.",
    instructions: [
      "Use routing language only.",
      "Keep the reply short."
    ],
    forbidden: [
      "Do not disclose employment details directly.",
      "Do not confirm sensitive personnel information by email."
    ]
  },
  other: {
    handlingMode: "human_triage",
    automationScope: "Use a neutral acknowledgement and route for manual review.",
    approvedResponsePattern:
      "Thank the sender, acknowledge the message, and state the correct team will review it if appropriate.",
    instructions: [
      "Stay neutral and brief."
    ],
    forbidden: [
      "Do not make specific commitments without category-specific guidance."
    ]
  }
};

const DEFAULT_PLAYBOOK = {
  handlingMode: "human_triage",
  automationScope: "Manual review required.",
  approvedResponsePattern: "Acknowledge receipt and route for manual review.",
  instructions: ["Use a neutral acknowledgement."],
  forbidden: ["Do not make unverified commitments."]
};

const CATEGORY_ALIASES = [
  { key: "group_sales_or_travel_trade", test: /travel.?trade|wholesale|tour operator|iata|commission|room block|group rate|group booking|12 single room|proposal|quote/i },
  { key: "sales_outreach", test: /domain name|buydomains|talent management|vendor|reseller|sales outreach/i },
  { key: "billing_and_receipts", test: /bill|invoice|receipt|folio|refund|payment|charge/i },
  { key: "reservation_inquiries", test: /reservation|booking|room|stay|check.?in|check.?out/i },
  { key: "collaboration_and_partnerships", test: /collab|partnership|sponsor|donation|charity|creator/i },
  { key: "transportation_and_facilities", test: /transport|facility|parking|shuttle|pool|spa|cabana|amenit/i },
  { key: "marketing_and_media", test: /marketing|media|editorial|influencer|press|filming/i },
  { key: "event_and_meeting_requests", test: /event|meeting|group|conference|banquet/i },
  { key: "service_complaints", test: /complaint|unhappy|upset|disappointed|bad service/i },
  { key: "security_and_trespass_requests", test: /security|trespass|fraud|complaint_cage|incident/i },
  { key: "general_information_requests", test: /general|information|promotion|faq|policy/i },
  { key: "lost_and_found", test: /lost/i },
  { key: "loyalty_and_rewards", test: /loyalty|reward|player|win.?loss|casino.?credit/i },
  { key: "employment_verification", test: /employment|verification|hr/i }
];

const INTENT_CATEGORY_MAP = {
  housekeeping: "reservation_inquiries",
  maintenance: "general_information_requests",
  amenity_hours: "transportation_and_facilities",
  late_checkout: "reservation_inquiries",
  parking_fees: "transportation_and_facilities",
  billing_dispute: "billing_and_receipts",
  complaint: "service_complaints",
  general_request: "other"
};

const REVIEW_ONLY_HANDLING_MODES = new Set([
  "human_only",
  "human_triage",
  "human_only_or_acknowledgement",
  "human_only_or_controlled_acknowledgement",
  "ai_draft_with_human_review"
]);

const AUTO_ELIGIBLE_HANDLING_MODES = new Set([
  "automate",
  "automate_for_stable_facts",
  "automate_routing"
]);

export function resolveCategoryPlaybookKey(category = "") {
  if (CATEGORY_PLAYBOOK[category]) {
    return category;
  }

  for (const alias of CATEGORY_ALIASES) {
    if (alias.test.test(category)) {
      return alias.key;
    }
  }

  return "other";
}

export function getCategoryPlaybook(category = "") {
  return CATEGORY_PLAYBOOK[resolveCategoryPlaybookKey(category)] || DEFAULT_PLAYBOOK;
}

export function listCategoryPlaybookRows() {
  return Object.entries(CATEGORY_PLAYBOOK).map(([category, playbook]) => ({
    category,
    handlingMode: playbook.handlingMode,
    automationScope: playbook.automationScope,
    approvedResponsePattern: playbook.approvedResponsePattern
  }));
}

export function resolveOperationalPlaybook({ category = "", intent = "" } = {}) {
  const playbook = { ...getCategoryPlaybook(category) };

  if (category === "billing_and_receipts" && intent === "billing_documents") {
    playbook.handlingMode = "automate";
    playbook.automationScope = "Safe to automate for receipt, folio, invoice, and statement document requests.";
  }

  return playbook;
}

export function deriveLiveCategory({ intent = "", subject = "", messageText = "" } = {}) {
  const haystack = `${subject}\n${messageText}`.trim();

  for (const alias of CATEGORY_ALIASES) {
    if (alias.test.test(haystack)) {
      return alias.key;
    }
  }

  return INTENT_CATEGORY_MAP[intent] || "other";
}

export function requiresHumanReviewForHandlingMode(handlingMode = "") {
  return REVIEW_ONLY_HANDLING_MODES.has(handlingMode);
}

export function isAutoEligibleHandlingMode(handlingMode = "") {
  return AUTO_ELIGIBLE_HANDLING_MODES.has(handlingMode);
}
