# DigitalOcean Deployment

The old DigitalOcean single-droplet deployment has been retired.

InstaMosaic no longer uses SQLite or a persistent local `storage/` volume for production state. The production target is:

- App on Vercel
- Prisma-hosted PostgreSQL
- Cloudflare R2 object storage
- Private Google Cloud Run worker
- Google Cloud Tasks dispatch

Use [production-architecture.md](production-architecture.md) for the current deployment path.
