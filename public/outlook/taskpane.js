let currentMessage = null;
let currentDraft = null;
let selectedAuditDecision = "";

const statusPill = document.querySelector("#statusPill");
const messageMeta = document.querySelector("#messageMeta");
const messageSubject = document.querySelector("#messageSubject");
const generateButton = document.querySelector("#generateDraft");
const insertButton = document.querySelector("#insertDraft");
const openReplyButton = document.querySelector("#openReply");
const checklistEl = document.querySelector("#checklist");
const confidenceEl = document.querySelector("#confidence");
const draftVariant = document.querySelector("#draftVariant");
const draftSubject = document.querySelector("#draftSubject");
const draftBody = document.querySelector("#draftBody");
const auditNotes = document.querySelector("#auditNotes");
const submitAudit = document.querySelector("#submitAudit");

Office.onReady(async () => {
  generateButton.addEventListener("click", generateDraft);
  insertButton.addEventListener("click", insertDraftIntoCompose);
  openReplyButton.addEventListener("click", openReplyWithDraft);
  draftVariant.addEventListener("change", applyDraftVariant);
  submitAudit.addEventListener("click", submitAuditFeedback);
  for (const button of document.querySelectorAll(".auditChoice")) {
    button.addEventListener("click", () => selectAuditDecision(button.dataset.decision));
  }
  await loadCurrentMessage();
});

function setStatus(label) {
  statusPill.textContent = label;
}

function asyncOffice(callback) {
  return new Promise((resolve, reject) => {
    callback((result) => {
      if (result.status === Office.AsyncResultStatus.Succeeded) {
        resolve(result.value);
      } else {
        reject(new Error(result.error?.message || "Office request failed"));
      }
    });
  });
}

function getSender(item) {
  const from = item.from || item.sender || {};
  return {
    name: from.displayName || "",
    email: from.emailAddress || ""
  };
}

async function getItemBody(item) {
  if (!item.body?.getAsync) {
    return "";
  }
  return asyncOffice((done) => item.body.getAsync(Office.CoercionType.Text, done));
}

async function getItemSubject(item) {
  if (typeof item.subject === "string") {
    return item.subject;
  }
  if (item.subject?.getAsync) {
    return asyncOffice((done) => item.subject.getAsync(done));
  }
  return "";
}

async function loadCurrentMessage() {
  const item = Office.context.mailbox.item;
  if (!item) {
    setStatus("No item");
    return;
  }

  setStatus("Loading");
  const body = await getItemBody(item);
  const subject = await getItemSubject(item);
  currentMessage = {
    item_id: item.itemId || "",
    internet_message_id: item.internetMessageId || "",
    conversation_id: item.conversationId || "",
    subject,
    body,
    sender: getSender(item),
    actor: {
      mailbox: Office.context.mailbox.userProfile?.emailAddress || "",
      display_name: Office.context.mailbox.userProfile?.displayName || ""
    }
  };

  messageMeta.textContent = [currentMessage.sender.name, currentMessage.sender.email].filter(Boolean).join(" · ") || "Current Outlook message";
  messageSubject.textContent = currentMessage.subject || "(no subject)";
  setStatus("Ready");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.message || text || `${response.status} request failed`);
  }
  return payload;
}

async function generateDraft() {
  if (!currentMessage) {
    await loadCurrentMessage();
  }
  setStatus("Drafting");
  generateButton.disabled = true;
  try {
    currentDraft = await fetchJson("/api/outlook/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentMessage)
    });
    renderDraft(currentDraft);
    await audit("draft_viewed", { item_id: currentDraft.item_id });
    setStatus("Drafted");
  } catch (error) {
    setStatus("Error");
    checklistEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  } finally {
    generateButton.disabled = false;
  }
}

