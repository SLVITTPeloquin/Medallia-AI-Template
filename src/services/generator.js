import { config } from "../config.js";
import { callLlm, extractResponseText } from "./llm-client.js";

function interpolate(template, vars) {
  return template.replace(/{{(\w+)}}/g, (_, key) => vars[key] ?? "");
}

function summarizeRequest(text = "") {
  let compact = text.trim().replace(/\s+/g, " ");
  compact = compact.replace(/^(hi|hello|hey)[,!.\s]+/i, "");
  compact = compact.replace(/[?!.]+$/g, "");
  if (!compact) {
    return "assistance";
  }
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
}

function getSignature() {
  return "Please let me know if you need anything else.";
}

function toChecklistId(label = "", index = 0) {
  const normalized = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || `task_${index + 1}`;
}

function normalizeChecklistItem(item, index) {
  const label = String(item?.label || "").trim();
  if (!label) {
    return null;
  }
  return {
    id: toChecklistId(label, index),
    label,
    required: item?.required !== false,
    done: false
  };
}

function normalizeChecklist(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  const normalized = items
    .map((item, index) => normalizeChecklistItem(item, index))
    .filter(Boolean)
    .slice(0, 6);
  return normalized;
}

function extractJsonPayload(text = "") {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const directParse = (() => {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  })();
  if (directParse) {
    return directParse;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through
    }
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    } catch {
      // ignore
    }
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(trimmed.slice(arrayStart, arrayEnd + 1));
    } catch {
      // ignore
    }
  }

  return null;
}

function toEmailBody(text = "") {
  return text
    .trim()
    .replace(/^regarding [^,]+,\s*/i, "")
    .replace(/^(hi|hello)\s+[^,]+,\s*/i, "")
    .replace(/\s*Please let me know if you need anything else\.?$/i, "")
    .trim();
}

const CATEGORY_ROUTE_LABELS = {
  billing_and_receipts: "billing team",
  group_sales_or_travel_trade: "group sales team",
  collaboration_and_partnerships: "partnerships team",
  sales_outreach: "marketing team",
  marketing_and_media: "marketing team",
  event_and_meeting_requests: "events team",
  security_and_trespass_requests: "security team",
  lost_and_found: "lost and found team",
  loyalty_and_rewards: "loyalty team",
  employment_verification: "Human Resources team",
  other: "appropriate team"
};

function buildLocalDraft({ channel, template, messageText, facts, guestName, subject, intent, urgency }) {
  const rawFact = facts[0]?.text || "";
  const policyFact = (
    /^(provide|use|do not|avoid|confirm)\b/i.test(rawFact.trim())
      ? "I am confirming the current policy details now"
      : rawFact || "I am confirming the current policy now"
  ).replace(/[.!\s]+$/g, "");
  const draft = interpolate(template, {
    guestName: guestName || "there",
    requestSummary: summarizeRequest(messageText),
    eta: "15-30 minutes",
    policyFact,
    signature: getSignature()
  });

  if (intent === "amenity_hours" && policyFact === "I am confirming the current policy details now") {
    const amenityFallback = `Hi ${guestName || "there"}, thanks for checking. I am confirming this weekend's pool hours and children policy with our operations team now, and I will send you the confirmed details ${followUpWindow(urgency)}. ${getSignature()}`;
    if (channel === "email") {
      return toEmailBody(amenityFallback);
    }
    return amenityFallback;
  }

  if (channel === "email") {
    return toEmailBody(draft);
  }

  return draft;
}

function getRouteLabel(category = "") {
  return CATEGORY_ROUTE_LABELS[category] || CATEGORY_ROUTE_LABELS.other;
}

function followUpWindow(urgency = "normal") {
  if (urgency === "high") {
    return "within 2 hours";
  }
  return "within 24 hours";
}

function buildHeuristicChecklist({ messageText, draft, category }) {
  const combined = `${messageText}\n${draft}`.toLowerCase();
  const items = [];

  if (/(reservation|booking|confirm|confirmation number)/i.test(combined)) {
    items.push({
      label: "Verify reservation status and include confirmation details in follow-up",
      required: true
    });
  }

  if (/(pool|amenit|hours|children|kid)/i.test(combined)) {
    items.push({
      label: "Confirm current amenity hours and age-access policy with operations",
      required: true
    });
  }

  if (/(billing|receipt|invoice|folio|charge|refund|dispute)/i.test(combined)) {
    items.push({
      label: "Validate billing details against account records before final response",
      required: true
    });
  }

  if (/(routed|forwarded|shared with|team)/i.test(combined)) {
    items.push({
      label: `Route to the ${getRouteLabel(category)} and note case ownership`,
      required: true
    });
  }

  items.push({
    label: "Review draft tone and accuracy before send",
    required: true
  });
  items.push({
    label: "Send follow-up matching the timeline promised in the draft",
    required: true
  });

  return normalizeChecklist(items);
}

