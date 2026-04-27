import { config } from "../config.js";
import { listGraphMessages } from "./graph.js";
import { callLlm, extractResponseText } from "./llm-client.js";

const FALLBACK_INBOUND_CATEGORIES = [
  {
    name: "guest_reservations_changes",
    description: "Guest reservation questions, booking changes, cancellations, upgrades, availability, and check-in or check-out logistics."
  },
  {
    name: "guest_billing_documents",
    description: "Guest requests for invoices, folios, receipts, final statements, and stay-related paperwork."
  },
  {
    name: "guest_refunds_deposits_disputes",
    description: "Deposit returns, refunds, disputed charges, overbooking refunds, and fee disputes from guests."
  },
  {
    name: "guest_amenities_access_questions",
    description: "Guest questions about amenities, access, hours, parking, transport, and routine stay logistics."
  },
  {
    name: "guest_special_requests_lost_and_found",
    description: "Lost items, room preferences, allergy or pillow requests, package delivery, and other special guest requests."
  },
  {
    name: "guest_service_failures_complaints",
    description: "Guest complaints, incident reports, dissatisfaction, and service failure narratives."
  },
  {
    name: "partner_booking_operations",
    description: "OTA, wholesaler, and travel-partner reservation operations, reconfirmations, rooming workflows, and booking coordination."
  },
  {
    name: "partner_finance_authorizations_collections",
    description: "Credit card authorization forms, partner invoices, collections notices, W-9 requests, and finance workflows with partners."
  },
  {
    name: "groups_events_partnerships",
    description: "Group business, private events, sponsorships, donations, and partnership requests with a concrete event or sales angle."
  },
  {
    name: "event_media_filming_requests",
    description: "Filming, photography, entertainment, media, creator, and venue-use requests that are not standard guest support."
  },
  {
    name: "legal_hr_compliance_requests",
    description: "Employment, verification, subpoena, claims, insurance, and compliance-related requests."
  },
  {
    name: "vendor_sales_marketing_outreach",
    description: "Cold outreach, advertising, software pitches, creator pitches, and vendor spam."
  },
  {
    name: "mailbox_system_notifications",
    description: "Mailbox-generated notices, held-message alerts, and internal system notifications."
  },
  {
    name: "misc_platform_noise",
    description: "Platform surveys, odd forwards, auto-replies, and miscellaneous inbound noise that is neither clear guest support nor a durable operational class."
  }
];

const FALLBACK_RESPONSE_STYLES = [
  { name: "faq_answer", description: "Direct answer with simple information." },
  { name: "step_by_step_guidance", description: "Procedural guidance or troubleshooting steps." },
  { name: "empathetic_apology", description: "Apology, empathy, and acknowledgment." },
  { name: "reservation_resolution", description: "Action on booking or reservation concerns." },
  { name: "escalation_or_follow_up", description: "Escalation, review, or later follow-up." },
  { name: "policy_explanation", description: "Policy, fee, timing, or eligibility explanation." },
  { name: "generic_acknowledgement", description: "Simple acknowledgment without much substance." },
  { name: "other", description: "Anything that does not fit the other styles." }
];

const STRUCTURE_PATTERNS = [
  { key: "bullet_list", test: (text) => /(^|\n)\s*[-*]\s+\S/m.test(text) },
  { key: "numbered_steps", test: (text) => /(^|\n)\s*\d+\.\s+\S/m.test(text) },
  { key: "greeting", test: (text) => /^(hi|hello|dear|good (morning|afternoon|evening))\b/i.test(text.trim()) },
  { key: "signoff", test: (text) => /(best|thanks|sincerely|regards|guest services|support team)\s*,?\s*$/i.test(text.trim()) },
  { key: "question_prompt", test: (text) => /(please let us know|feel free to reply|if you have any questions)/i.test(text) }
];

