let items = [];
let selectedId = "";

const metrics = document.querySelector("#metrics");
const banner = document.querySelector("#banner");
const progress = document.querySelector("#progress");
const queueList = document.querySelector("#queueList");
const detail = document.querySelector("#detail");
const sourceFilter = document.querySelector("#sourceFilter");

document.querySelector("#loginEmail").addEventListener("click", startEmailLogin);
document.querySelector("#pollEmail").addEventListener("click", () => poll("email"));
document.querySelector("#pollZingle").addEventListener("click", () => poll("zingle"));
sourceFilter.addEventListener("change", load);

await load();
await refreshEmailAuthStatus();
setInterval(load, 30000);
setInterval(refreshEmailAuthStatus, 20000);

async function load() {
  const source = sourceFilter.value;
  const [summary, itemPayload] = await Promise.all([
    fetchJson("/api/review/summary"),
    fetchJson(`/api/review/items${source ? `?source=${encodeURIComponent(source)}` : ""}`)
  ]);
  items = itemPayload.items || [];
  renderMetrics(summary);
  renderQueue();
  if (selectedId) {
    const selected = items.find((item) => item.id === selectedId);
    if (selected) {
      renderDetail(selected);
    }
  }
}

function renderMetrics(summary) {
  const rows = [
    ["Total", summary.total],
    ["New", summary.new],
    ["Ready", summary.ready],
    ["High priority", summary.high_priority],
    ["Email", summary.email],
    ["Zingle", summary.zingle]
  ];
  metrics.innerHTML = rows.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value || 0}</strong></div>`).join("");
}

function renderQueue() {
  queueList.innerHTML = items
    .map((item) => {
      const active = item.id === selectedId ? " active" : "";
      return `
        <button class="queueItem${active}" data-id="${escapeHtml(item.id)}">
          <div class="rowTop">
            <span class="badge ${escapeHtml(item.source)}">${escapeHtml(item.source)}</span>
            <span class="badge ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span>
          </div>
          <div class="subject">${escapeHtml(item.subject || item.inbound_body.slice(0, 80) || "Untitled")}</div>
          <div class="meta">${escapeHtml(item.sender_email || item.sender_phone || item.sender_name || "Unknown sender")}</div>
          <div class="meta">${formatTimestamp(item.received_at)} · ${escapeHtml(item.category)} · ${(Number(item.confidence || 0) * 100).toFixed(2)}%</div>
        </button>
      `;
    })
    .join("");

  for (const button of queueList.querySelectorAll(".queueItem")) {
    button.addEventListener("click", () => {
      selectedId = button.dataset.id;
      const selected = items.find((item) => item.id === selectedId);
      renderQueue();
      renderDetail(selected);
    });
  }
}

function renderDetail(item) {
  const checklist = Array.isArray(item.action_checklist) ? item.action_checklist : [];
  const canSend = Boolean(item.can_send);
  const categoryReview = item.category_review || "pending";
  detail.innerHTML = `
    <div class="detailGrid">
      <section class="panel">
        <h3>Incoming</h3>
        <p class="meta">${escapeHtml(item.received_at)} · ${escapeHtml(item.sender_email || item.sender_phone || item.sender_name)}</p>
        <p><span class="badge ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span> <span class="badge">${escapeHtml(item.handling_mode)}</span></p>
        <div class="inbound">${escapeHtml(item.inbound_body)}</div>
      </section>
      <section class="panel">
        <h3>Review Markers</h3>
        <div class="markers">
          ${(item.review_markers || []).map((marker) => `<div class="marker">${escapeHtml(marker)}</div>`).join("")}
        </div>
      </section>
      <section class="panel">
        <h3>To Do: Action</h3>
        <div class="markers">
          ${checklist
            .map(
              (task, index) => `
              <label class="todo">
                <input type="checkbox" data-check-index="${index}" ${task.done ? "checked" : ""} />
                <span>${escapeHtml(task.label)}${task.required ? " *" : ""}</span>
              </label>
            `
            )
            .join("")}
        </div>
      </section>
      <section class="panel">
        <h3>Draft</h3>
        <input class="draftSubject" id="draftSubject" value="${escapeAttr(item.draft_subject || "")}" />
        <textarea class="draftEditor" id="draftBody">${escapeHtml(item.draft_body || "")}</textarea>
        <div class="toolbar">
          <button id="saveDraft">Save Draft</button>
          <button class="secondary" data-status="ready">Mark Ready</button>
          <button class="secondary" data-status="in_review">Needs Review</button>
          <button id="sendDraft" ${canSend ? "" : "disabled"}>Send Draft</button>
        </div>
      </section>
      <section class="panel">
        <h3>Classification</h3>
        <p><strong>Category:</strong> ${escapeHtml(item.category)}</p>
        <p><strong>Intent:</strong> ${escapeHtml(item.intent)}</p>
        <p><strong>Confidence:</strong> ${(Number(item.confidence || 0) * 100).toFixed(2)}%</p>
        <p><strong>Status:</strong> ${escapeHtml(item.status)}</p>
        <div class="toolbar">
          <button class="${categoryReview === "yes" ? "" : "secondary"}" data-category-review="yes">Category Yes</button>
          <button class="${categoryReview === "no" ? "" : "secondary"}" data-category-review="no">Category No</button>
        </div>
        <textarea class="draftEditor" id="categoryReviewNotes" placeholder="Category review notes">${escapeHtml(item.category_review_notes || "")}</textarea>
        <textarea class="draftEditor" id="notes" placeholder="Reviewer notes">${escapeHtml(item.notes || "")}</textarea>
      </section>
    </div>
  `;

  document.querySelector("#saveDraft").addEventListener("click", () => saveItem(item.id));
  document.querySelector("#sendDraft").addEventListener("click", () => sendItem(item.id));
  for (const button of detail.querySelectorAll("[data-status]")) {
    button.addEventListener("click", () => saveItem(item.id, button.dataset.status));
  }
  for (const button of detail.querySelectorAll("[data-category-review]")) {
    button.addEventListener("click", () => saveItem(item.id, undefined, button.dataset.categoryReview));
  }
  for (const checkbox of detail.querySelectorAll("[data-check-index]")) {
    checkbox.addEventListener("change", () => saveItem(item.id));
  }
}

async function saveItem(id, status, categoryReview) {
  const source = items.find((item) => item.id === id);
  const existingChecklist = Array.isArray(source?.action_checklist) ? source.action_checklist : [];
  const payload = {
    draft_subject: document.querySelector("#draftSubject")?.value || "",
    draft_body: document.querySelector("#draftBody")?.value || "",
    notes: document.querySelector("#notes")?.value || "",
    category_review_notes: document.querySelector("#categoryReviewNotes")?.value || "",
    action_checklist: existingChecklist.map((task, index) => ({
      ...task,
      done: Boolean(document.querySelector(`[data-check-index="${index}"]`)?.checked)
    }))
  };
  if (status) {
    payload.status = status;
  }
  if (categoryReview) {
    payload.category_review = categoryReview;
  }
  await fetchJson(`/api/review/items/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  await load();
}

