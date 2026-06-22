import type { APIEvent } from "@solidjs/start/server";
import { assertRateLimit, logError, trackEvent } from "@instamosaic/db";
import { checkInstagramProfile, normalizeEmail, sanitizeInstagramUsername } from "@instamosaic/worker";
import { errorJson, getClientIp, json, rateLimitResponse, shouldBypassRateLimit } from "../../../lib/server.ts";

const INSTAGRAM_CHECK_IP_LIMIT = 60;
const INSTAGRAM_CHECK_IP_WINDOW_MS = 60_000;
const INSTAGRAM_CHECK_EMAIL_LIMIT = 60;
const INSTAGRAM_CHECK_EMAIL_WINDOW_MS = 24 * 60 * 60_000;

export async function GET({ request }: APIEvent): Promise<Response> {
  const url = new URL(request.url);
  const ip = getClientIp(request);
  if (!shouldBypassRateLimit()) {
    const ipLimit = assertRateLimit({ scope: "instagram_check_ip", identity: ip, limit: INSTAGRAM_CHECK_IP_LIMIT, windowMs: INSTAGRAM_CHECK_IP_WINDOW_MS });
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSeconds);
  }

  let username: string;
  try {
    username = sanitizeInstagramUsername(url.searchParams.get("username"));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Invalid Instagram username.", 400);
  }

  const emailParam = url.searchParams.get("email");
  if (emailParam) {
    try {
      const email = normalizeEmail(emailParam);
      if (!shouldBypassRateLimit()) {
        const emailLimit = assertRateLimit({ scope: "instagram_check_email", identity: email, limit: INSTAGRAM_CHECK_EMAIL_LIMIT, windowMs: INSTAGRAM_CHECK_EMAIL_WINDOW_MS });
        if (!emailLimit.allowed) return rateLimitResponse(emailLimit.retryAfterSeconds);
      }
    } catch {
      // Email is optional during handle checking; validation happens on submit.
    }
  }

  trackEvent({ event: "instagram_check_started", ip, metadata: { username } });

  try {
    const result = await checkInstagramProfile(username);
    const status = result.exists ? (result.is_public ? "public" : "private") : "not_found";
    trackEvent({
      event: status === "public" ? "instagram_check_public" : status === "private" ? "instagram_check_private" : "instagram_check_not_found",
      ip,
      metadata: { username, estimatedPhotoCount: result.estimated_photo_count }
    });
    return json({
      status,
      username: result.username || username,
      exists: result.exists,
      public: result.is_public,
      estimatedPhotoCount: result.estimated_photo_count,
      warnings: result.warnings,
      errors: result.errors
    });
  } catch (error) {
    logError({
      event: "instagram_check_error",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { username, ip }
    });
    trackEvent({ event: "instagram_check_error", ip, metadata: { username } });
    return errorJson("Unable to verify Instagram right now.", 500);
  }
}
