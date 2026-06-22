export function sanitizeInstagramUsername(value: unknown): string {
  const username = String(value ?? "").trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) {
    throw new Error("Instagram username must be 1-30 characters and contain only letters, numbers, dots, and underscores.");
  }
  if (username.includes("..")) {
    throw new Error("Instagram username cannot contain consecutive dots.");
  }
  return username;
}

export function normalizeEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}
