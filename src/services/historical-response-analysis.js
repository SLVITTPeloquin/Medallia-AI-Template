import { config } from "../config.js";
import fs from "node:fs/promises";
import { listGraphMailboxMessages } from "./graph.js";
import { getCategoryPlaybook, resolveCategoryPlaybookKey } from "./automation-playbook.js";
import { callLlm, extractResponseText } from "./llm-client.js";

const INTERNAL_DOMAIN = "saharalasvegas.com";
const RESPONSE_STYLES = [
  "direct_answer",
  "policy_or_document_request",
  "booking_resolution",
  "empathetic_service_recovery",
  "escalation_or_manual_follow_up",
  "sales_or_partnership_reply",
  "other"
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

function summarizeText(text = "", max = 240) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return compact.length > max ? `${compact.slice(0, max - 3)}...` : compact;
}

function isCustomerFacingResponseText(text = "") {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return false;
  }
  if (compact.length < 25 && /^(ok|thanks|thank you|noted)\b/i.test(compact)) {
    return false;
  }
  if (
    /^(i('| a)?ll handle\b|i will do so\b|we have contacted the guest\b|thank you we will take care of it\b)/i.test(
      compact
    )
  ) {
    return false;
  }
  if (/^(forwarding|fyi|noted|handled)\b/i.test(compact)) {
    return false;
  }
  return true;
}

function getMessageText(message = {}) {
  return htmlToText(message.body?.content || message.bodyPreview || "");
}

function getTimestamp(message = {}) {
  return message.sentDateTime || message.receivedDateTime || message.createdDateTime || "";
}

function classifyParty(address = "") {
  const email = (address || "").toLowerCase();
  if (!email) {
    return "unknown";
  }
  if (email.endsWith(`@${INTERNAL_DOMAIN}`)) {
    return "internal";
  }
  return "external";
}

function normalizeMessage(message = {}) {
  const from = message.from?.emailAddress?.address || message.sender?.emailAddress?.address || "";
  return {
    id: message.id || "",
    conversationId: message.conversationId || "",
    subject: message.subject || "",
    from,
    fromName: message.from?.emailAddress?.name || message.sender?.emailAddress?.name || "",
    to: (message.toRecipients || []).map((entry) => entry.emailAddress?.address).filter(Boolean),
    timestamp: getTimestamp(message),
    text: getMessageText(message),
    folderId: message.parentFolderId || "",
    party: classifyParty(from)
  };
}

function getUsableResponseText(message = null) {
  const text = message?.text || "";
  return isCustomerFacingResponseText(text) ? text : "";
}

function isCustomerInbound(message) {
  if (message.party !== "external") {
    return false;
  }
  const haystack = `${message.subject}\n${message.text}`.toLowerCase();
  return !/(mailer-daemon|postmaster|noreply|no-reply|donotreply)/i.test(message.from) && Boolean(haystack.trim());
}

function buildConversations(messages) {
  const byConversation = new Map();
  for (const message of messages) {
    if (!message.conversationId || !message.text) {
      continue;
    }
    if (!byConversation.has(message.conversationId)) {
      byConversation.set(message.conversationId, []);
    }
    byConversation.get(message.conversationId).push(message);
  }

  for (const conversation of byConversation.values()) {
    conversation.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }

  return byConversation;
}

function buildPairs(conversations) {
  const pairs = [];

  for (const conversation of conversations.values()) {
    const usedResponses = new Set();

    for (let index = 0; index < conversation.length; index += 1) {
      const current = conversation[index];
      if (!isCustomerInbound(current)) {
        continue;
      }

      const response = conversation.find((candidate, candidateIndex) => {
        if (candidateIndex <= index) {
          return false;
        }
        if (candidate.party !== "internal") {
          return false;
        }
        if (usedResponses.has(candidate.id)) {
          return false;
        }
        return Date.parse(candidate.timestamp) >= Date.parse(current.timestamp);
      });

      if (response) {
        usedResponses.add(response.id);
      }

      pairs.push({
        conversationId: current.conversationId,
        inbound: current,
        response: response || null
      });
    }
  }

  return pairs.sort((a, b) => Date.parse(a.inbound.timestamp) - Date.parse(b.inbound.timestamp));
}

