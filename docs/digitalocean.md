# DigitalOcean Droplet Deployment

This is the recommended MVP deployment because SQLite and generated images need persistent local disk.

## 1. Create Droplet

Use an Ubuntu LTS Droplet with at least:

- 2 vCPU
- 4GB RAM for small jobs
- 8GB RAM recommended for the default 7200x10800 master
- 80GB+ disk if you keep many completed jobs

## 2. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

## 3. Clone And Configure

```bash
git clone <your-repo-url> instamosaic
cd instamosaic
cp .env.example .env
```

Edit `.env`:

```env
APP_URL=https://your-domain.com
ADMIN_PASSWORD=use-a-long-random-password
INSTAGRAM_RAPIDAPI_KEY=...
INSTAGRAM_RAPIDAPI_HOST=instagram120.p.rapidapi.com
RESEND_API_KEY=...
STRIPE_SECRET_KEY_PROD=...
STRIPE_WEBHOOK_SECRET_PROD=...
```

## 4. Start App

```bash
docker compose up -d --build
docker compose logs -f app worker
```

The app listens on port `3000`.

## 5. Reverse Proxy

Point your domain to the Droplet and put Caddy or Nginx in front of the app.

Example Caddyfile:

```caddy
your-domain.com {
  reverse_proxy 127.0.0.1:3000
}
```

## 6. Stripe Webhook

In Stripe, create a webhook endpoint:

```text
https://your-domain.com/api/stripe/webhook
```

Enable:

- `checkout.session.completed`
- `checkout.session.async_payment_failed`

Update `.env` with the webhook signing secret and restart:

```bash
docker compose up -d
```

## 7. Backups

The compose file stores SQLite and artifacts in the `instamosaic-data` Docker volume.

Back it up regularly:

```bash
docker run --rm \
  -v instamosaic_instamosaic-data:/data \
  -v "$PWD/backups:/backups" \
  alpine tar czf /backups/instamosaic-$(date +%F).tgz /data
```

## 8. Operations

Useful commands:

```bash
docker compose ps
docker compose logs -f app worker
docker compose restart worker
docker compose exec app npm run db:init
```

For the MVP, cleanup is manual. Delete old completed job folders only after deciding whether customers should retain download access.
