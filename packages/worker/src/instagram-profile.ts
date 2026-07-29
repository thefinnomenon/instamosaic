import { sanitizeInstagramUsername } from "./validation.ts";

export type InstagramCheckResult = {
  username: string;
  exists: boolean;
  is_public: boolean;
  estimated_photo_count: number;
  warnings: string[];
  errors: string[];
};

type JsonObject = Record<string, unknown>;

export async function checkInstagramProfile(usernameInput: string): Promise<InstagramCheckResult> {
  const username = sanitizeInstagramUsername(usernameInput);
  const payload = await rapidApiPost("profile", { username });
  const result = objectValue(payload.result);

  if (!result || !result.username) {
    return {
      username,
      exists: false,
      is_public: false,
      estimated_photo_count: 0,
      warnings: ["RapidAPI returned no profile for this username."],
      errors: []
    };
  }

  const timelineMedia = objectValue(result.edge_owner_to_timeline_media);
  return {
    username: String(result.username || username),
    exists: true,
    is_public: !Boolean(result.is_private),
    estimated_photo_count: numberValue(timelineMedia?.count),
    warnings: ["RapidAPI profile check validates visibility only; media is counted during download."],
    errors: []
  };
}

function rapidApiKey(): string {
  const key = process.env.INSTAGRAM_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("INSTAGRAM_RAPIDAPI_KEY or RAPIDAPI_KEY is required.");
  return key;
}

async function rapidApiPost(endpoint: "profile", body: JsonObject): Promise<JsonObject> {
  const host = process.env.INSTAGRAM_RAPIDAPI_HOST || "instagram120.p.rapidapi.com";
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`https://${host}/api/instagram/${endpoint}`, {
        method: "POST",
        headers: {
          "x-rapidapi-key": rapidApiKey(),
          "x-rapidapi-host": host,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }, 45_000);

      if (response.status >= 500 && attempt < 2) {
        await sleep(1_000 + attempt * 1_000);
        continue;
      }
      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 500).replace(/\n/g, " ");
        throw new Error(`RapidAPI request failed with HTTP ${response.status}: ${responseBody}`);
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("RapidAPI returned an unexpected response shape.");
      }
      return payload as JsonObject;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1_000 + attempt * 1_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
