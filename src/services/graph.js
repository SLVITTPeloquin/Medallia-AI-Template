import fs from "node:fs/promises";
import crypto from "node:crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { config } from "../config.js";

class GraphAuthRequiredError extends Error {
  constructor(message, prompt = null) {
    super(message);
    this.name = "GraphAuthRequiredError";
    this.code = "graph_auth_required";
    this.prompt = prompt;
  }
}

const pendingAuthStates = new Map();

function getAuthority() {
  const base = config.email.graph.authorityUrl.replace(/\/$/, "");
  const tenant = config.email.graph.tenantId;
  if (!tenant) {
    throw new Error("Missing MS_GRAPH_TENANT_ID");
  }
  return `${base}/${tenant}`;
}

function getScopes() {
  const raw = config.email.graph.scopes || "";
  const scopes = raw
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!scopes.length) {
    throw new Error("Missing MS_GRAPH_SCOPES");
  }

  return scopes;
}

function getRedirectUri() {
  const uri = String(config.email.graph.redirectUri || "").trim();
  if (!uri) {
    throw new Error("Missing MS_GRAPH_REDIRECT_URI");
  }
  return uri;
}

function assertAuthCodeConfig() {
  if (!config.email.graph.clientId) {
    throw new Error("Missing MS_GRAPH_CLIENT_ID");
  }
  if (!config.email.graph.clientSecret) {
    throw new Error("Missing MS_GRAPH_CLIENT_SECRET");
  }
  if (!config.email.graph.redirectUri) {
    throw new Error("Missing MS_GRAPH_REDIRECT_URI");
  }
}

async function readCache() {
  try {
    return await fs.readFile(config.email.graph.tokenCachePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function writeCache(serializedCache) {
  await fs.writeFile(config.email.graph.tokenCachePath, serializedCache, "utf8");
}

async function createMsalClient() {
  assertAuthCodeConfig();

  const client = new ConfidentialClientApplication({
    auth: {
      clientId: config.email.graph.clientId,
      clientSecret: config.email.graph.clientSecret,
      authority: getAuthority()
    }
  });

  const tokenCache = client.getTokenCache();
  const serializedCache = await readCache();
  if (serializedCache) {
    try {
      tokenCache.deserialize(serializedCache);
    } catch {
      try {
        await fs.writeFile(`${config.email.graph.tokenCachePath}.corrupt`, serializedCache, "utf8");
      } catch {
        // Best-effort backup only.
      }
      await writeCache("");
    }
  }

  return client;
}

async function persistMsalCache(client) {
  try {
    await writeCache(client.getTokenCache().serialize());
  } catch {
    // continue without persisting
  }
}

function buildStateValue() {
  return crypto.randomBytes(16).toString("hex");
}

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, entry] of pendingAuthStates.entries()) {
    if (entry.expiresAt <= now) {
      pendingAuthStates.delete(key);
    }
  }
}

async function getCachedGraphAccessToken() {
  const client = await createMsalClient();
  const scopes = getScopes();
  const tokenCache = client.getTokenCache();
  const cachedAccounts = await tokenCache.getAllAccounts();
  const preferredAccount =
    cachedAccounts.find((account) => account.username === config.email.graph.loginHint) ||
    cachedAccounts[0] ||
    null;

  if (!preferredAccount) {
    return null;
  }

  try {
    const silentResult = await client.acquireTokenSilent({
      account: preferredAccount,
      scopes
    });
    if (!silentResult?.accessToken) {
      return null;
    }
    await persistMsalCache(client);
    return silentResult.accessToken;
  } catch {
    return null;
  }
}

export async function getGraphAccessToken() {
  const token = await getCachedGraphAccessToken();
  if (token) {
    return token;
  }
  throw new GraphAuthRequiredError("Microsoft Graph sign-in is required before syncing email.", {
    method: "auth_code",
    message: "Click Email Login to sign in with Microsoft."
  });
}

