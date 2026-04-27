import { config } from "../config.js";

function buildAuthHeader() {
  if (process.env.ZINGLE_TOKEN) {
    return `Bearer ${process.env.ZINGLE_TOKEN}`;
  }
  if (config.zingle.username && config.zingle.password) {
    return `Basic ${Buffer.from(`${config.zingle.username}:${config.zingle.password}`, "utf8").toString("base64")}`;
  }
  return "";
}

function toEpoch(value) {
  if (!value) {
    return "";
  }
  if (/^\d+$/.test(String(value))) {
    return String(value);
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? String(ms) : "";
}

async function getJson(url) {
  const auth = buildAuthHeader();
  if (!auth) {
    throw new Error("Missing Zingle auth");
  }

  const response = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: "application/json"
    }
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Zingle returned non-JSON response (${response.status})`);
  }
  if (!response.ok) {
    const message = data?.status?.description || data?.status?.text || response.statusText;
    throw new Error(`Zingle request failed (${response.status}): ${message}`);
  }
  return data;
}

export function normalizeZingleMessage(message = {}) {
  const contact = message.contact || message.guest || message.sender || {};
  const body = message.body || message.text || message.message || message.content || "";
  return {
    event_id: message.id || message.message_id || message.event_id || "",
    thread_id: message.thread_id || message.conversation_id || message.contact_id || contact.id || "",
    provider: "zingle",
    contact: {
      id: contact.id || message.contact_id || "",
      name: contact.name || contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(" "),
      email: contact.email || "",
      phone: contact.phone || contact.phone_number || message.from || ""
    },
    message: {
      id: message.id || message.message_id || "",
      text: body
    },
    created_at: message.created_at || message.createdAt || message.timestamp || ""
  };
}

export async function listInboundZingleMessages({ since, until, pageSize = 100, maxPages = 3 } = {}) {
  if (!config.zingle.serviceId) {
    throw new Error("Missing ZINGLE_SERVICE_ID");
  }

  const baseUrl = config.zingle.baseUrl.replace(/\/$/, "");
  const filters = [];
  const sinceEpoch = toEpoch(since);
  const untilEpoch = toEpoch(until);
  if (sinceEpoch) {
    filters.push(`greater_than(${sinceEpoch})`);
  }
  if (untilEpoch) {
    filters.push(`less_than(${untilEpoch})`);
  }

  const rows = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= maxPages) {
    const url = new URL(`${baseUrl}/services/${encodeURIComponent(config.zingle.serviceId)}/messages`);
    url.searchParams.set("communication_direction", "inbound");
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set("page", String(page));
    if (filters.length) {
      url.searchParams.set("created_at", filters.join(","));
    }
    const data = await getJson(url.toString());
    totalPages = Number(data?.status?.total_pages || 1);
    rows.push(...(Array.isArray(data?.result) ? data.result : []));
    page += 1;
  }
  return rows;
}
