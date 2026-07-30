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

## Automated Instagram Campaign

`marketing-targets.txt` contains one Instagram username per line. Each run
advances to the next target, generates its mosaic and reveal video locally,
publishes a two-item carousel (reveal first, mosaic second) with an
`@username` caption mention, and publishes the reveal separately to Stories.
The Story includes an API-level mention positioned near the top center using
the target's numeric Instagram user ID, and the reveal video visibly includes
the target handle.

Check the next target without generating or publishing:

```bash
npm run campaign:check
```

Generate and inspect the complete local media package without publishing:

```bash
npm run campaign:generate
```

Publish the next campaign item:

```bash
npm run campaign:run
```

The campaign needs `INSTAGRAM_RAPIDAPI_KEY`, `INSTAGRAM_PAGE_ACCESS_TOKEN`,
and `INSTAGRAM_BUSINESS_ACCOUNT_ID`. It does not use Postgres or R2. A temporary local
media server and HTTPS tunnel let Instagram fetch the reveal MP4 and mosaic
JPEG; both close immediately after Instagram finishes processing the carousel
and Story. Local artifacts and campaign state are kept under
`tmp/instagram-campaign`.

To run at 9 AM, 2 PM, and 7 PM each day, add this cron entry with `crontab -e`:

```cron
0 9,14,19 * * * cd /path/to/project && PATH=/path/to/project /path/to/project run campaign:run >> /path/to/project 2>&1
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