async function callJson(prompt) {
  let lastError;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await callLlm({
        input: prompt,
        temperature: 0.1
      });

      if (!response.ok) {
        const body = await response.text();
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw new Error(`LLM error ${response.status}: ${body}`);
      }

      const data = await response.json();
      const text = extractResponseText(data).replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt >= 3) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function deriveSchema(pairs) {
  const sample = pairs.slice(0, 40).map((pair, index) => ({
    id: index + 1,
    subject: pair.inbound.subject,
    sender: pair.inbound.from,
    inbound: summarizeText(pair.inbound.text, 220),
    response: summarizeText(pair.response?.text || "", 180)
  }));

  const prompt = [
    "Create a mailbox-specific schema for analyzing incoming service emails and their human responses.",
    "Return strict JSON only.",
    'JSON shape: {"strategy":"dynamic-openai","summary":"","inbound_categories":[{"name":"","description":""}]}',
    "Rules:",
    "- Use slug_case names.",
    "- Prefer 6 to 12 inbound categories.",
    "- Categories must be broad and stable across this mixed service mailbox.",
    '- Include "other" if needed.',
    `Examples: ${JSON.stringify(sample)}`
  ].join("\n");

  return callJson(prompt);
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function refineHistoricalCategory(category = "", pair = {}) {
  const broadCategory = resolveCategoryPlaybookKey(category);
  const haystack = `${pair.inbound?.subject || ""}\n${pair.inbound?.text || ""}`.toLowerCase();
  const isPartnershipOrMedia =
    /(partnership|collaboration|sponsorship|sponsor|donation|charity|creator|influencer|editorial|media|press|filming|hosted accommodations|talent management|ugc|campaign|marketing)/i.test(
      haystack
    );
  const isSalesOutreach =
    /(domain name|buydomains|proposal for our services|introducing our services|upcoming opportunities|vendor|reseller|outreach)/i.test(
      haystack
    );
  const isTravelTradeOrGroupSales =
    /(travel trade|tour operator|iata|commission|group rate|group booking|quote|proposal|12 single room|room block|wholesale|breakfast inclusion|commissionable)/i.test(
      haystack
    );
  const isBillingDocument =
    /(receipt|invoice|folio|statement|payfolio|bill copy|copy of my bill|electronic invoice)/i.test(haystack) &&
    !/(refund|dispute|charged|chargeback|duplicate charge|unauthorized|credit back|deposit back|not given back)/i.test(
      haystack
    );
  const isBillingDispute =
    /(refund|dispute|charged|chargeback|duplicate charge|unauthorized|credit back|deposit back|not given back|rebate|reembolso)/i.test(
      haystack
    ) || /(bill|billing|invoice|folio|receipt|payment|charge)/i.test(haystack) && /(complaint|issue|problem|wrong|not received|follow up)/i.test(haystack);
  const isReservationChangeOrException =
    /(cancel|cancellation|modify|change|same room|adjoining|upgrade|early check.?in|late check.?out|extend|exception|special request|availability|room request)/i.test(
      haystack
    );
  const isReservationFaq =
    /(reservation|booking|room|stay|check.?in|check.?out|pool|parking|amenity|policy|rate|fee)/i.test(haystack);

  if (isPartnershipOrMedia) {
    return "collaboration_and_partnerships";
  }

  if (isSalesOutreach) {
    return "sales_outreach";
  }

  if (isTravelTradeOrGroupSales) {
    return "group_sales_or_travel_trade";
  }

  if (isBillingDocument) {
    return "billing_documents";
  }

  if (isBillingDispute || broadCategory === "billing_and_receipts") {
    return "billing_disputes_refunds";
  }

  if (isReservationChangeOrException) {
    return "reservation_changes_or_exceptions";
  }

  if (broadCategory === "reservation_inquiries" || isReservationFaq) {
    return "reservation_faq_policy";
  }

  return category;
}

async function classifyPairsBatch(pairs, schema) {
  const items = pairs.map((pair, index) => ({
    id: index,
    inbound_subject: pair.inbound.subject,
    inbound_sender: pair.inbound.from,
    inbound_body: pair.inbound.text,
    human_response_body: getUsableResponseText(pair.response) || "No human response found."
  }));

  const prompt = [
    "Analyze these incoming service emails and their human responses, returning strict JSON only.",
    `Allowed inbound categories: ${schema.inbound_categories.map((item) => item.name).join(", ")}`,
    `Allowed response styles: ${RESPONSE_STYLES.join(", ")}`,
    'JSON shape: {"results":[{"id":0,"inbound_category":"","inbound_summary":"","response_style":"","response_summary":"","automation_candidate":"high|medium|low","reason":""}]}',
    `Category definitions: ${JSON.stringify(schema.inbound_categories)}`,
    `Items: ${JSON.stringify(items)}`
  ].join("\n");

  const parsed = await callJson(prompt);
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return items.map((item) => {
    const match = results.find((entry) => entry.id === item.id);
    return (
      match || {
        id: item.id,
        inbound_category: "other",
        inbound_summary: summarizeText(item.inbound_body, 180),
        response_style: "other",
        response_summary: item.human_response_body === "No human response found." ? "No human response found." : summarizeText(item.human_response_body, 180),
        automation_candidate: "medium",
        reason: "Batch classification returned no result for this item."
      }
    );
  });
}

function getPriorExamples(pairs, currentIndex, currentCategory) {
  const matches = [];
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const pair = pairs[index];
    const usableResponseText = getUsableResponseText(pair.response);
    if (!usableResponseText || pair.analysis.inbound_category !== currentCategory) {
      continue;
    }
    matches.push({
      inbound_subject: pair.inbound.subject,
      inbound_summary: summarizeText(pair.inbound.text, 180),
      human_response: summarizeText(usableResponseText, 220)
    });
    if (matches.length >= 3) {
      break;
    }
  }
  return matches;
}

