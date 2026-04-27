# Outlook Inbox Analysis

This workflow analyzes a Microsoft Outlook service inbox and its corresponding sent mail to answer two questions:

- What kinds of customer emails are coming in?
- Which response patterns are repeatable enough to automate safely?

It can now operate in two modes:

- `dynamic-openai`: derive mailbox-specific categories and response styles, then classify every inbound thread into that derived schema
- `fallback-rules`: use the built-in fixed taxonomy when no OpenAI key is configured

The analyzer reads:

- `Inbox`
- `Sent Items`

It groups messages by `conversationId`, pairs inbound customer messages with the next outbound reply in the same conversation, then produces:

- inbound category counts
- response style counts
- formatting traits used by agents
- average response time
- category-by-category automation candidates
- sample inbound/reply pairs for review

## Categories

Inbound categories:

- `complaint`
- `reservation_issue`
- `how_to_use_system`
- `faq`
- `general_concern`
- `billing`
- `technical_issue`
- `other`

Response styles:

- `faq_answer`
- `step_by_step_guidance`
- `empathetic_apology`
- `reservation_resolution`
- `escalation_or_follow_up`
- `policy_explanation`
- `generic_acknowledgement`
- `other`

## Requirements

Set the Microsoft Graph env vars in `.env`:

- `EMAIL_MAILBOX`
- `MS_GRAPH_TENANT_ID`
- `MS_GRAPH_CLIENT_ID`
- `MS_GRAPH_SCOPES`

Recommended Graph delegated permissions:

- `Mail.Read`
- `Mail.Read.Shared` only if you are reading a shared mailbox you already have access to

Recommended `.env` values for your own mailbox:

```env
EMAIL_MAILBOX=me
MS_GRAPH_SCOPES=offline_access User.Read Mail.Read
```

Recommended `.env` values for a shared mailbox:

```env
EMAIL_MAILBOX=shared-inbox@company.com
MS_GRAPH_SCOPES=offline_access User.Read Mail.Read Mail.Read.Shared
```

Optional delegated-auth helpers:

- `MS_GRAPH_LOGIN_HINT` to prefer a specific signed-in user during token reuse
- `MS_GRAPH_TOKEN_CACHE_PATH` to control where the local delegated token cache is stored

Optional but strongly recommended for richer classification:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

If no OpenAI key is present, the analyzer falls back to rule-based categorization.
Dynamic categories require `OPENAI_API_KEY`.

## First Login

The first Graph call uses delegated device-code login.

When you run the script, it will print a Microsoft verification URL and code. Open the URL, enter the code, and complete sign-in with the user whose mailbox access should be used.

The token is cached locally in `.graph-token-cache.json` by default, so later runs usually do not require another interactive login.

## Run

Default markdown report:

```bash
npm run analyze:outlook -- --days 14 --top 100
```

JSON output:

```bash
npm run analyze:outlook -- --days 30 --inboxTop 200 --sentTop 200 --format json
```

The JSON output includes:

- `report.schema` for the derived dynamic category set
- `categorized_pairs` for every analyzed inbound thread and its category/response analysis

Extra options:

- `--days <n>` lookback window in days
- `--top <n>` sets both inbox and sent page size
- `--inboxTop <n>` inbox page size
- `--sentTop <n>` sent items page size
- `--maxPages <n>` how many Graph result pages to fetch from each folder
- `--sampleSize <n>` how many sample pairs to include
- `--format markdown|json`

## Notes and Assumptions

- Human replies are approximated from `Sent Items`. If the mailbox also sends automated messages from the same account, review the sample pairs before treating automation recommendations as final.
- Pairing is based on Outlook `conversationId` and the first sent message after the inbound email.
- The report is intended as an analysis artifact, not an auto-send workflow.
- `EMAIL_MAILBOX=me` reads the signed-in user's mailbox. Any other mailbox value uses `/users/{mailbox}` and requires that the signed-in user already has access to that mailbox.
- Dynamic categorization quality is materially better with an OpenAI key; without one, the analyzer still runs but uses the fixed fallback taxonomy.
