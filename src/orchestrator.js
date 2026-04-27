import { config } from "./config.js";
import { classifyIntent, detectUrgency } from "./services/intent.js";
import { deriveLiveCategory, resolveOperationalPlaybook } from "./services/automation-playbook.js";
import { retrieveFacts } from "./services/retrieval.js";
import { getTemplate } from "./services/templates.js";
import { generateDraft } from "./services/generator.js";
import { validateDraft } from "./services/guardrails.js";
import { canAutoSend, scoreConfidence } from "./services/confidence.js";
import { renderSuggestion } from "./services/renderers.js";

function buildContact(input = {}) {
  return {
    id: input.id || "",
    name: input.name || input.full_name || input.fullName || "",
    email: input.email || "",
    phone: input.phone || input.channel_value || input.phone_number || ""
  };
}

export function normalizeSmsEvent(payload = {}) {
  return {
    channel: "sms",
    sourceEventId: payload.event_id || payload.eventId || payload.message_id || payload.messageId || "",
    threadId: payload.thread_id || payload.threadId || payload.contact_id || payload.contactId || "",
    contact: buildContact(payload.guest || payload.contact || payload.sender || {}),
    subject: "",
    messageText: payload.message?.text || payload.body || "",
    recentThreadSummary: payload.recent_thread_summary || payload.recentThreadSummary || "",
    metadata: {
      provider: payload.provider || "sandbox-sms",
      messageId: payload.message?.id || payload.message_id || payload.messageId || ""
    }
  };
}

export function normalizeEmailEvent(payload = {}) {
  return {
    channel: "email",
    sourceEventId: payload.event_id || payload.eventId || payload.email_id || payload.emailId || "",
    threadId: payload.thread_id || payload.threadId || payload.conversation_id || payload.conversationId || "",
    contact: buildContact(payload.contact || payload.sender || payload.guest || {}),
    subject: payload.email?.subject || payload.subject || "",
    messageText: payload.email?.body || payload.body || payload.message?.text || "",
    recentThreadSummary: payload.recent_thread_summary || payload.recentThreadSummary || "",
    metadata: {
      provider: payload.provider || "sandbox-email",
      emailId: payload.email?.id || payload.email_id || payload.emailId || ""
    }
  };
}

function validateEnvelope(envelope) {
  if (!envelope.messageText || typeof envelope.messageText !== "string") {
    return "Expected normalized messageText as non-empty string";
  }
  if (!envelope.channel || !["sms", "email"].includes(envelope.channel)) {
    return "Expected normalized channel of sms or email";
  }
  return null;
}

export async function processInboundConversation(envelope) {
  const error = validateEnvelope(envelope);
  if (error) {
    throw new Error(error);
  }

  const combinedText = `${envelope.subject || ""}\n${envelope.messageText}`;
  const intent = classifyIntent(combinedText);
  const category = deriveLiveCategory({
    intent,
    subject: envelope.subject,
    messageText: envelope.messageText
  });
  const playbook = resolveOperationalPlaybook({
    category,
    intent,
    subject: envelope.subject,
    messageText: envelope.messageText
  });
  const urgency = detectUrgency(combinedText);
  const facts = retrieveFacts({ intent });
  const template = getTemplate(intent);

  const generation = await generateDraft({
    channel: envelope.channel,
    template,
    messageText: envelope.messageText,
    intent,
    urgency,
    facts,
    guestName: envelope.contact.name,
    recentThreadSummary: envelope.recentThreadSummary,
    subject: envelope.subject,
    category,
    playbook
  });

  const guardrail = validateDraft({
    intent,
    urgency,
    draft: generation.draft,
    handlingMode: playbook.handlingMode
  });

  const confidence = scoreConfidence({
    intent,
    urgency,
    factCount: facts.length,
    guardrailIssues: guardrail.issues,
    handlingMode: playbook.handlingMode,
    messageText: envelope.messageText,
    category
  });

  const escalate = guardrail.requiresEscalation || confidence < 0.6 || !guardrail.isSafe;
  const autoSendEligible = canAutoSend({
    appEnv: config.appEnv,
    allowProdAutosend: config.allowProdAutosend,
    intent,
    confidence,
    requiresEscalation: escalate,
    handlingMode: playbook.handlingMode
  });

  return {
    event_id: envelope.sourceEventId,
    thread_id: envelope.threadId,
    app_env: config.appEnv,
    channel: envelope.channel,
    decision: {
      intent,
      category,
      handling_mode: playbook.handlingMode,
      urgency,
      confidence,
      escalate,
      auto_send_eligible: autoSendEligible
    },
    suggestion: {
      ...renderSuggestion({
        envelope,
        draft: generation.draft,
        intent
      }),
      action_checklist: generation.actionChecklist || [],
      action_checklist_provider: generation.checklistProvider || "heuristic",
      provider: generation.provider,
      mode: "preview"
    },
    evidence: {
      facts,
      playbook
    },
    diagnostics: {
      guardrail_issues: guardrail.issues,
      generator_error: generation.generatorError || null,
      checklist_error: generation.checklistError || null
    }
  };
}
