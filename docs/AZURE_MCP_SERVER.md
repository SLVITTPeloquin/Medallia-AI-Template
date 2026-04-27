# Azure Operations MCP Server

This repo now includes an MCP server you can run locally to give Codex access to Azure diagnostics via Azure CLI.

Server entrypoint: `mcp/azure-ops-server.mjs`

## What you get

Tools exposed by the server:

- `azure_cli_readonly`: generic read-only Azure CLI access for diagnostics queries
- `azure_containerapp_logs`: recent logs for Azure Container Apps
- `azure_webapp_log_tail`: bounded log tail for Azure App Service
- `azure_activity_log`: Azure Activity Log events by resource or resource group
- `azure_deployment_operations`: ARM/Bicep deployment operation details (group or subscription scope)
- `azure_resource_health_events`: Resource Health events for a specific Azure resource
- `azure_hosting_discover`: discover App Service, Container Apps, and App Insights resources
- `azure_appinsights_query`: run custom Kusto queries against Application Insights
- `azure_admin_panel_logs`: focused admin-panel diagnostics query (`/admin`, `/api/review`)

The generic tool blocks common mutating tokens (`create`, `delete`, `update`, etc.) so this server stays diagnostic-focused.

## Prerequisites

1. Install Azure CLI (`az`) on the machine running Codex.
2. Authenticate Azure CLI:

```bash
az login
```

3. Select the correct subscription:

```bash
az account set --subscription "<subscription-id-or-name>"
```

4. Ensure your identity has read access for target resources, usually `Reader` (and `Monitoring Reader` where needed).

## Local run

From repo root:

```bash
npm run mcp:azure-ops
```

## MCP registration

Register this server in your MCP client as a stdio server.

Example generic MCP config:

```json
{
  "mcpServers": {
    "azure-ops": {
      "command": "node",
      "args": ["/home/luc/Medallia-AI-Template/mcp/azure-ops-server.mjs"],
      "env": {
        "PATH": "<include-path-with-az-cli>"
      }
    }
  }
}
```

After registration, restart your MCP client/Codex session so the new server is discovered.

## Quick validation

After startup, test with a safe command using `azure_cli_readonly`:

```json
{
  "args": ["account", "show"]
}
```

Then query logs for your deployment type:

- Container App: `azure_containerapp_logs`
- App Service: `azure_webapp_log_tail`

For your admin panel specifically, run:

```json
{
  "app": "<app-insights-component-name>",
  "lookbackHours": 24
}
```

with tool `azure_admin_panel_logs`.
