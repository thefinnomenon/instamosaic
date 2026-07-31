import "dotenv/config";
import process from "node:process";

const DEFAULT_API_VERSION = "v25.0";
const EXPIRY_WARNING_DAYS = 14;
const REQUIRED_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_read_engagement",
  "pages_show_list"
] as const;

type JsonObject = Record<string, unknown>;

try {
  if (process.argv[2] !== "--check") throw new Error("Usage: npm run instagram:token:check");
  await checkInstalledToken();
} catch (error) {
  console.error(`Instagram token check failed: ${safeError(error)}`);
  process.exitCode = 1;
}

async function checkInstalledToken(): Promise<void> {
  const pageToken = requiredEnv("INSTAGRAM_PAGE_ACCESS_TOKEN");
  const instagramAccountId = requiredEnv("INSTAGRAM_BUSINESS_ACCOUNT_ID");
  const apiVersion = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || DEFAULT_API_VERSION;
  const profile = await verifyInstagramAccount({ apiVersion, pageToken, instagramAccountId });
  const debug = await inspectToken({ apiVersion, token: pageToken });

  console.log(`Instagram Page token is valid for @${profile.username}.`);
  if (debug) validateTokenMetadata(debug);
  else console.log("Meta token metadata was unavailable; live account access still passed.");
}

async function verifyInstagramAccount(input: {
  apiVersion: string;
  pageToken: string;
  instagramAccountId: string;
}): Promise<{ id: string; username: string }> {
  const url = graphUrl(input.apiVersion, `/${input.instagramAccountId}`, {
    fields: "id,username",
    access_token: input.pageToken
  });
  const payload = await graphRequest(url);
  return {
    id: stringField(payload, "id", "Meta did not return the Instagram business account ID."),
    username: stringField(payload, "username", "Meta did not return the Instagram username.")
  };
}

async function inspectToken(input: { apiVersion: string; token: string }): Promise<JsonObject | null> {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  const url = graphUrl(input.apiVersion, "/debug_token", {
    input_token: input.token,
    access_token: `${appId}|${appSecret}`
  });

  try {
    const payload = await graphRequest(url);
    return isObject(payload.data) ? payload.data : null;
  } catch {
    return null;
  }
}

function validateTokenMetadata(debug: JsonObject): void {
  if (debug.is_valid !== true) throw new Error("Meta reports that the Page token is invalid.");
  const tokenType = optionalString(debug.type);
  if (tokenType !== "PAGE") throw new Error(`Expected a Page token, but Meta reports token type ${tokenType ?? "unknown"}.`);
  const configuredAppId = process.env.META_APP_ID?.trim();
  const tokenAppId = optionalString(debug.app_id);
  if (configuredAppId && tokenAppId && tokenAppId !== configuredAppId) {
    throw new Error("The Page token belongs to a different Meta app than META_APP_ID.");
  }
  const scopes = Array.isArray(debug.scopes)
    ? debug.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
  if (missingScopes.length) throw new Error(`Page token is missing required scopes: ${missingScopes.join(", ")}.`);

  const expiresAt = optionalNumber(debug.expires_at);
  if (expiresAt === 0) {
    console.log("Meta reports that the Page token has no scheduled expiration.");
    return;
  }
  if (!expiresAt) {
    console.log("Meta did not report a token expiration; the weekly check will continue verifying access.");
    return;
  }

  const expiry = new Date(expiresAt * 1000);
  const remainingMs = expiry.getTime() - Date.now();
  console.log(`Meta reports token expiration at ${expiry.toISOString()}.`);
  if (remainingMs <= EXPIRY_WARNING_DAYS * 86_400_000) {
    throw new Error(`The Page token expires within ${EXPIRY_WARNING_DAYS} days and must be reissued.`);
  }
}

async function graphRequest(url: URL): Promise<JsonObject> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  const payload = parseObject(text);
  if (!response.ok) {
    const graphError = isObject(payload.error) ? payload.error : null;
    const message = graphError ? optionalString(graphError.message) : null;
    throw new Error(`Meta Graph API request failed (${response.status}): ${message ?? "unknown error"}`);
  }
  return payload;
}

function graphUrl(apiVersion: string, pathname: string, params: Record<string, string>): URL {
  const url = new URL(`https://graph.facebook.com/${apiVersion}${pathname}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

function parseObject(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringField(input: JsonObject, key: string, message: string): string {
  const value = optionalString(input[key]);
  if (!value) throw new Error(message);
  return value;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function safeError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  const secrets = [
    process.env.META_APP_SECRET,
    process.env.INSTAGRAM_PAGE_ACCESS_TOKEN,
    process.env.INSTAGRAM_ACCESS_TOKEN
  ].filter((value): value is string => Boolean(value));
  for (const secret of secrets) message = message.replaceAll(secret, "<redacted>");
  return message.replace(/\b(?:EAA|IGA)[A-Za-z0-9_-]{20,}\b/g, "<redacted>");
}