export async function beginGraphAuthCodeLogin() {
  const cachedToken = await getCachedGraphAccessToken();
  if (cachedToken) {
    return { status: "authenticated", url: null };
  }

  cleanupExpiredStates();
  const client = await createMsalClient();
  const state = buildStateValue();
  pendingAuthStates.set(state, {
    createdAt: Date.now(),
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const url = await client.getAuthCodeUrl({
    scopes: getScopes(),
    redirectUri: getRedirectUri(),
    state,
    prompt: "select_account"
  });

  return {
    status: "redirect",
    url
  };
}

export async function completeGraphAuthCodeLogin({ code, state }) {
  if (!code) {
    throw new Error("Missing authorization code");
  }
  if (!state) {
    throw new Error("Missing OAuth state");
  }

  cleanupExpiredStates();
  const stateEntry = pendingAuthStates.get(state);
  if (!stateEntry) {
    throw new Error("Invalid or expired OAuth state");
  }
  pendingAuthStates.delete(state);

  const client = await createMsalClient();
  const result = await client.acquireTokenByCode({
    code,
    redirectUri: getRedirectUri(),
    scopes: getScopes()
  });

  if (!result?.accessToken) {
    throw new Error("Failed to complete Microsoft sign-in");
  }

  await persistMsalCache(client);
  return { status: "authenticated" };
}

export async function getGraphAuthStatus() {
  try {
    const cachedToken = await getCachedGraphAccessToken();
    if (cachedToken) {
      return { status: "authenticated", prompt: null };
    }
  } catch (error) {
    return {
      status: "failed",
      prompt: null,
      error: error.message || "Graph auth configuration error"
    };
  }

  cleanupExpiredStates();
  if (pendingAuthStates.size > 0) {
    return {
      status: "pending",
      prompt: {
        method: "auth_code",
        message: "Microsoft sign-in window is open. Complete login to continue."
      }
    };
  }

  return {
    status: "not_authenticated",
    prompt: {
      method: "auth_code",
      message: "Click Email Login to sign in with Microsoft."
    }
  };
}

export function isGraphAuthRequiredError(error) {
  return error?.code === "graph_auth_required";
}

function getMailboxResource() {
  const mailbox = config.email.mailbox.trim();
  if (!mailbox || mailbox.toLowerCase() === "me") {
    return { path: "me", label: mailbox || "me" };
  }
  return { path: `users/${encodeURIComponent(mailbox)}`, label: mailbox };
}

async function graphJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      Prefer: 'outlook.body-content-type="text"'
    }
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Graph endpoint returned non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`Graph request failed (${response.status}): ${data.error?.message || "unknown_error"}`);
  }

  return data;
}

export async function listRecentGraphMessages({ top = 10 } = {}) {
  const token = await getGraphAccessToken();
  const mailbox = getMailboxResource();
  const url = new URL(`https://graph.microsoft.com/v1.0/${mailbox.path}/messages`);
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$select", "id,conversationId,subject,bodyPreview,from,receivedDateTime");
  url.searchParams.set("$orderby", "receivedDateTime desc");

  const data = await graphJson(url.toString(), token);
  return data.value || [];
}

export async function listGraphMessages({
  folder = "inbox",
  top = 50,
  maxPages = 1,
  since,
  until,
  select,
  orderBy,
  allowDeviceCode = true
} = {}) {
  const token = await getCachedGraphAccessToken();
  if (!token) {
    const status = await getGraphAuthStatus();
    throw new GraphAuthRequiredError("Microsoft Graph sign-in is required before syncing email.", status.prompt || null);
  }
  const mailbox = getMailboxResource();
  const fields =
    select ||
    [
      "id",
      "conversationId",
      "subject",
      "body",
      "bodyPreview",
      "from",
      "sender",
      "toRecipients",
      "ccRecipients",
      "receivedDateTime",
      "sentDateTime",
      "createdDateTime",
      "internetMessageId",
      "isDraft"
    ].join(",");
  const sort = orderBy || (folder.toLowerCase() === "sentitems" ? "sentDateTime desc" : "receivedDateTime desc");

  const url = new URL(`https://graph.microsoft.com/v1.0/${mailbox.path}/mailFolders/${encodeURIComponent(folder)}/messages`);
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$select", fields);
  url.searchParams.set("$orderby", sort);

  const field = folder.toLowerCase() === "sentitems" ? "sentDateTime" : "receivedDateTime";
  const filters = [];
  if (since) {
    filters.push(`${field} ge ${new Date(since).toISOString()}`);
  }
  if (until) {
    filters.push(`${field} lt ${new Date(until).toISOString()}`);
  }
  if (filters.length) {
    url.searchParams.set("$filter", filters.join(" and "));
  }

  const items = [];
  let nextUrl = url.toString();
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    const data = await graphJson(nextUrl, token);
    items.push(...(data.value || []));
    nextUrl = data["@odata.nextLink"] || "";
    pageCount += 1;
  }

  return items;
}

