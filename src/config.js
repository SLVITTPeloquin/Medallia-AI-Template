import "dotenv/config";
import path from "node:path";

const appEnv = process.env.APP_ENV || "sandbox";
const isProd = appEnv === "production";
const defaultRuntimeDir = process.env.WEBSITE_SITE_NAME ? "/home/medallia-runtime" : path.resolve(process.cwd(), ".runtime");

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  appEnv,
  isProd,
  enforceSandboxOnly: process.env.ENFORCE_SANDBOX_ONLY !== "false",
  allowProdAutosend: process.env.ALLOW_PROD_AUTOSEND === "true",
  runtimeDir: process.env.RUNTIME_DIR || defaultRuntimeDir,
  admin: {
    enabled: process.env.ADMIN_ENABLED !== "false"
  },
  zingle: {
    baseUrl: process.env.ZINGLE_BASE_URL || "https://api.zingle.me/v1",
    serviceId: process.env.ZINGLE_SERVICE_ID || "",
    username: process.env.ZINGLE_USERNAME || "",
    password: process.env.ZINGLE_PASSWORD || ""
  },
  email: {
    provider: process.env.EMAIL_PROVIDER || "microsoft-graph",
    mailbox: process.env.EMAIL_MAILBOX || "",
    sync: {
      fullHistoryOnFirstSync: process.env.EMAIL_FULL_HISTORY_ON_FIRST_SYNC !== "false",
      fullHistoryMaxPages: Number(process.env.EMAIL_FULL_HISTORY_MAX_PAGES || 200),
      defaultTop: Number(process.env.EMAIL_SYNC_PAGE_SIZE || 100),
      incrementalMaxPages: Number(process.env.EMAIL_INCREMENTAL_MAX_PAGES || 12)
    },
    graph: {
      tenantId: process.env.MS_GRAPH_TENANT_ID || "",
      clientId: process.env.MS_GRAPH_CLIENT_ID || "",
      clientSecret: process.env.MS_GRAPH_CLIENT_SECRET || "",
      redirectUri: process.env.MS_GRAPH_REDIRECT_URI || "",
      authorityUrl: process.env.MS_GRAPH_AUTHORITY_URL || "https://login.microsoftonline.com",
      scopes: process.env.MS_GRAPH_SCOPES || "offline_access User.Read Mail.Read",
      loginHint: process.env.MS_GRAPH_LOGIN_HINT || "",
      tokenCachePath: process.env.MS_GRAPH_TOKEN_CACHE_PATH || path.resolve(process.cwd(), ".graph-token-cache.json")
    }
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-5-mini",
    baseUrl: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
  }
};

export function assertEnvironmentGuards() {
  if (config.enforceSandboxOnly && config.appEnv !== "sandbox") {
    console.warn("[startup] sandbox-only pipeline is enabled; inbound preview routes will reject non-sandbox requests");
  }
  if (config.isProd && !config.allowProdAutosend) {
    console.log("[startup] production mode with auto-send disabled");
  }
  if (!config.isProd) {
    console.log("[startup] sandbox mode enabled");
  }
}
