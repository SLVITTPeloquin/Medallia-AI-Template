import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const DEFAULT_TIMEOUT_MS = 20000;
const MAX_TIMEOUT_MS = 120000;
const STREAMING_COMMANDS = new Set([
  "webapp log tail",
  "containerapp logs show"
]);

const ALLOWED_ROOTS = new Set([
  "account",
  "appservice",
  "containerapp",
  "deployment",
  "group",
  "monitor",
  "resource",
  "provider",
  "webapp"
]);

const BLOCKED_TOKENS = new Set([
  "add",
  "assign",
  "cancel",
  "create",
  "delete",
  "deallocate",
  "deploy",
  "import",
  "patch",
  "purge",
  "remove",
  "restart",
  "restore",
  "revoke",
  "rollback",
  "set",
  "start",
  "stop",
  "sync",
  "update",
  "upgrade"
]);

function isObject(value) {
  return value !== null && typeof value === "object";
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function parseMaybeJson(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function toTextResult(payload, isError = false) {
  return {
    isError,
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

function assertReadonlyAzArgs(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((part) => typeof part !== "string" || !part.trim())) {
    throw new Error("`args` must be a non-empty array of strings.");
  }

  const normalized = args.map((part) => part.trim().toLowerCase());
  const root = normalized[0];
  if (!ALLOWED_ROOTS.has(root)) {
    throw new Error(`Unsupported Azure CLI root command: ${args[0]}. Allowed roots: ${Array.from(ALLOWED_ROOTS).join(", ")}.`);
  }

  const blocked = normalized.find((token) => BLOCKED_TOKENS.has(token));
  if (blocked) {
    throw new Error(`Blocked potentially mutating token in read-only command: ${blocked}`);
  }
}

function maybeAddJsonOutput(args) {
  if (args.includes("-o") || args.includes("--output")) {
    return args;
  }

  const signature = args.slice(0, 3).join(" ").toLowerCase();
  if (STREAMING_COMMANDS.has(signature)) {
    return args;
  }

  return [...args, "--output", "json"];
}

function runCommand(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        timedOut,
        error: error.message,
        stdout,
        stderr
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        timedOut,
        error: null,
        stdout,
        stderr
      });
    });
  });
}

async function runAz(args, timeoutSeconds) {
  assertReadonlyAzArgs(args);

  const timeoutMs = clampInt(timeoutSeconds, 3, MAX_TIMEOUT_MS / 1000, DEFAULT_TIMEOUT_MS / 1000) * 1000;
  const finalArgs = maybeAddJsonOutput(args);
  const result = await runCommand("az", finalArgs, timeoutMs);

  const parsedStdout = parseMaybeJson(result.stdout);
  const payload = {
    command: ["az", ...finalArgs].join(" "),
    ok: result.ok,
    code: result.code,
    timedOut: result.timedOut,
    error: result.error,
    stdout: parsedStdout ?? result.stdout.trim(),
    stderr: result.stderr.trim()
  };

  return toTextResult(payload, !result.ok);
}

