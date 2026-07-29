# InstaMosaic

InstaMosaic generates print-ready and social-ready mosaics from public Instagram image posts.

The production architecture is now Next.js/Postgres/R2/Cloud Run based:

- Next.js App Router web/API application in `app/`
- Prisma ORM with Prisma-hosted PostgreSQL
- Cloudflare R2-compatible object storage for uploaded inputs and generated outputs
- Private Cloud Run worker invoked by Google Cloud Tasks
- Postgres-backed job progress, dispatch state, generated asset records, analytics, downloads, print orders, and marketing drafts
- Resend email for processing, completion, failure, purchase, and marketing-review notifications
- Stripe Checkout and webhook handling for digital downloads and print orders

SQLite has been removed from runtime persistence.

## Local Setup

```bash
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

For local Cloud Tasks replacement, set:

```env
CLOUD_TASKS_DEV_MODE=local
LOCAL_WORKER_URL=http://127.0.0.1:8080
WORKER_SHARED_SECRET=dev-worker-secret
```

`npm run dev` starts the app and the HTTP worker. The app creates a job and dispatches the worker through the local worker URL.

## Core Scripts

```bash
npm run dev              # app plus local worker HTTP service
npm run dev:app          # app only
npm run worker:http      # Cloud Run-style worker endpoint
npm run prisma:migrate   # create/apply a local migration
npm run db:init          # apply migrations in deployed environments
npm run typecheck
npm --workspace app run build
```

Existing harnesses are still available:

```bash
npm run test:check -- username
npm run test:download -- username --mock
npm run test:mosaic -- hero.jpg tmp/test/username/tiles
npm run test:pipeline -- username hero.jpg
npm run test:reveal
```

## Deployment

Use the app on Vercel and deploy the worker Docker image to private Cloud Run. Cloud Tasks should send only `{ "jobId": "..." }` to `POST /internal/jobs/process` with an OIDC token for the Cloud Run service.

Vercel project settings:

- Framework preset: Next.js
- Install command: `npm install`
- Build command: `npm --workspace app run build`
- Development command: `npm run dev:app`

Set the Vercel environment variables listed in `.env.example`, except local-only variables such as `CLOUD_TASKS_DEV_MODE`, `LOCAL_WORKER_URL`, and `WORKER_ALLOW_UNAUTHENTICATED`.

See [docs/production-architecture.md](docs/production-architecture.md) for the inspected architecture, data model, deployment variables, and operational notes.
