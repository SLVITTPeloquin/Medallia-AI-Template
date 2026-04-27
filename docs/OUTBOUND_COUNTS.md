# Outbound Message Counts (Human vs Automated)

This script calculates outbound activity for a date window:

- `outbound_total_messages` from Messages API (`communication_direction=outbound`)
- `outbound_human_events` from Events API classification
- `outbound_automated_events` from Events API classification
- `outbound_unknown_events` when neither user nor automation signal is present

## Setup

```bash
cp .env.example .env
```

Set:

- `ZINGLE_SERVICE_ID`
- `ZINGLE_BASE_URL` (optional; defaults to `https://api.zingle.me/v1`)
- One auth option:
  - `ZINGLE_TOKEN` (JWT bearer), or
  - `ZINGLE_USERNAME` + `ZINGLE_PASSWORD` (Basic auth)

## Run

Use ISO timestamps:

```bash
npm run counts:outbound -- \
  --start 2026-04-01T00:00:00Z \
  --end 2026-04-08T00:00:00Z
```

Explicit bearer token:

```bash
npm run counts:outbound -- \
  --token "$ZINGLE_TOKEN" \
  --service "$ZINGLE_SERVICE_ID" \
  --start 2026-04-01T00:00:00Z \
  --end 2026-04-08T00:00:00Z
```

Explicit Basic auth:

```bash
npm run counts:outbound -- \
  --username "$ZINGLE_USERNAME" \
  --password "$ZINGLE_PASSWORD" \
  --service "$ZINGLE_SERVICE_ID" \
  --start 2026-04-01T00:00:00Z \
  --end 2026-04-08T00:00:00Z
```

## Timestamp Unit

Default is `milliseconds` for created_at filters.
If your tenant behaves as seconds-based, add:

```bash
--timestampUnit seconds
```

## Output

JSON with:

- `input` (window + service + auth mode)
- `counts`
- `notes`