function hasConcreteResolution(text = "") {
  const compact = text.toLowerCase();
  const hasAction =
    /\b(i|we)\s+(have|will|can|am)\b/.test(compact) ||
    /\b(forwarded|routed|escalated|submitted|scheduled|confirmed|review)\b/.test(compact);
  const hasTiming = /\b(within|today|tomorrow|hour|hours|minutes|eta|by)\b/.test(compact);
  return hasAction && hasTiming;
}

function ensureResolutionLine(draft = "", { category, playbook, urgency }) {
  const compact = draft.trim().replace(/\s+/g, " ");
  if (!compact) {
    return compact;
  }
  if (hasConcreteResolution(compact)) {
    return compact;
  }

  const window = followUpWindow(urgency);
  const line =
    playbook.handlingMode === "automate_for_stable_facts"
      ? `I am confirming the current details now and will send the confirmed update ${window}.`
      : `I have routed this to our ${getRouteLabel(category)} now, and we will update you ${window}.`;

  const withPunctuation = /[.!?]$/.test(compact) ? compact : `${compact}.`;
  return `${withPunctuation} ${line}`;
}

function needsBillingReview(text = "", subject = "") {
  return /(refund|dispute|charged|chargeback|duplicate charge|unauthorized|credit back)/i.test(`${subject}\n${text}`);
}

function buildRoutingDraft({ category, urgency }) {
  const window = followUpWindow(urgency);
  if (category === "employment_verification") {
    return `Thank you for your request. Employment verification inquiries are handled by our Human Resources team. Please contact HR@SaharaLasVegas.com, and we will confirm receipt ${window}.`;
  }

  if (category === "lost_and_found") {
    return `Thank you for your message. I have shared the item details with our Lost and Found team now, and we will update you ${window}.`;
  }

  return `Thank you for your message. I have routed this to our ${getRouteLabel(category)} now, and we will follow up ${window}.`;
}

function buildBillingDraft({ messageText, subject, urgency }) {
  const window = followUpWindow(urgency);
  if (needsBillingReview(messageText, subject)) {
    return `Thank you for bringing this to our attention. I have routed this to our billing team for review now, and we will follow up ${window} after the account check is complete.`;
  }

  return `Thank you for your request. I have started your billing document request now, and we will send the verified document ${window}.`;
}

function buildPlaybookAwareLocalDraft({
  channel,
  template,
  messageText,
  facts,
  guestName,
  subject,
  intent,
  urgency,
  category,
  playbook
}) {
  if (playbook.handlingMode === "human_only") {
    return buildRoutingDraft({ category, urgency });
  }

  if (playbook.handlingMode === "human_triage") {
    return buildRoutingDraft({ category, urgency });
  }

  if (playbook.handlingMode === "human_only_or_acknowledgement") {
    return buildRoutingDraft({ category, urgency });
  }

  if (playbook.handlingMode === "human_only_or_controlled_acknowledgement") {
    return buildRoutingDraft({ category, urgency });
  }

  if (playbook.handlingMode === "automate_routing") {
    return buildRoutingDraft({ category, urgency });
  }

  if (category === "billing_and_receipts") {
    return buildBillingDraft({ messageText, subject, urgency });
  }

  return buildLocalDraft({ channel, template, messageText, facts, guestName, subject, intent, urgency });
}

function buildPrompt({
  channel,
  template,
  messageText,
  intent,
  urgency,
  facts,
  guestName,
  recentThreadSummary,
  subject,
  category,
  playbook
}) {
  const factsText = facts.map((f) => `- (${f.id}) ${f.text}`).join("\n");
  const channelRules =
    channel === "email"
      ? [
          "- Write as a structured email body.",
          "- Use a professional but warm tone.",
          "- Include enough detail to fully answer the guest.",
          "- Do not include salutation or signoff; those are added by the renderer."
        ]
      : [
          "- Write for SMS delivery.",
          "- Keep sentences short and easy to split into multiple messages.",
          "- Avoid unnecessary filler or long paragraphs."
        ];

  return [
    "Generate a guest-facing hospitality response.",
    "Rules:",
    "- Keep the response concise and polite.",
    "- Use approved facts only.",
    "- If uncertain, avoid promises and indicate follow-up.",
    "- Include a clear resolution statement: direct answer or explicit action already taken.",
    "- Include a concrete follow-up timeline (for example, within 2 hours or within 24 hours).",
    "- Do not use vague timing like 'shortly' without a concrete timeframe.",
    "- Return only message text.",
    ...channelRules,
    "",
    `Channel: ${channel}`,
    `Guest name: ${guestName || "Unknown"}`,
    `Intent: ${intent}`,
    `Category: ${category}`,
    `Handling mode: ${playbook.handlingMode}`,
    `Urgency: ${urgency}`,
    `Email subject: ${subject || "N/A"}`,
    `Message: ${messageText}`,
    `Recent thread summary: ${recentThreadSummary || "N/A"}`,
    `Automation scope: ${playbook.automationScope}`,
    `Approved response pattern: ${playbook.approvedResponsePattern}`,
    "Category instructions:",
    ...playbook.instructions.map((item) => `- ${item}`),
    "Forbidden actions:",
    ...playbook.forbidden.map((item) => `- ${item}`),
    "Approved facts:",
    factsText || "- none",
    "Template skeleton:",
    template
  ].join("\n");
}

