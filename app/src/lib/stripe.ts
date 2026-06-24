import { env } from "./env.ts";

export function stripeSecretKey(): string | undefined {
  return env("STRIPE_SECRET_KEY");
}

export function stripeWebhookSecret(): string | undefined {
  return env("STRIPE_WEBHOOK_SECRET");
}
