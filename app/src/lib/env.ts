export function loadServerEnv(): void {
  // Next.js and Vercel load app environment variables before route handlers run.
}

export function env(name: string): string | undefined {
  loadServerEnv();
  return process.env[name] || undefined;
}