function renderDraft(draft) {
  const options = Array.isArray(draft.draft_options) && draft.draft_options.length ? draft.draft_options : [draft.draft_body || ""];
  draftVariant.disabled = options.length < 2;
  draftVariant.innerHTML = options.map((_option, index) => `<option value="${index}">Draft ${index === 0 ? "A" : "B"}</option>`).join("");
  draftSubject.value = draft.draft_subject || "";
  draftBody.value = options[0] || "";
  confidenceEl.textContent = `${draft.category || "uncategorized"} · ${Math.round(Number(draft.confidence || 0) * 100)}%`;
  renderChecklist(draft.action_checklist || []);
  insertButton.disabled = false;
  openReplyButton.disabled = false;
  submitAudit.disabled = false;
}

function renderChecklist(items) {
  if (!items.length) {
    checklistEl.innerHTML = `<div class="empty">No checklist returned.</div>`;
    return;
  }
  checklistEl.innerHTML = items
    .map(
      (item, index) => `
        <label class="todo">
          <input type="checkbox" data-check-index="${index}" />
          <span>${escapeHtml(item.label || "")}${item.required === false ? "" : " *"}</span>
        </label>
      `
    )
    .join("");
  for (const checkbox of checklistEl.querySelectorAll("[data-check-index]")) {
    checkbox.addEventListener("change", () => {
      const task = currentDraft.action_checklist[Number(checkbox.dataset.checkIndex)];
      if (task) {
        task.done = checkbox.checked;
      }
      audit("checklist_updated", {
        item_id: currentDraft.item_id,
        action_checklist: currentDraft.action_checklist
      });
    });
  }
}

function applyDraftVariant() {
  if (!currentDraft) {
    return;
  }
  const index = Number(draftVariant.value || 0);
  const options = Array.isArray(currentDraft.draft_options) ? currentDraft.draft_options : [];
  draftBody.value = options[index] || currentDraft.draft_body || "";
  audit("draft_variant_selected", {
    item_id: currentDraft.item_id,
    variant: index === 0 ? "a" : "b"
  });
}

async function insertDraftIntoCompose() {
  const item = Office.context.mailbox.item;
  if (!item?.body?.setSelectedDataAsync) {
    setStatus("Use reply");
    return;
  }
  setStatus("Inserting");
  const html = toHtml(draftBody.value);
  await asyncOffice((done) => item.body.setSelectedDataAsync(html, { coercionType: Office.CoercionType.Html }, done));
  await audit("draft_inserted", currentAuditPayload());
  setStatus("Inserted");
}

async function openReplyWithDraft() {
  const item = Office.context.mailbox.item;
  if (!item?.displayReplyForm) {
    await insertDraftIntoCompose();
    return;
  }
  item.displayReplyForm({
    htmlBody: toHtml(draftBody.value)
  });
  await audit("reply_opened_with_draft", currentAuditPayload());
  setStatus("Reply open");
}

function selectAuditDecision(decision) {
  selectedAuditDecision = decision;
  for (const button of document.querySelectorAll(".auditChoice")) {
    button.classList.toggle("active", button.dataset.decision === decision);
  }
}

async function submitAuditFeedback() {
  await audit("review_feedback_submitted", {
    ...currentAuditPayload(),
    review_decision: selectedAuditDecision,
    review_justification: auditNotes.value || ""
  });
  setStatus("Audited");
}

function currentAuditPayload() {
  return {
    item_id: currentDraft?.item_id || "",
    outlook_item_id: currentMessage?.item_id || "",
    conversation_id: currentMessage?.conversation_id || "",
    subject: currentMessage?.subject || "",
    sender: currentMessage?.sender || {},
    selected_variant: draftVariant.value === "1" ? "b" : "a",
    draft_subject: draftSubject.value || "",
    draft_body: draftBody.value || "",
    action_checklist: currentDraft?.action_checklist || []
  };
}

async function audit(eventType, payload) {
  try {
    await fetchJson("/api/outlook/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: eventType,
        actor: currentMessage?.actor || {},
        payload
      })
    });
  } catch {
    // Audit is best effort in the task pane; server logs still capture route failures.
  }
}

function toHtml(text) {
  return escapeHtml(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
