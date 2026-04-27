# Sandbox MVP Quickstart

## 1. Install and run

```bash
npm install
cp .env.example .env
npm run dev
```

## 2. Test the SMS webhook

```bash
curl -sS -X POST http://localhost:3000/webhooks/zingle/sms \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_001",
    "thread_id": "thread_abc",
    "guest": { "id": "guest_1", "name": "Jordan" },
    "message": { "text": "Hi, can I get extra towels in room 405 please?" },
    "recent_thread_summary": "Guest checked in today and asked about pool hours earlier."
  }' | jq
```

Expected response includes:

- `decision.intent`
- `decision.confidence`
- `decision.escalate`
- `suggestion.channel`
- `suggestion.segments`
- `evidence.facts`

## 3. Test the email webhook

```bash
curl -sS -X POST http://localhost:3000/webhooks/zingle/email \
  -H "Content-Type: application/json" \
  -d '{
    "event_id": "evt_email_001",
    "thread_id": "email_thread_123",
    "contact": { "id": "guest_2", "name": "Taylor", "email": "taylor@example.com" },
    "email": {
      "id": "email_001",
      "subject": "Late checkout request",
      "body": "Hello, I would like to request a late checkout tomorrow if possible. Please let me know the policy and any fees."
    },
    "recent_thread_summary": "Guest has an upcoming departure tomorrow."
  }' | jq
```

Expected response includes:

- `suggestion.channel = "email"`
- `suggestion.subject`
- `suggestion.body`

## 4. Optional: LLM-backed generation

If you want model-generated drafts:

1. Set `OPENAI_API_KEY` in `.env`
2. Optionally adjust `OPENAI_MODEL` (`gpt-5-mini` is the default)
3. Restart service

When unavailable or failing, the service falls back to deterministic local template drafting.

## 5. Safety behavior

- Sandbox (`APP_ENV=sandbox`): `auto_send_eligible` is always `false`
- Non-sandbox with `ENFORCE_SANDBOX_ONLY=true`: inbound preview routes return `403 sandbox_only`