async function generateSampleResponsesBatch(batch) {
  const items = batch.map((item, index) => ({
    id: index,
    inbound_category: item.pair.analysis.inbound_category,
    handling_mode: item.playbook.handlingMode,
    automation_scope: item.playbook.automationScope,
    approved_response_pattern: item.playbook.approvedResponsePattern,
    category_instructions: item.playbook.instructions,
    forbidden_actions: item.playbook.forbidden,
    inbound_subject: item.pair.inbound.subject,
    inbound_body: item.pair.inbound.text,
    historical_examples: item.priorExamples
  }));

  const prompt = [
    "Draft a sample response for each incoming email using the historical examples as style guidance and the category playbook as the operational guardrail.",
    "Rules:",
    "- Return strict JSON only.",
    '- JSON shape: {"results":[{"id":0,"sample_response":""}]}',
    "- Each sample response should be concise and useful.",
    "- Follow the handling mode and approved response pattern for each item.",
    "- If the playbook implies routing or human review, draft an acknowledgement-and-routing response instead of a full resolution.",
    "- If the historical examples imply uncertainty, avoid overpromising.",
    "- Ground the tone and structure in the historical examples, but do not copy them verbatim.",
    `Items: ${JSON.stringify(items)}`
  ].join("\n");

  const parsed = await callJson(prompt);
  const results = Array.isArray(parsed.results) ? parsed.results : [];
  return items.map((item) => {
    const match = results.find((entry) => entry.id === item.id);
    return typeof match?.sample_response === "string" ? match.sample_response : null;
  });
}

async function appendJsonl(checkpointPath, record) {
  if (!checkpointPath) {
    return;
  }
  await fs.appendFile(checkpointPath, `${JSON.stringify(record)}\n`, "utf8");
}

