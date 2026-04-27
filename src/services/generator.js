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

function buildLocalDraft({ channel, template, messageText, facts, guestName, subject }) {
  const policyFact = facts[0]?.text || "I am confirming the current policy now.";
  const draft = interpolate(template, {
    guestName: guestName || "there",
    requestSummary: summarizeRequest(messageText),
    eta: "15-30 minutes",
    policyFact,
    signature: getSignature()
  });

  if (channel === "email") {
    return toEmailBody(draft);
  }

  return draft;
}

function getRouteLabel(category = "") {
  return CATEGORY_ROUTE_LABELS[category] || CATEGORY_ROUTE_LABELS.other;
}

function needsBillingReview(text = "", subject = "") {
  return /(refund|dispute|charged|chargeback|duplicate charge|unauthorized|credit back)/i.test(`${subject}\n${text}`);
}

function buildRoutingDraft({ category, playbook }) {
  if (category === "employment_verification") {
    return "Thank you for your request. Employment verification inquiries are handled by our Human Resources team. Please contact HR@SaharaLasVegas.com for assistance.";
  }

  if (category === "lost_and_found") {
    return "Thank you for your message. We will share the item details with our Lost and Found team and follow up after they review it.";
  }

  return `Thank you for your message. We have shared it with our ${getRouteLabel(category)} for review and follow-up.`;
}

function buildBillingDraft({ messageText, subject }) {
  if (needsBillingReview(messageText, subject)) {
    return "Thank you for bringing this to our attention. Our billing team will review the details and follow up once the account has been checked.";
  }

  return "Thank you for your request. We will review the stay details and send the requested billing document shortly.";
}

function buildPlaybookAwareLocalDraft({
  channel,
  template,
  messageText,
  facts,
  guestName,
  subject,
  category,
  playbook
}) {
  if (playbook.handlingMode === "human_only") {
    return buildRoutingDraft({ category, playbook });
  }

  if (playbook.handlingMode === "human_triage") {
    return buildRoutingDraft({ category, playbook });
  }

  if (playbook.handlingMode === "human_only_or_acknowledgement") {
    return buildRoutingDraft({ category, playbook });
  }

  if (playbook.handlingMode === "human_only_or_controlled_acknowledgement") {
    return buildRoutingDraft({ category, playbook });
  }

  if (playbook.handlingMode === "automate_routing") {
    return buildRoutingDraft({ category, playbook });
  }

  if (category === "billing_and_receipts") {
    return buildBillingDraft({ messageText, subject });
  }

  return buildLocalDraft({ channel, template, messageText, facts, guestName, subject });
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
    category,
    playbook
  });

  if (!config.openai.apiKey) {
    return { draft: fallbackDraft, provider: "local-template" };
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
    return { draft, provider: "openai" };
  } catch (error) {
    return {
      draft: fallbackDraft,
      provider: "local-template",
      generatorError: error.message
    };
  }
}