export async function listGraphMailboxMessages({
  top = 50,
  maxPages = 1,
  since,
  until,
  select,
  orderBy
} = {}) {
  const token = await getGraphAccessToken();
  const mailbox = getMailboxResource();
  const fields =
    select ||
    [
      "id",
      "conversationId",
      "subject",
      "body",
      "bodyPreview",
      "from",
      "sender",
      "toRecipients",
      "ccRecipients",
      "receivedDateTime",
      "sentDateTime",
      "createdDateTime",
      "internetMessageId",
      "isDraft",
      "parentFolderId"
    ].join(",");
  const sort = orderBy || "receivedDateTime desc";

  const url = new URL(`https://graph.microsoft.com/v1.0/${mailbox.path}/messages`);
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$select", fields);
  url.searchParams.set("$orderby", sort);

  const filters = [];
  if (since) {
    const sinceIso = new Date(since).toISOString();
    filters.push(`((receivedDateTime ge ${sinceIso}) or (sentDateTime ge ${sinceIso}))`);
  }
  if (until) {
    const untilIso = new Date(until).toISOString();
    filters.push(`((receivedDateTime lt ${untilIso}) or (sentDateTime lt ${untilIso}))`);
  }
  if (filters.length) {
    url.searchParams.set("$filter", filters.join(" and "));
  }

  const items = [];
  let nextUrl = url.toString();
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    const data = await graphJson(nextUrl, token);
    items.push(...(data.value || []));
    nextUrl = data["@odata.nextLink"] || "";
    pageCount += 1;
  }

  return items;
}

export function normalizeGraphMessage(message) {
  return {
    event_id: message.id,
    thread_id: message.conversationId || "",
    contact: {
      id: message.from?.emailAddress?.address || "",
      name: message.from?.emailAddress?.name || "",
      email: message.from?.emailAddress?.address || ""
    },
    email: {
      id: message.id,
      subject: message.subject || "",
      body: message.body?.content || message.bodyPreview || "",
      received_at: message.receivedDateTime || message.sentDateTime || message.createdDateTime || ""
    },
    recent_thread_summary: "",
    provider: "microsoft-graph"
  };
}

function normalizeAddress(value = "") {
  return String(value || "").trim().toLowerCase();
}

function messageAddresses(message = {}) {
  const from = normalizeAddress(message.from?.emailAddress?.address || message.sender?.emailAddress?.address || "");
  const to = Array.isArray(message.toRecipients)
    ? message.toRecipients.map((entry) => normalizeAddress(entry?.emailAddress?.address || "")).filter(Boolean)
    : [];
  const cc = Array.isArray(message.ccRecipients)
    ? message.ccRecipients.map((entry) => normalizeAddress(entry?.emailAddress?.address || "")).filter(Boolean)
    : [];
  return { from, to, cc };
}

export async function listGraphCorrespondenceWithSender({
  senderEmail,
  perFolderTop = 50,
  perFolderMaxPages = 12,
  maxResults = 120
} = {}) {
  const target = normalizeAddress(senderEmail);
  if (!target) {
    return [];
  }

  const [inboxMessages, sentMessages] = await Promise.all([
    listGraphMessages({
      folder: "inbox",
      top: perFolderTop,
      maxPages: perFolderMaxPages,
      allowDeviceCode: false
    }),
    listGraphMessages({
      folder: "sentitems",
      top: perFolderTop,
      maxPages: perFolderMaxPages,
      allowDeviceCode: false
    })
  ]);

  const combined = [...inboxMessages, ...sentMessages];
  const filtered = combined.filter((message) => {
    const addresses = messageAddresses(message);
    return addresses.from === target || addresses.to.includes(target) || addresses.cc.includes(target);
  });

  filtered.sort((a, b) => Date.parse(b.receivedDateTime || b.sentDateTime || b.createdDateTime || 0) - Date.parse(a.receivedDateTime || a.sentDateTime || a.createdDateTime || 0));
  return filtered.slice(0, Math.max(1, Number(maxResults) || 120));
}
