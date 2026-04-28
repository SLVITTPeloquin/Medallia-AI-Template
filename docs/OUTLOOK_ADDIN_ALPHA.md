# Outlook Add-in Alpha

This repo includes a parallel Outlook add-in that runs beside the existing admin queue.

## URLs

- Task pane: `https://email-medallia-automation-hch4h2e7apareucy.westus3-01.azurewebsites.net/outlook/taskpane.html`
- Manifest: `https://email-medallia-automation-hch4h2e7apareucy.westus3-01.azurewebsites.net/outlook/manifest.xml`

## Current Flow

1. Open an email in Outlook.
2. Open `SAHARA Draft Assistant`.
3. Click `Generate Draft`.
4. Review the action checklist and generated draft.
5. Use `Open Reply` from read mode or `Insert Draft` from compose mode.
6. Submit an alpha audit decision and notes.

## Backend Endpoints

- `POST /api/outlook/draft`
  - Accepts selected Outlook message content.
  - Reuses the existing email orchestrator.
  - Persists the generated item into the review store.
  - Appends a `draft_generated` audit event.

- `POST /api/outlook/audit`
  - Appends add-in events to `.runtime/outlook-addin-audit.jsonl` locally or `/home/medallia-runtime/outlook-addin-audit.jsonl` on Azure.
  - Logs draft insertion, checklist updates, variant choice, and review feedback.

## Alpha Guardrails

- The add-in does not send email automatically.
- Draft insertion requires a user click.
- Audit is append-only JSONL for now so we can inspect adoption and failure patterns without adding a database.