function htmlToText(value = "") {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function getMessageText(message = {}) {
  const bodyContent = message.body?.content || "";
  return htmlToText(bodyContent || message.bodyPreview || "");
}

function normalizeMailboxMessage(message, direction) {
  return {
    id: message.id || "",
    conversationId: message.conversationId || "",
    subject: message.subject || "",
    direction,
    from: message.from?.emailAddress?.address || message.sender?.emailAddress?.address || "",
    fromName: message.from?.emailAddress?.name || message.sender?.emailAddress?.name || "",
    to: (message.toRecipients || []).map((entry) => entry.emailAddress?.address).filter(Boolean),
    receivedAt: message.receivedDateTime || message.createdDateTime || "",
    sentAt: message.sentDateTime || message.createdDateTime || "",
    text: getMessageText(message)
  };
}

function pickTimestamp(message) {
  return message.direction === "outbound" ? message.sentAt : message.receivedAt;
}

function summarizeText(text = "", max = 220) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function hoursBetween(a, b) {
  const aTime = Date.parse(a);
  const bTime = Date.parse(b);
  if (!Number.isFinite(aTime) || !Number.isFinite(bTime) || bTime < aTime) {
    return null;
  }
  return Number(((bTime - aTime) / 36e5).toFixed(2));
}

function average(values) {
  if (!values.length) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function topEntries(counts, limit = 5) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function stripCodeFences(text = "") {
  return text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

async function callOpenAIJson(prompt) {
  const response = await callLlm({
    input: prompt,
    temperature: 0.1
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return JSON.parse(stripCodeFences(extractResponseText(data)));
}

function keywordCategory(text = "", subject = "") {
  const haystack = `${subject}\n${text}`.toLowerCase();
  const rules = [
    { category: "mailbox_system_notifications", patterns: ["held messages", "postmaster", "mail delivery", "quarantine", "auto reply"] },
    {
      category: "partner_finance_authorizations_collections",
      patterns: [
        "credit card authorization",
        "payment authorization",
        "authorization request",
        "agoda invoice",
        "invoice due",
        "collections@",
        "submitted invoice",
        "w9",
        "auditor",
        "defcon"
      ]
    },
    {
      category: "partner_booking_operations",
      patterns: [
        "un-submitted sign-in sheet",
        "un-submitted e-invoice",
        "reconfirmation required",
        "confirmation request",
        "supplier confirmation",
        "supplier reference",
        "booking id",
        "hotelmap",
        "itriponline",
        "w2m",
        "specialtydesk",
        "reservations@saharalasvegas.com"
      ]
    },
    {
      category: "legal_hr_compliance_requests",
      patterns: [
        "subpoena",
        "verification of employment",
        "employment verification",
        "reference request",
        "certificate of insurance",
        "claim #",
        "damage information",
        "insurance"
      ]
    },
    {
      category: "event_media_filming_requests",
      patterns: [
        "filming",
        "photography",
        "media",
        "dj activations",
        "live piano",
        "magic mike",
        "creator",
        "youtube channel"
      ]
    },
    {
      category: "vendor_sales_marketing_outreach",
      patterns: [
        "advertising",
        "ugc",
        "collaboration",
        "collaboration opportunity",
        "fleet management",
        "software costs",
        "marketing",
        "cleaning quote",
        "mailing list",
        "merchant processing",
        "reduce costs"
      ]
    },
    {
      category: "groups_events_partnerships",
      patterns: [
        "private event",
        "group rates",
        "sponsorship",
        "donation",
        "golf tournament",
        "conference",
        "event",
        "room block",
        "wrestling event"
      ]
    },
    {
      category: "guest_service_failures_complaints",
      patterns: [
        "complaint",
        "complaints",
        "incident",
        "horrible experience",
        "food poisoning",
        "fraudulent",
        "fraudulent account",
        "bad service",
        "upset",
        "disappointed"
      ]
    },
    {
      category: "guest_refunds_deposits_disputes",
      patterns: [
        "deposit refund",
        "refund",
        "security deposit",
        "unknown charges",
        "duplicate charges",
        "disputed charge",
        "charged me 2 times",
        "charge discrepancy",
        "additional charge",
        "do not recognize",
        "don't recognize",
        "bill clarification",
        "resort fee"
      ]
    },
    {
      category: "guest_billing_documents",
      patterns: [
        "invoice",
        "receipt",
        "folio",
        "final statement",
        "bill needed",
        "stay copy",
        "w-2g",
        "tax win loss"
      ]
    },
    {
      category: "guest_special_requests_lost_and_found",
      patterns: [
        "left behind",
        "lost",
        "sweater",
        "pillows",
        "allergy",
        "package delivery",
        "room preferences",
        "quiet room",
        "ground floor room"
      ]
    },
    {
      category: "guest_amenities_access_questions",
      patterns: [
        "gym",
        "spa",
        "pool",
        "parking",
        "airport transfer",
        "hours",
        "fitness studio",
        "players club",
        "cabana"
      ]
    },
    {
      category: "guest_reservations_changes",
      patterns: [
        "reservation",
        "booking",
        "booked",
        "check in",
        "check-in",
        "check out",
        "check-out",
        "confirmation",
        "room type",
        "late arrival",
        "extension request",
        "upcoming stay",
        "availability"
      ]
    },
    {
      category: "misc_platform_noise",
      patterns: [
        "how is your experience working with priceline agoda",
        "sent you a new message",
        "disregard",
        "automatisch antwoord",
        "[external] -"
      ]
    }
  ];

  for (const rule of rules) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
      return rule.category;
    }
  }
  return "misc_platform_noise";
}

function categorizeResponseStyle(text = "") {
  if (/sorry|apolog/i.test(text)) {
    return "empathetic_apology";
  }
  if (/(1\.|2\.|step|follow these steps|please try)/i.test(text)) {
    return "step_by_step_guidance";
  }
  if (/(reservation|booking|confirmation|check-in|check in)/i.test(text)) {
    return "reservation_resolution";
  }
  if (/(policy|per our|according to|available|hours|fee|authorization)/i.test(text)) {
    return "policy_explanation";
  }
  if (/(follow up|follow-up|escalat|manager|team will review|we are checking)/i.test(text)) {
    return "escalation_or_follow_up";
  }
  if (/(faq|here are|for your question|details below)/i.test(text)) {
    return "faq_answer";
  }
  if (/(thank you for reaching out|thanks for contacting|we received your message|thank you)/i.test(text)) {
    return "generic_acknowledgement";
  }
  return "other";
}

function analyzeResponseFormatting(text = "") {
  const traits = [];
  for (const pattern of STRUCTURE_PATTERNS) {
    if (pattern.test(text)) {
      traits.push(pattern.key);
    }
  }

  const lineCount = text ? text.split("\n").filter(Boolean).length : 0;
  const sentenceCount = text ? (text.match(/[.!?]+/g) || []).length : 0;
  const wordCount = text ? text.trim().split(/\s+/).length : 0;

  return {
    wordCount,
    lineCount,
    sentenceCount,
    traits
  };
}

function assessAutomation(pair) {
  const inboundCategory = pair.inbound.category;
  const responseStyle = pair.response?.style || "other";
  const responseWordCount = pair.response?.formatting.wordCount || 0;
  const containsEscalation = responseStyle === "escalation_or_follow_up";
  const highlyVariable = responseWordCount > 220;
  const strongCandidateCategories = new Set([
    "guest_reservations_changes",
    "guest_billing_documents",
    "guest_amenities_access_questions",
    "guest_special_requests_lost_and_found",
    "partner_booking_operations"
  ]);
  const weakCandidateCategories = new Set([
    "guest_service_failures_complaints",
    "guest_refunds_deposits_disputes",
    "partner_finance_authorizations_collections",
    "legal_hr_compliance_requests",
    "groups_events_partnerships",
    "event_media_filming_requests"
  ]);

  if (containsEscalation || weakCandidateCategories.has(inboundCategory)) {
    return {
      suitability: "low",
      rationale: "Responses often need human judgment, escalation, or policy review."
    };
  }

  if (strongCandidateCategories.has(inboundCategory) && !highlyVariable) {
    return {
      suitability: "high",
      rationale: "Responses are often repeatable enough for templating or grounded automation."
    };
  }

  return {
    suitability: "medium",
    rationale: "Partial automation looks feasible, but agent review is still likely useful."
  };
}

function deriveLocalSchema() {
  return {
    strategy: "fallback-rules",
    inbound_categories: FALLBACK_INBOUND_CATEGORIES,
    response_styles: FALLBACK_RESPONSE_STYLES
  };
}

function validateSchema(schema) {
  if (!schema || !Array.isArray(schema.inbound_categories) || !Array.isArray(schema.response_styles)) {
    throw new Error("Schema missing inbound_categories or response_styles");
  }

  const cleanedCategories = schema.inbound_categories
    .map((entry) => ({
      name: String(entry.name || "").trim().toLowerCase().replace(/\s+/g, "_"),
      description: String(entry.description || "").trim()
    }))
    .filter((entry) => entry.name && entry.description);
  const cleanedStyles = schema.response_styles
    .map((entry) => ({
      name: String(entry.name || "").trim().toLowerCase().replace(/\s+/g, "_"),
      description: String(entry.description || "").trim()
    }))
    .filter((entry) => entry.name && entry.description);

  if (!cleanedCategories.length || !cleanedStyles.length) {
    throw new Error("Schema returned empty categories or response styles");
  }

  if (!cleanedCategories.some((entry) => entry.name === "other")) {
    cleanedCategories.push({ name: "other", description: "Anything that does not fit the other categories." });
  }
  if (!cleanedStyles.some((entry) => entry.name === "other")) {
    cleanedStyles.push({ name: "other", description: "Anything that does not fit the other response styles." });
  }

  return {
    strategy: schema.strategy || "dynamic-openai",
    summary: schema.summary || "",
    inbound_categories: cleanedCategories,
    response_styles: cleanedStyles
  };
}

async function deriveDynamicSchemaViaOpenAI(pairs) {
  const sample = pairs.slice(0, 40).map((pair, index) => ({
    id: index + 1,
    subject: pair.inbound.subject,
    inbound: summarizeText(pair.inbound.text, 240),
    response: summarizeText(pair.response?.text || "", 180)
  }));

  const prompt = [
    "You are building a mailbox-specific classification schema for a mixed service inbox.",
    "Derive broad but useful dynamic categories from the examples. The inbox may contain customer requests, internal notices, vendor outreach, payment paperwork, spam, and system notifications.",
    "Return strict JSON only.",
    'JSON shape: {"strategy":"dynamic-openai","summary":"","inbound_categories":[{"name":"","description":""}],"response_styles":[{"name":"","description":""}]}',
    "Rules:",
    "- Use slug_case names.",
    "- Prefer 5 to 12 inbound categories.",
    "- Prefer 4 to 10 response styles.",
    '- Categories must be broad enough to group similar emails, not one-off subjects.',
    '- Include "other" only if needed; it will be added automatically if missing.',
    "",
    `Examples: ${JSON.stringify(sample)}`
  ].join("\n");

  return validateSchema(await callOpenAIJson(prompt));
}

async function deriveSchema(pairs) {
  if (!config.openai.apiKey) {
    return deriveLocalSchema();
  }

  try {
    return await deriveDynamicSchemaViaOpenAI(pairs);
  } catch (error) {
    return {
      ...deriveLocalSchema(),
      fallback_reason: error.message
    };
  }
}

async function analyzePairViaOpenAI(pair, schema) {
  const inboundCategoryNames = schema.inbound_categories.map((entry) => entry.name);
  const responseStyleNames = schema.response_styles.map((entry) => entry.name);

  const prompt = [
    "Analyze this inbox exchange and return strict JSON only.",
    "Use the provided dynamic mailbox schema.",
    `Allowed inbound categories: ${inboundCategoryNames.join(", ")}`,
    `Allowed response styles: ${responseStyleNames.join(", ")}`,
    'JSON shape: {"inbound_category":"","inbound_reason":"","response_style":"","response_guidance_summary":"","automation_suitability":"high|medium|low","automation_reason":"","response_quality":"strong|mixed|weak"}',
    "",
    `Inbound category descriptions: ${JSON.stringify(schema.inbound_categories)}`,
    `Response style descriptions: ${JSON.stringify(schema.response_styles)}`,
    `Inbound subject: ${pair.inbound.subject || "N/A"}`,
    `Inbound sender: ${pair.inbound.from || "N/A"}`,
    `Inbound email text: ${pair.inbound.text || "N/A"}`,
    `Agent reply text: ${pair.response?.text || "N/A"}`
  ].join("\n");

  const parsed = await callOpenAIJson(prompt);

  if (!inboundCategoryNames.includes(parsed.inbound_category)) {
    throw new Error(`Unexpected inbound category: ${parsed.inbound_category}`);
  }
  if (!responseStyleNames.includes(parsed.response_style)) {
    throw new Error(`Unexpected response style: ${parsed.response_style}`);
  }

  return parsed;
}

function analyzePairLocally(pair) {
  const inboundCategory = keywordCategory(pair.inbound.text, pair.inbound.subject);
  const responseStyle = pair.response ? categorizeResponseStyle(pair.response.text) : "other";
  const automation = assessAutomation({
    inbound: { category: inboundCategory },
    response: pair.response
      ? {
          style: responseStyle,
          formatting: analyzeResponseFormatting(pair.response.text)
        }
      : null
  });

  return {
    inbound_category: inboundCategory,
    inbound_reason: `Keyword-based classification matched ${inboundCategory}.`,
    response_style: responseStyle,
    response_guidance_summary: pair.response ? summarizeText(pair.response.text, 160) : "No outbound reply found.",
    automation_suitability: automation.suitability,
    automation_reason: automation.rationale,
    response_quality: !pair.response ? "weak" : responseStyle === "generic_acknowledgement" ? "mixed" : "strong"
  };
}

async function analyzePair(pair, schema) {
  const formatting = pair.response ? analyzeResponseFormatting(pair.response.text) : null;

  if (!config.openai.apiKey || schema.strategy === "fallback-rules") {
    return {
      ...analyzePairLocally(pair),
      model_provider: "local-rules",
      formatting
    };
  }

  try {
    const modelAnalysis = await analyzePairViaOpenAI(pair, schema);
    return {
      ...modelAnalysis,
      model_provider: "openai",
      formatting
    };
  } catch (error) {
    return {
      ...analyzePairLocally(pair),
      model_provider: "local-rules",
      model_error: error.message,
      formatting
    };
  }
}

function buildConversationPairs(messages) {
  const byConversation = new Map();

  for (const message of messages) {
    if (!message.conversationId || !message.text?.trim()) {
      continue;
    }
    if (!byConversation.has(message.conversationId)) {
      byConversation.set(message.conversationId, []);
    }
    byConversation.get(message.conversationId).push(message);
  }

  const pairs = [];

  for (const conversationMessages of byConversation.values()) {
    conversationMessages.sort((a, b) => Date.parse(pickTimestamp(a)) - Date.parse(pickTimestamp(b)));
    const usedOutboundIds = new Set();

    for (let index = 0; index < conversationMessages.length; index += 1) {
      const current = conversationMessages[index];
      if (current.direction !== "inbound") {
        continue;
      }

      const response = conversationMessages.find((candidate, candidateIndex) => {
        if (candidateIndex <= index) {
          return false;
        }
        if (candidate.direction !== "outbound") {
          return false;
        }
        if (usedOutboundIds.has(candidate.id)) {
          return false;
        }
        return Date.parse(candidate.sentAt) >= Date.parse(current.receivedAt);
      });

      if (response) {
        usedOutboundIds.add(response.id);
      }

      pairs.push({
        conversationId: current.conversationId,
        inbound: current,
        response: response || null,
        responseTimeHours: response ? hoursBetween(current.receivedAt, response.sentAt) : null
      });
    }
  }

  return pairs;
}

function buildAggregateReport(analyzedPairs, meta, schema) {
  const inboundCounts = {};
  const responseStyleCounts = {};
  const automationCounts = {};
  const formattingCounts = {};
  const categoryRollups = {};
  const responseTimes = [];

  for (const pair of analyzedPairs) {
    increment(inboundCounts, pair.analysis.inbound_category);
    increment(automationCounts, pair.analysis.automation_suitability);

    if (pair.response) {
      increment(responseStyleCounts, pair.analysis.response_style);
      for (const trait of pair.analysis.formatting?.traits || []) {
        increment(formattingCounts, trait);
      }
    }

    if (pair.responseTimeHours !== null) {
      responseTimes.push(pair.responseTimeHours);
    }

    const category = pair.analysis.inbound_category;
    if (!categoryRollups[category]) {
      categoryRollups[category] = {
        inbound_category: category,
        volume: 0,
        replied: 0,
        response_styles: {},
        automation: { high: 0, medium: 0, low: 0 },
        avg_response_time_hours: 0
      };
    }

    const rollup = categoryRollups[category];
    rollup.volume += 1;
    increment(rollup.automation, pair.analysis.automation_suitability);

    if (pair.response) {
      rollup.replied += 1;
      increment(rollup.response_styles, pair.analysis.response_style);
    }
  }

  for (const category of Object.values(categoryRollups)) {
    const categoryTimes = analyzedPairs
      .filter((pair) => pair.analysis.inbound_category === category.inbound_category && pair.responseTimeHours !== null)
      .map((pair) => pair.responseTimeHours);

    category.avg_response_time_hours = average(categoryTimes);
    category.response_styles = topEntries(category.response_styles);
    category.automation_readiness =
      category.automation.high >= category.automation.low ? "candidate_for_automation" : "keep_human_review";
  }

  const automationOpportunities = Object.values(categoryRollups)
    .filter((category) => category.automation_readiness === "candidate_for_automation")
    .sort((a, b) => b.volume - a.volume)
    .map((category) => ({
      inbound_category: category.inbound_category,
      volume: category.volume,
      replied: category.replied,
      avg_response_time_hours: category.avg_response_time_hours,
      common_response_styles: category.response_styles
    }));

  return {
    mailbox: meta.mailbox,
    analyzed_window: meta.window,
    schema,
    totals: {
      inbound_messages: meta.inboundCount,
      outbound_messages: meta.outboundCount,
      categorized_inbound_threads: analyzedPairs.length,
      inbound_with_detected_reply: analyzedPairs.filter((pair) => pair.response).length,
      average_response_time_hours: average(responseTimes)
    },
    inbound_categories: topEntries(inboundCounts, schema.inbound_categories.length),
    response_styles: topEntries(responseStyleCounts, schema.response_styles.length),
    response_formatting_traits: topEntries(formattingCounts, STRUCTURE_PATTERNS.length),
    automation_suitability: topEntries(automationCounts, 3),
    category_breakdown: Object.values(categoryRollups).sort((a, b) => b.volume - a.volume),
    automation_opportunities: automationOpportunities
  };
}

function buildMarkdownReport(report, samplePairs) {
  const lines = [];

  lines.push(`# Outlook Service Inbox Analysis`);
  lines.push("");
  lines.push(`Mailbox: ${report.mailbox}`);
  lines.push(`Window start: ${report.analyzed_window.start}`);
  lines.push(`Inbox messages analyzed: ${report.totals.inbound_messages}`);
  lines.push(`Sent messages analyzed: ${report.totals.outbound_messages}`);
  lines.push(`Categorized inbound threads: ${report.totals.categorized_inbound_threads}`);
  lines.push(`Inbound messages with matched reply: ${report.totals.inbound_with_detected_reply}`);
  lines.push(`Average response time (hours): ${report.totals.average_response_time_hours}`);
  lines.push(`Schema strategy: ${report.schema.strategy}`);
  if (report.schema.summary) {
    lines.push(`Schema summary: ${report.schema.summary}`);
  }
  lines.push("");
  lines.push(`## Dynamic Inbound Categories`);
  for (const entry of report.schema.inbound_categories) {
    lines.push(`- ${entry.name}: ${entry.description}`);
  }
  lines.push("");
  lines.push(`## Dynamic Response Styles`);
  for (const entry of report.schema.response_styles) {
    lines.push(`- ${entry.name}: ${entry.description}`);
  }
  lines.push("");
  lines.push(`## Inbound Category Counts`);
  for (const entry of report.inbound_categories) {
    lines.push(`- ${entry.name}: ${entry.count}`);
  }
  lines.push("");
  lines.push(`## Response Style Counts`);
  for (const entry of report.response_styles) {
    lines.push(`- ${entry.name}: ${entry.count}`);
  }
  lines.push("");
  lines.push(`## Automation Opportunities`);
  if (!report.automation_opportunities.length) {
    lines.push(`- No clear automation candidates found in this sample.`);
  } else {
    for (const entry of report.automation_opportunities) {
      const styles = entry.common_response_styles.map((style) => `${style.name} (${style.count})`).join(", ") || "none";
      lines.push(
        `- ${entry.inbound_category}: volume=${entry.volume}, replied=${entry.replied}, avg_response_time_hours=${entry.avg_response_time_hours}, common_response_styles=${styles}`
      );
    }
  }
  lines.push("");
  lines.push(`## Sample Pairs`);
  for (const pair of samplePairs) {
    lines.push(`- Subject: ${pair.inbound.subject || "(no subject)"}`);
    lines.push(`  Inbound category: ${pair.analysis.inbound_category}`);
    lines.push(`  Response style: ${pair.analysis.response_style}`);
    lines.push(`  Automation suitability: ${pair.analysis.automation_suitability}`);
    lines.push(`  Inbound summary: ${summarizeText(pair.inbound.text, 140) || "N/A"}`);
    lines.push(`  Reply summary: ${summarizeText(pair.response?.text || "", 140) || "No reply found."}`);
  }

  return lines.join("\n");
}

function buildDetailedPairs(analyzedPairs) {
  return analyzedPairs.map((pair) => ({
    conversation_id: pair.conversationId,
    inbound: {
      subject: pair.inbound.subject,
      sender: pair.inbound.from,
      sender_name: pair.inbound.fromName,
      received_at: pair.inbound.receivedAt,
      summary: summarizeText(pair.inbound.text, 240)
    },
    response: pair.response
      ? {
          sender: pair.response.from,
          sent_at: pair.response.sentAt,
          summary: summarizeText(pair.response.text, 240)
        }
      : null,
    response_time_hours: pair.responseTimeHours,
    analysis: pair.analysis
  }));
}

export async function analyzeMailbox({
  inboxTop = 100,
  sentTop = 100,
  maxPages = 2,
  days = 14,
  sampleSize = 8
} = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const [inboxMessages, sentMessages] = await Promise.all([
    listGraphMessages({ folder: "inbox", top: inboxTop, maxPages, since }),
    listGraphMessages({ folder: "sentitems", top: sentTop, maxPages, since })
  ]);

  const normalizedInbox = inboxMessages.map((message) => normalizeMailboxMessage(message, "inbound"));
  const normalizedSent = sentMessages
    .filter((message) => !message.isDraft)
    .map((message) => normalizeMailboxMessage(message, "outbound"));
  const pairs = buildConversationPairs([...normalizedInbox, ...normalizedSent]);
  const schema = await deriveSchema(pairs);

  const analyzedPairs = [];
  for (const pair of pairs) {
    analyzedPairs.push({
      ...pair,
      analysis: await analyzePair(pair, schema)
    });
  }

  const report = buildAggregateReport(
    analyzedPairs,
    {
      mailbox: config.email.mailbox,
      window: { start: since, days },
      inboundCount: normalizedInbox.length,
      outboundCount: normalizedSent.length
    },
    schema
  );

  return {
    report,
    sample_pairs: analyzedPairs.slice(0, sampleSize),
    categorized_pairs: buildDetailedPairs(analyzedPairs)
  };
}

export function formatMailboxAnalysis(result, format = "markdown") {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  return buildMarkdownReport(result.report, result.sample_pairs);
}