export async function analyzeHistoricalResponses({
  since = "2026-03-01T00:00:00Z",
  until,
  top = 100,
  maxPages = 50,
  sampleSize = 10,
  generateOnlyForReplied = true,
  classificationBatchSize = 20,
  maxSampleResponses = 25,
  repliedOnly = false,
  checkpointPath = "",
  sampleBatchSize = 10
} = {}) {
  const rawMessages = await listGraphMailboxMessages({ top, maxPages, since, until });
  const normalized = rawMessages.map(normalizeMessage);
  const conversations = buildConversations(normalized);
  const pairs = buildPairs(conversations).filter((pair) => !repliedOnly || pair.response);
  const schema = await deriveSchema(pairs);

  const analyzedPairs = [];
  for (const batch of chunk(pairs, classificationBatchSize)) {
    const analyses = await classifyPairsBatch(batch, schema);
    for (let index = 0; index < batch.length; index += 1) {
      const baseCategory = analyses[index].inbound_category;
      const refinedCategory = refineHistoricalCategory(baseCategory, batch[index]);
      const analyzed = {
        ...batch[index],
        analysis: {
          ...analyses[index],
          base_inbound_category: baseCategory,
          inbound_category: refinedCategory
        }
      };
      analyzedPairs.push(analyzed);
      await appendJsonl(checkpointPath, {
        type: "classification",
        conversation_id: analyzed.conversationId,
        inbound_subject: analyzed.inbound.subject,
        inbound_sender: analyzed.inbound.from,
        analysis: analyzed.analysis
      });
    }
  }

  const sampleWork = [];
  for (let index = 0; index < analyzedPairs.length; index += 1) {
    const pair = analyzedPairs[index];
    const priorExamples = getPriorExamples(analyzedPairs, index, pair.analysis.inbound_category);
    const playbook = getCategoryPlaybook(pair.analysis.inbound_category);
    pair.prior_examples_used = priorExamples;
    pair.playbook = playbook;
    if (generateOnlyForReplied && !pair.response) {
      pair.sample_response = null;
      continue;
    }
    if (sampleWork.length >= maxSampleResponses) {
      pair.sample_response = null;
      continue;
    }
    sampleWork.push({ pair, priorExamples, playbook });
  }

  for (const batch of chunk(sampleWork, sampleBatchSize)) {
    const generated = await generateSampleResponsesBatch(batch);
    for (let index = 0; index < batch.length; index += 1) {
      const item = batch[index];
      item.pair.sample_response = generated[index];
      await appendJsonl(checkpointPath, {
        type: "sample_response",
        conversation_id: item.pair.conversationId,
        inbound_subject: item.pair.inbound.subject,
        inbound_sender: item.pair.inbound.from,
        sample_response: item.pair.sample_response
      });
    }
  }

  const inboundCounts = {};
  const responseStyleCounts = {};
  for (const pair of analyzedPairs) {
    inboundCounts[pair.analysis.inbound_category] = (inboundCounts[pair.analysis.inbound_category] || 0) + 1;
    responseStyleCounts[pair.analysis.response_style] = (responseStyleCounts[pair.analysis.response_style] || 0) + 1;
  }

  return {
    report: {
      mailbox: config.email.mailbox,
      since,
      until: until || null,
      schema,
      totals: {
        mailbox_messages_scanned: normalized.length,
        inbound_messages_analyzed: analyzedPairs.length,
        inbound_with_human_response: analyzedPairs.filter((pair) => pair.response).length,
        sample_responses_generated: analyzedPairs.filter((pair) => pair.sample_response).length,
        replied_only_mode: repliedOnly
      },
      inbound_categories: Object.entries(inboundCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count })),
      response_styles: Object.entries(responseStyleCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => ({ name, count }))
    },
    sample_pairs: analyzedPairs.slice(0, sampleSize).map((pair) => ({
      inbound_subject: pair.inbound.subject,
      inbound_sender: pair.inbound.from,
      category: pair.analysis.inbound_category,
      handling_mode: pair.playbook?.handlingMode || null,
      response_style: pair.analysis.response_style,
      actual_response: pair.response?.text || null,
      sample_response: pair.sample_response
    })),
    analyzed_pairs: analyzedPairs.map((pair) => ({
      conversation_id: pair.conversationId,
      inbound: {
        subject: pair.inbound.subject,
        sender: pair.inbound.from,
        received_at: pair.inbound.timestamp,
        body: pair.inbound.text
      },
      actual_response: pair.response
        ? {
            sender: pair.response.from,
            sent_at: pair.response.timestamp,
            body: pair.response.text,
            usable_for_examples: isCustomerFacingResponseText(pair.response.text)
          }
        : null,
      analysis: pair.analysis,
      playbook: pair.playbook,
      prior_examples_used: pair.prior_examples_used,
      sample_response: pair.sample_response
    }))
  };
}
