# InstaMosaic

InstaMosaic turns public Instagram image posts into photo mosaics for print and
social sharing. A customer supplies an Instagram username and a hero image;
the worker downloads source photos, builds the mosaic, and generates previews,
downloads, and a reveal video.

## Project structure

- `app/`: Next.js App Router pages, API routes, admin dashboard, and checkout.
- `packages/db/`: Prisma/PostgreSQL models and data access.
- `packages/mosaic/`: Mosaic rendering and image exports using Sharp.
- `packages/storage/`: Cloudflare R2-compatible storage and a local fallback.
- `packages/worker/`: Instagram ingestion, job processing, reveal videos, and email.
- `scripts/`: Local verification and optional marketing utilities.

## Requirements

- Node.js 24, or a supported Node.js 22 release, with npm.
- PostgreSQL; Docker Compose can start the included local database.
- FFmpeg for reveal-video generation.
- Provider credentials for the integrations you intend to use.

Live Instagram ingestion currently needs an updated provider integration: the
default RapidAPI host returns HTTP 404. The local mock-download and reveal-video
checks below can run without that provider.

## Local development

```bash
cp .env.example .env
npm ci
docker compose up -d postgres
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Configure `.env` before starting the app. The example includes local PostgreSQL
and worker settings; add credentials for Instagram ingestion, email, payments,
or object storage as needed. Real environment files are ignored by Git.

`npm run dev` starts the Next.js app and HTTP worker. In local mode, the app
sends jobs directly to the worker. Production uses Google Cloud Tasks to invoke
a private Cloud Run worker.

## Development commands

```bash
npm run dev:app          # Start only the web app
npm run worker:http      # Start the HTTP worker
npm run prisma:migrate   # Create and apply local migrations
npm run db:init          # Apply existing migrations
npm run typecheck        # Check server and app TypeScript
npm run build            # Generate Prisma client and build the app
```

Local checks that do not call the Instagram provider:

```bash
npm run test:download -- demo --mock
npm run test:reveal
```

Checks using a configured Instagram provider:

```bash
npm run test:check -- username
npm run test:download -- username
npm run test:pipeline -- username hero.jpg
```

## Optional marketing tools

Campaign tools read usernames from `marketing-targets.txt`. Their local state
and generated media are stored under `tmp/`.

```bash
npm run campaign:check       # Inspect the next target
npm run campaign:generate    # Generate media without publishing
```

Publishing requires separate Meta account configuration. See `.env.example`
for variable names and `docs/marketing-automation.md` for workflow notes.

## Deployment

The app targets Vercel, with a private Cloud Run worker, Google Cloud Tasks,
PostgreSQL, and Cloudflare R2-compatible object storage.

Vercel settings:

- Framework: Next.js
- Install command: `npm install`
- Build command: `npm --workspace app run build`
- Development command: `npm run dev:app`

Configure production credentials in the hosting environment. Keep local-only
settings such as `CLOUD_TASKS_DEV_MODE`, `LOCAL_WORKER_URL`, and
`WORKER_ALLOW_UNAUTHENTICATED` out of production.

See [production architecture](docs/production-architecture.md) for deployment
variables, request flow, persistence, and worker authentication.