async function sendItem(id) {
  await fetchJson(`/api/review/items/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });
  await load();
}

async function poll(source) {
  const endpoint = source === "email" ? "/api/review/poll/email" : "/api/review/poll/zingle";
  const payload =
    source === "email"
      ? { pageSize: 100 }
      : { since: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), top: 50, maxPages: 3, pageSize: 100 };
  let stopProgressPolling = null;
  if (source === "email") {
    renderProgress({ phase: "starting", status_text: "Starting email sync...", progress_current: 0, progress_total: 0 });
    stopProgressPolling = startEmailProgressPolling();
  }
  try {
    await fetchJson(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setBanner("Sync complete.", "ok");
  } catch (error) {
    if (source === "email" && error?.status === 401 && error?.payload?.error === "graph_auth_required") {
      const prompt = error.payload.prompt || {};
      const message = prompt.message
        ? prompt.message
        : "Email sign-in is required. Click Email Login and complete Microsoft sign-in.";
      setBanner(message, "warn");
      return;
    }
    setBanner(`Sync failed: ${error.message}`, "error");
    throw error;
  } finally {
    if (stopProgressPolling) {
      stopProgressPolling();
      await refreshEmailProgress();
      setTimeout(clearProgress, 3500);
    }
  }
  await load();
  if (source === "email") {
    await refreshEmailAuthStatus();
  }
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
    const error = new Error(`${response.status} ${payload?.message || text || "request_failed"}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function startEmailLogin() {
  const popup = window.open("/api/review/auth/email/start", "_blank", "noopener,noreferrer");
  if (!popup) {
    setBanner("Popup blocked. Allow popups and click Email Login again.", "error");
    return;
  }
  setBanner("Complete Microsoft sign-in in the new window.", "warn");
}

async function refreshEmailAuthStatus() {
  const status = await fetchJson("/api/review/auth/email/status");
  renderAuthBanner(status);
}

function renderAuthBanner(status) {
  if (status?.status === "authenticated") {
    setBanner("Email auth connected.", "ok");
    return;
  }
  if (status?.status === "pending") {
    const prompt = status.prompt || {};
    const details = [prompt.message].filter(Boolean).join(" ");
    setBanner(details || "Email login is pending. Complete Microsoft sign-in in the popup window.", "warn");
    return;
  }
  if (status?.status === "failed") {
    setBanner(`Email auth failed: ${status.error || "unknown error"}`, "error");
    return;
  }
  setBanner("Email auth not connected. Click Email Login before Sync Email.", "warn");
}

function setBanner(message, level) {
  if (!banner) {
    return;
  }
  banner.innerHTML = `<div class="banner banner-${escapeHtml(level || "ok")}">${escapeHtml(message || "")}</div>`;
}

function clearProgress() {
  if (!progress) {
    return;
  }
  progress.innerHTML = "";
}

function renderProgress(status = {}) {
  if (!progress) {
    return;
  }
  const total = Number(status.progress_total || 0);
  const current = Number(status.progress_current || 0);
  const percent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : status.phase === "completed" ? 100 : 5;
  const text = status.status_text || "Working...";
  const counts = total > 0 ? `${current}/${total}` : status.phase === "fetching" ? "fetching..." : "";
  progress.innerHTML = `
    <div class="progressWrap">
      <div class="progressTop">
        <strong>${escapeHtml(text)}</strong>
        <span>${escapeHtml(counts)}</span>
      </div>
      <div class="progressBar">
        <div class="progressFill" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

async function refreshEmailProgress() {
  try {
    const status = await fetchJson("/api/review/poll/email/status");
    if (status?.phase) {
      renderProgress(status);
    }
  } catch {
    // best effort only
  }
}

function startEmailProgressPolling() {
  const timer = setInterval(() => {
    refreshEmailProgress();
  }, 900);
  refreshEmailProgress();
  return () => clearInterval(timer);
}

window.addEventListener("message", async (event) => {
  const data = event?.data || {};
  if (data.type !== "graph_auth_result") {
    return;
  }
  if (data.status === "ok") {
    setBanner("Email auth connected.", "ok");
    await refreshEmailAuthStatus();
    return;
  }
  setBanner(`Email auth failed: ${data.message || "unknown error"}`, "error");
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value = "") {
  return escapeHtml(value).replaceAll("\n", " ");
}

function formatTimestamp(value = "") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "Unknown time";
  }
  return date.toLocaleString();
}