async function generateViaOpenAI(input) {
  const response = await callLlm({
    input,
    temperature: 0.3
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${text}`);
  }

  const data = await response.json();
  const text = extractResponseText(data);
  if (!text) {
    throw new Error("OpenAI response did not include output_text");
  }
  return text;
}

function buildChecklistPrompt({
  channel,
  messageText,
  subject,
  draft,
  intent,
  category,
  urgency,
  playbook
}) {
  return [
    "You generate reviewer action checklists for hospitality replies.",
    "Return JSON only.",
    "Output schema:",
    '{ "actions": [ { "label": "string", "required": true } ] }',
    "Rules:",
    "- Create 3 to 6 actions.",
    "- Actions must be concrete and operational.",
    "- Actions must directly reflect commitments made in the draft reply.",
    "- Include any verification steps needed before sending.",
    "- Keep labels short and imperative.",
    "",
    `Channel: ${channel}`,
    `Intent: ${intent}`,
    `Category: ${category}`,
    `Urgency: ${urgency}`,
    `Handling mode: ${playbook.handlingMode}`,
    `Subject: ${subject || "N/A"}`,
    `Guest message: ${messageText}`,
    `Draft reply: ${draft}`
  ].join("\n");
}

async function generateActionChecklistViaAi(context) {
  const prompt = buildChecklistPrompt(context);
  const raw = await generateViaOpenAI(prompt);
  const parsed = extractJsonPayload(raw);
  const actions = Array.isArray(parsed?.actions) ? parsed.actions : Array.isArray(parsed) ? parsed : [];
  const normalized = normalizeChecklist(actions);
  if (!normalized.length) {
    throw new Error("Action checklist response was empty or invalid JSON");
  }
  return normalized;
}

export async function generateDraft(context) {
  const {
    channel,
    template,
    messageText,
    intent,
    urgency,
    facts,
    guestName,
    recentThreadSummary,
    subject,
    category,
    playbook
  } = context;
  const fallbackDraft = buildPlaybookAwareLocalDraft({
    channel,
    template,
    messageText,
    facts,
    guestName,
    subject,
    intent,
    urgency,
    category,
    playbook
  });
  const fallbackChecklist = buildHeuristicChecklist({
    messageText,
    draft: fallbackDraft,
    category
  });

  if (!config.openai.apiKey) {
    return {
      draft: ensureResolutionLine(fallbackDraft, { category, playbook, urgency }),
      provider: "local-template",
      actionChecklist: fallbackChecklist,
      checklistProvider: "heuristic"
    };
  }

  try {
    const prompt = buildPrompt({
      channel,
      template,
      messageText,
      intent,
      urgency,
      facts,
      guestName,
      recentThreadSummary,
      subject,
      category,
      playbook
    });
    const draft = await generateViaOpenAI(prompt);
    const resolvedDraft = ensureResolutionLine(draft, { category, playbook, urgency });
    let actionChecklist = fallbackChecklist;
    let checklistProvider = "heuristic";
    let checklistError = null;
    try {
      actionChecklist = await generateActionChecklistViaAi({
        channel,
        messageText,
        subject,
        draft: resolvedDraft,
        intent,
        category,
        urgency,
        playbook
      });
      checklistProvider = "openai";
    } catch (error) {
      checklistError = error.message;
    }

    return {
      draft: resolvedDraft,
      provider: "openai",
      actionChecklist,
      checklistProvider,
      checklistError
    };
  } catch (error) {
    return {
      draft: ensureResolutionLine(fallbackDraft, { category, playbook, urgency }),
      provider: "local-template",
      generatorError: error.message,
      actionChecklist: fallbackChecklist,
      checklistProvider: "heuristic"
    };
  }
}
