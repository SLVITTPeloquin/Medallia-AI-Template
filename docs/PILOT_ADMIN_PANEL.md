# Pilot Admin Panel

This service is a draft-only review system for inbound Outlook and Zingle communications.

## Run Locally

```bash
npm install
npm start
```

Open:

```text
http://localhost:3000/admin/
```

## Docker

```bash
docker compose up --build
```

The app stores review queue data and the Microsoft Graph token cache in the `review-runtime` Docker volume.

## Pilot Behavior

- The system reads live inbound email through Microsoft Graph when `Sync Email` is clicked.
- The system can ingest Zingle messages through the existing webhook routes or the `Sync Zingle` button when Zingle API credentials are configured.
- Every inbound communication receives a draft, even when the category requires human review.
- Nothing is sent automatically.
- Reviewers can edit draft subject/body, add notes, and mark items as ready or in review.

## Main Files

- Admin UI: `public/admin/index.html`, `public/admin/styles.css`, `public/admin/app.js`
- Review API: `src/routes/admin.js`
- Review persistence: `src/services/review-store.js`
- Docker: `Dockerfile`, `docker-compose.yml`
