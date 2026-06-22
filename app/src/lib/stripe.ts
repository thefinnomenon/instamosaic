export function stripeSecretKey(): string | undefined {
  return environmentValue("STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY_DEV", "STRIPE_SECRET_KEY_PROD");
}

export function stripeWebhookSecret(): string | undefined {
  return environmentValue("STRIPE_WEBHOOK_SECRET", "STRIPE_WEBHOOK_SECRET_DEV", "STRIPE_WEBHOOK_SECRET_PROD");
}

function environmentValue(baseName: string, devName: string, prodName: string): string | undefined {
  const specificName = process.env.NODE_ENV === "production" ? prodName : devName;
  return process.env[specificName] || process.env[baseName] || undefined;
}