async function runAzPayload(args, timeoutSeconds) {
  assertReadonlyAzArgs(args);

  const timeoutMs = clampInt(timeoutSeconds, 3, MAX_TIMEOUT_MS / 1000, DEFAULT_TIMEOUT_MS / 1000) * 1000;
  const finalArgs = maybeAddJsonOutput(args);
  const result = await runCommand("az", finalArgs, timeoutMs);
  const parsedStdout = parseMaybeJson(result.stdout);

  return {
    command: ["az", ...finalArgs].join(" "),
    ok: result.ok,
    code: result.code,
    timedOut: result.timedOut,
    error: result.error,
    stdout: parsedStdout ?? result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

const tools = [
  {
    name: "azure_cli_readonly",
    description: "Run read-only Azure CLI queries for diagnostics (logs, deployment state, activity).",
    inputSchema: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments after `az`. Example: [\"containerapp\",\"logs\",\"show\",\"--name\",\"myapp\",\"--resource-group\",\"my-rg\",\"--tail\",\"200\"]"
        },
        timeoutSeconds: {
          type: "integer",
          minimum: 3,
          maximum: 120,
          description: "Timeout in seconds (default 20)."
        }
      },
      required: ["args"],
      additionalProperties: false
    }
  },
  {
    name: "azure_containerapp_logs",
    description: "Fetch recent logs for an Azure Container App.",
    inputSchema: {
      type: "object",
      properties: {
        resourceGroup: { type: "string" },
        appName: { type: "string" },
        tail: { type: "integer", minimum: 1, maximum: 1000 },
        revision: { type: "string" },
        container: { type: "string" },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      required: ["resourceGroup", "appName"],
      additionalProperties: false
    }
  },
  {
    name: "azure_webapp_log_tail",
    description: "Tail Azure App Service logs for a bounded period.",
    inputSchema: {
      type: "object",
      properties: {
        resourceGroup: { type: "string" },
        appName: { type: "string" },
        slot: { type: "string" },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      required: ["resourceGroup", "appName"],
      additionalProperties: false
    }
  },
  {
    name: "azure_activity_log",
    description: "List Azure Activity Log events by resource or resource group.",
    inputSchema: {
      type: "object",
      properties: {
        resourceId: { type: "string" },
        resourceGroup: { type: "string" },
        offset: {
          type: "string",
          description: "Lookback window for events, e.g. `6h`, `1d`, `7d` (default `24h`)."
        },
        maxEvents: { type: "integer", minimum: 1, maximum: 200 },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      additionalProperties: false
    }
  },
  {
    name: "azure_deployment_operations",
    description: "List ARM/Bicep deployment operations at resource-group or subscription scope.",
    inputSchema: {
      type: "object",
      properties: {
        scope: {
          type: "string",
          enum: ["group", "subscription"],
          default: "group"
        },
        deploymentName: { type: "string" },
        resourceGroup: { type: "string" },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      required: ["deploymentName"],
      additionalProperties: false
    }
  },
  {
    name: "azure_resource_health_events",
    description: "List Azure Resource Health events for a specific resource ID.",
    inputSchema: {
      type: "object",
      properties: {
        resourceId: { type: "string" },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      required: ["resourceId"],
      additionalProperties: false
    }
  },
  {
    name: "azure_hosting_discover",
    description: "Discover App Service, Container Apps, and App Insights resources (optionally within one resource group).",
    inputSchema: {
      type: "object",
      properties: {
        resourceGroup: { type: "string" },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      additionalProperties: false
    }
  },
  {
    name: "azure_appinsights_query",
    description: "Run a Kusto query against an Application Insights component.",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "Application Insights component name or app id."
        },
        query: {
          type: "string",
          description: "Kusto query text."
        },
        timespan: {
          type: "string",
          description: "ISO8601 duration, e.g. PT1H, PT24H."
        },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      required: ["app", "query"],
      additionalProperties: false
    }
  },
  {
    name: "azure_admin_panel_logs",
    description: "Run a focused Application Insights query for admin panel routes (/admin and /api/review).",
    inputSchema: {
      type: "object",
      properties: {
        app: {
          type: "string",
          description: "Application Insights component name or app id."
        },
        lookbackHours: {
          type: "integer",
          minimum: 1,
          maximum: 168,
          description: "Hours to look back (default 24)."
        },
        timeoutSeconds: { type: "integer", minimum: 3, maximum: 120 }
      },
      required: ["app"],
      additionalProperties: false
    }
  }
];

const server = new Server(
  {
    name: "azure-ops-mcp",
    version: "0.1.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: input } = request.params;
  const args = isObject(input) ? input : {};

  try {
    if (name === "azure_cli_readonly") {
      return await runAz(args.args, args.timeoutSeconds);
    }

    if (name === "azure_containerapp_logs") {
      const tail = clampInt(args.tail, 1, 1000, 200);
      const command = [
        "containerapp",
        "logs",
        "show",
        "--resource-group",
        String(args.resourceGroup),
        "--name",
        String(args.appName),
        "--tail",
        String(tail)
      ];

      if (args.revision) {
        command.push("--revision", String(args.revision));
      }
      if (args.container) {
        command.push("--container", String(args.container));
      }

      return await runAz(command, args.timeoutSeconds);
    }

    if (name === "azure_webapp_log_tail") {
      const command = [
        "webapp",
        "log",
        "tail",
        "--resource-group",
        String(args.resourceGroup),
        "--name",
        String(args.appName)
      ];

      if (args.slot) {
        command.push("--slot", String(args.slot));
      }

      return await runAz(command, args.timeoutSeconds ?? 20);
    }

    if (name === "azure_activity_log") {
      const command = [
        "monitor",
        "activity-log",
        "list",
        "--offset",
        String(args.offset ?? "24h"),
        "--max-events",
        String(clampInt(args.maxEvents, 1, 200, 50))
      ];

      if (args.resourceId) {
        command.push("--resource-id", String(args.resourceId));
      } else if (args.resourceGroup) {
        command.push("--resource-group", String(args.resourceGroup));
      }

      return await runAz(command, args.timeoutSeconds);
    }

    if (name === "azure_deployment_operations") {
      const scope = args.scope === "subscription" ? "sub" : "group";
      const command = ["deployment", scope, "operation", "list", "--name", String(args.deploymentName)];

      if (scope === "group") {
        if (!args.resourceGroup) {
          throw new Error("`resourceGroup` is required when scope is `group`.");
        }
        command.push("--resource-group", String(args.resourceGroup));
      }

      return await runAz(command, args.timeoutSeconds);
    }

    if (name === "azure_resource_health_events") {
      const command = [
        "resource",
        "health",
        "events",
        "list",
        "--resource-id",
        String(args.resourceId)
      ];

      return await runAz(command, args.timeoutSeconds);
    }

    if (name === "azure_hosting_discover") {
      const query =
        "[?type=='Microsoft.Web/sites' || type=='Microsoft.App/containerApps' || type=='microsoft.insights/components'].{name:name,type:type,resourceGroup:resourceGroup,location:location,id:id}";
      const command = ["resource", "list", "--query", query];

      if (args.resourceGroup) {
        command.push("--resource-group", String(args.resourceGroup));
      }

      return await runAz(command, args.timeoutSeconds);
    }

    if (name === "azure_appinsights_query") {
      const command = [
        "monitor",
        "app-insights",
        "query",
        "--app",
        String(args.app),
        "--analytics-query",
        String(args.query)
      ];

      if (args.timespan) {
        command.push("--offset", String(args.timespan));
      }

      return await runAz(command, args.timeoutSeconds);
    }

    if (name === "azure_admin_panel_logs") {
      const lookbackHours = clampInt(args.lookbackHours, 1, 168, 24);
      const requestQuery = [
        "requests",
        `| where timestamp > ago(${lookbackHours}h)`,
        "| where url has '/admin' or url has '/api/review'",
        "| project timestamp, name, url, resultCode, success, duration, operation_Id",
        "| order by timestamp desc",
        "| take 200"
      ].join(" ");
      const traceQuery = [
        "traces",
        `| where timestamp > ago(${lookbackHours}h)`,
        "| where message has '/admin' or message has '/api/review' or message has 'admin'",
        "| project timestamp, severityLevel, message, operation_Id",
        "| order by timestamp desc",
        "| take 200"
      ].join(" ");
      const exceptionQuery = [
        "exceptions",
        `| where timestamp > ago(${lookbackHours}h)`,
        "| where outerMessage has '/admin' or outerMessage has '/api/review' or problemId has 'admin'",
        "| project timestamp, type, outerMessage, problemId, operation_Id",
        "| order by timestamp desc",
        "| take 100"
      ].join(" ");

      const [requestsResult, tracesResult, exceptionsResult] = await Promise.all([
        runAzPayload(
          [
            "monitor",
            "app-insights",
            "query",
            "--app",
            String(args.app),
            "--analytics-query",
            requestQuery
          ],
          args.timeoutSeconds
        ),
        runAzPayload(
          [
            "monitor",
            "app-insights",
            "query",
            "--app",
            String(args.app),
            "--analytics-query",
            traceQuery
          ],
          args.timeoutSeconds
        ),
        runAzPayload(
          [
            "monitor",
            "app-insights",
            "query",
            "--app",
            String(args.app),
            "--analytics-query",
            exceptionQuery
          ],
          args.timeoutSeconds
        )
      ]);

      const ok = requestsResult.ok && tracesResult.ok && exceptionsResult.ok;
      return toTextResult(
        {
          app: String(args.app),
          lookbackHours,
          requests: requestsResult,
          traces: tracesResult,
          exceptions: exceptionsResult
        },
        !ok
      );
    }

    return toTextResult({ error: `Unknown tool: ${name}` }, true);
  } catch (error) {
    return toTextResult(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      true
    );
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
