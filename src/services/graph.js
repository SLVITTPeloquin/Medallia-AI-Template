import fs from "node:fs/promises";
import { PublicClientApplication } from "@azure/msal-node";
import { config } from "../config.js";

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
  if (!config.email.graph.clientId) {
    throw new Error("Missing MS_GRAPH_CLIENT_ID");
  }

  const client = new PublicClientApplication({
    auth: {
      clientId: config.email.graph.clientId,
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
    // If cache serialization fails, continue without persisting.
    // The current access token may still be valid for this run.
  }
}

export async function getGraphAccessToken() {
  const client = await createMsalClient();
  const scopes = getScopes();
  const tokenCache = client.getTokenCache();
  const cachedAccounts = await tokenCache.getAllAccounts();
  const preferredAccount =
    cachedAccounts.find((account) => account.username === config.email.graph.loginHint) ||
    cachedAccounts[0] ||
    null;

  if (preferredAccount) {
    try {
      const silentResult = await client.acquireTokenSilent({
        account: preferredAccount,
        scopes
      });

      if (silentResult?.accessToken) {
        await persistMsalCache(client);
        return silentResult.accessToken;
      }
    } catch {
      // Fall through to device-code login when the cached token cannot be refreshed.
    }
  }

  const deviceCodeResult = await client.acquireTokenByDeviceCode({
    scopes,
    deviceCodeCallback(response) {
      console.error(`[graph-auth] ${response.message}`);
    }
  });

  if (!deviceCodeResult?.accessToken) {
    throw new Error("Failed to acquire delegated Microsoft Graph access token");
  }

  await persistMsalCache(client);
  return deviceCodeResult.accessToken;
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
