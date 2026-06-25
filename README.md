# InstaMosaic MVP

InstaMosaic is a complete vertical-slice MVP for generating a photo mosaic from public Instagram photos.

Flow:

1. User enters Instagram username, hero image, and email.
2. App checks the Instagram profile after a 700ms debounce.
3. Submit creates a queued SQLite job and sends the processing email.
4. TypeScript downloads public Instagram image posts through RapidAPI and converts them into square tiles.
5. TypeScript + sharp builds a 24x36 master mosaic and exports previews/print/wallpaper files.
6. Stripe Checkout unlocks unlimited paid downloads.

## Stack

- SolidStart app in `app/`
- SolidJS UI with local UI primitives and the requested `solid-ui` package installed
- Node/TypeScript backend routes
- SQLite via `better-sqlite3`
- TypeScript RapidAPI Instagram client in `packages/worker`
- sharp mosaic generator in `packages/mosaic`
- Resend email API
- Stripe Checkout + webhook
- Docker and docker-compose

## Setup

```bash
cp .env.example .env
npm install
npm run db:init
npm run dev
```

Open `http://localhost:3000`.

## Required Environment

Set these for the full production-like flow:

- `APP_URL`
- `ADMIN_PASSWORD`
- `RESEND_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `INSTAGRAM_RAPIDAPI_KEY`
- `INSTAGRAM_RAPIDAPI_HOST`

Generation, pricing, storage, rate limits, and worker behavior are hardcoded in the app.

## Local Harness

Check profile:

```bash
npm run test:check -- username
```

Download tiles:

```bash
npm run test:download -- username
npm run test:download -- username --mock
```

Set `INSTAGRAM_RAPIDAPI_KEY` to use the RapidAPI `instagram120` profile and posts endpoints. By default this downloads every image the provider pages through.

```bash
INSTAGRAM_RAPIDAPI_KEY=... npm run test:download -- public_username
```

Generate mosaic:

```bash
npm run test:mosaic -- hero.jpg tmp/test/username/tiles
```

Full pipeline:

```bash
npm run test:pipeline -- username hero.jpg
```

Fast mock verification:

```bash
npm run test:pipeline -- demo app/public/mosaic-sample.jpg --mock
```

## Worker

Submitted jobs are queued in SQLite. During local development, `npm run dev` starts both the web app and worker.

Run only the web app:

```bash
npm run dev:app
```

Run only the worker:

```bash
npm run worker
```

The worker claims one queued job at a time and processes it to completion before taking the next job.

Docker Compose runs both services:

```bash
docker compose up -d --build
docker compose logs -f app worker
```

## Stripe

Create a Stripe webhook endpoint:

```text
POST https://your-domain.com/api/stripe/webhook
```

Listen for:

- `checkout.session.completed`
- `checkout.session.async_payment_failed`

Set `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` per environment. Use test-mode values in development and live-mode values in production.

## Print fulfillment

Physical print orders use Stripe Checkout to collect payment and shipping details. After `checkout.session.completed`, the webhook submits the completed 24x36 master artwork to Print Shrimp in URL mode.

Configure:

```text
PRINTSHRIMP_API_KEY=...
```

The Print Shrimp API base URL is hardcoded to `https://api.printshrimp.com/functions/v1`. The Print Shrimp artwork URL is generated from the job download token and points at `/api/artwork/:token`.

## Admin

Visit `/admin` and enter `ADMIN_PASSWORD`.

The dashboard shows total/completed/failed jobs, average processing time, revenue, downloads, funnel events, recent jobs, analytics, and recent errors.

## Storage

All generated files and SQLite data live under `storage/`:

```text
storage/
  instamosaic.sqlite
  jobs/<job_id>/
    hero-*.jpg
    tiles/
    master-24x36.jpg
    reveal-1080x1920.jpg
    preview-social-1080x1350.jpg
    preview-square-1080x1080.jpg
    print-20x30.jpg
    print-18x24.jpg
    print-12x18.jpg
    wallpaper-phone.jpg
    wallpaper-desktop.jpg
    reveal.mp4
```

The app never exposes filesystem paths to clients. Downloads use random tokens.

## Reveal video

After the mosaic exports finish, the worker tries to generate a vertical social reveal video:

```text
jobs/<job_id>/reveal.mp4
```

The video is 1080x1920, 15 seconds, H264, `yuv420p`, and uses `+faststart` for mobile/social compatibility. It is added to the digital ZIP automatically and can also be downloaded directly with:

```text
/api/download/<download_token>/reveal
```

FFmpeg must be installed on the server. If FFmpeg is missing or fails, the worker logs `reveal_video_failed`, stores a warning in job metadata, and still completes the mosaic.

Reusable API:

```ts
import { generateRevealVideo } from "@instamosaic/worker";

await generateRevealVideo({
  originalImage: "/path/to/uploaded-hero.jpg",
  mosaicImage: "/path/to/preview-social-1080x1350.jpg",
  outputVideo: "/path/to/reveal.mp4",
  stats: {
    username: "thefinnomenon",
    instagramPhotoCount: 2341,
    tileCount: 9600
  }
});
```

The worker passes the uploaded hero image as `originalImage` and the dedicated `reveal-1080x1920.jpg` export as `mosaicImage`. This avoids sending the huge print master through FFmpeg on small servers while keeping the reveal video a true 9:16 frame with no letterboxing.

Scene construction:

- `0-2s`: original image fills the 9:16 frame, fades in from black, and slowly zooms.
- `2-3s`: FFmpeg `xfade` crossfades from original to mosaic.
- `3-10s`: mosaic slowly zooms in with FFmpeg `zoompan`.
- `10-13s`: mosaic zooms back out to full frame.
- `13-15s`: a transparent PNG text overlay fades in with the photo count and `instamosaic.com`.

The command is generated by `buildRevealVideoCommand()`, which returns the command, args, and `filter_complex`. Future styles can be added by changing the command builder or adding a new builder while keeping the public `generateRevealVideo()` API stable. Good next extension points are random pan direction, alternate zoom paths, animated text, music, watermark layers, landscape/square exports, and thumbnails.

Local test:

```bash
npm run test:reveal
```

By default this reads `scripts/hero.jpeg` and prefers `scripts/reveal-mosaic.jpg` if present, falling back to `scripts/social-mosaic.jpg`, then writes `tmp/test/reveal/reveal.mp4`. You can override all paths:

```bash
npm run test:reveal -- hero.jpg preview-social-1080x1350.jpg tmp/test/reveal.mp4
```

## Deployment

- DigitalOcean Droplet: [docs/digitalocean.md](docs/digitalocean.md)
