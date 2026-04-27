# Sandbox Integrations

This repository is configured for sandbox preview mode only.

## Zingle sandbox

The sandbox Zingle REST service ID discovered from the API is:

- `28c85936-6458-4d8a-8e7f-2e3b54bec37d`
- Display name: `SLS Las Vegas - Test Environment`

The numeric service value in the app URL (`13314`) is not the REST API service ID.

Current sandbox assumptions:

- Base URL: `https://api.zingle.me/v1`
- Auth mode: Basic auth
- Ingress route for sandbox SMS payloads: `POST /webhooks/zingle/sms`

## Microsoft Graph sandbox email

The email pipeline is wired to normalize these fields into the shared orchestrator:

- `subject`
- `sender`
- `body`
- `thread/conversation ID`

The repo now includes a Graph preview script:

```bash
npm run preview:email -- --top 5
```

Required Graph env vars before it can run:

- `MS_GRAPH_TENANT_ID`
- `MS_GRAPH_CLIENT_ID`
- `EMAIL_MAILBOX`
- `MS_GRAPH_SCOPES`

The ADFS portal URL alone is not enough for Graph API access. Graph needs an Entra app registration with delegated mailbox permissions.

Recommended Graph delegated permission for preview reads:

- `Mail.Read`

- If you are reading a shared mailbox you already have access to, also add `Mail.Read.Shared`
- The current repo uses delegated device-code login and local token caching, so no client secret is required

If you later want preview sends through Graph, add delegated send permission:

- `Mail.Send`

## Current status

- Sandbox SMS preview path is runnable now.
- Sandbox email preview path is implemented but blocked on Graph app credentials.
- No production endpoints are used by the preview pipeline.
