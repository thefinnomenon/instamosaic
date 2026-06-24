import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

let loaded = false;

export function loadServerEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const filePath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "..", ".env")]) {
    if (existsSync(filePath)) config({ path: filePath, override: false });
  }
}

export function env(name: string): string | undefined {
  loadServerEnv();
  return process.env[name] || undefined;
}
