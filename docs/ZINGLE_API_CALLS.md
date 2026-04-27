# Zingle API Calls (Production)

This guide shows how to call the Medallia Zingle REST API used by this repo.

## 1. Current Auth Pattern

For this tenant, API v1 Basic auth is currently working:

- Base URL: `https://api.zingle.me/v1`
- Auth header: `Authorization: Basic base64(username:password)`

## 2. Environment Variables

Use `.env` with:

- `ZINGLE_BASE_URL`
- `ZINGLE_USERNAME`
- `ZINGLE_PASSWORD`
- `ZINGLE_SERVICE_ID`

Known service IDs found from production API:

- LIVE: `bb9a081d-e5a2-4225-bb51-8d6c79b66f61`
- Use `GET /services` to identify any additional service IDs in your account.

## 3. Validate Auth

```bash
curl -sS -u "$ZINGLE_USERNAME:$ZINGLE_PASSWORD" \
  "$ZINGLE_BASE_URL/services?page_size=5"
```

## 4. List Services

```bash
curl -sS -u "$ZINGLE_USERNAME:$ZINGLE_PASSWORD" \
  "$ZINGLE_BASE_URL/services?page_size=200"
```

## 5. List Messages (Outbound in Date Range)

Use Unix timestamp filters (seconds recommended for this tenant):

```bash
curl -sS -u "$ZINGLE_USERNAME:$ZINGLE_PASSWORD" \
  "$ZINGLE_BASE_URL/services/$ZINGLE_SERVICE_ID/messages?communication_direction=outbound&created_at=greater_than(1775779200),less_than(1776384000)&page_size=100"
```

## 6. List Events (Outbound in Date Range)

```bash
curl -sS -u "$ZINGLE_USERNAME:$ZINGLE_PASSWORD" \
  "$ZINGLE_BASE_URL/services/$ZINGLE_SERVICE_ID/events?communication_direction=outbound&created_at=greater_than(1775779200),less_than(1776384000)&page_size=100"
```

## 7. Send Message

```bash
curl -sS -X POST -u "$ZINGLE_USERNAME:$ZINGLE_PASSWORD" \
  -H "Content-Type: application/json" \
  "$ZINGLE_BASE_URL/services/$ZINGLE_SERVICE_ID/messages" \
  -d '{
    "sender_type": "service",
    "sender": { "id": "'$ZINGLE_SERVICE_ID'" },
    "recipient_type": "contact",
    "recipients": [{ "id": "<CONTACT_ID>" }],
    "channel_type_ids": ["0a293ea3-4721-433e-a031-610ebcf43255"],
    "body": "Hello from API"
  }'
```

## 8. Run Repo Reporting Script

```bash
npm run counts:outbound -- \
  --start 2026-04-10T00:00:00Z \
  --end 2026-04-17T00:00:00Z \
  --timestampUnit seconds
```

## 9. Notes

- Your web inbox URL numeric service value (`13330`) is not the REST API `service_id`.
- Use UUID service IDs from `/v1/services` for API calls.
- Script auth supports either Bearer token or Basic auth; Basic is active in this tenant.
