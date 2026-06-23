import { randomUUID } from "node:crypto";
import type { APIEvent } from "@solidjs/start/server";
import {
  assertRateLimit,
  createJob,
  hasActiveJobForEmail,
  logError,
  toPublicJob,
  trackEvent
} from "@instamosaic/db";
import { normalizeEmail, sanitizeInstagramUsername, sendAdminJobCreatedEmail, sendInitialProcessingEmail } from "@instamosaic/worker";
import { errorJson, getClientIp, json, rateLimitResponse, saveHeroImage, shouldBypassRateLimit } from "../../../lib/server.ts";

const MIN_COMPLETION_MS = 3_000;
const SUBMISSION_IP_LIMIT = 20;
const SUBMISSION_IP_WINDOW_MS = 60 * 60_000;
const JOBS_EMAIL_LIMIT = 10;
const JOBS_EMAIL_WINDOW_MS = 24 * 60 * 60_000;

export async function POST({ request }: APIEvent): Promise<Response> {
  const ip = getClientIp(request);
  if (!shouldBypassRateLimit()) {
    const ipLimit = assertRateLimit({ scope: "submission_ip", identity: ip, limit: SUBMISSION_IP_LIMIT, windowMs: SUBMISSION_IP_WINDOW_MS });
    if (!ipLimit.allowed) return rateLimitResponse(ipLimit.retryAfterSeconds);
  }

  const form = await request.formData();
  if (String(form.get("website") || "").trim()) {
    trackEvent({ event: "submit_clicked", ip, metadata: { honeypot: true } });
    return errorJson("Submission rejected.", 400);
  }

  const startedAt = Number.parseInt(String(form.get("startedAt") || "0"), 10);
  if (Number.isFinite(startedAt) && Date.now() - startedAt < MIN_COMPLETION_MS) {
    return errorJson("Please complete the form before submitting.", 400);
  }

  let username: string;
  let email: string;
  try {
    username = sanitizeInstagramUsername(form.get("username"));
    email = normalizeEmail(form.get("email"));
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Invalid form input.", 400);
  }

  if (!shouldBypassRateLimit()) {
    const emailLimit = assertRateLimit({ scope: "jobs_email", identity: email, limit: JOBS_EMAIL_LIMIT, windowMs: JOBS_EMAIL_WINDOW_MS });
    if (!emailLimit.allowed) return rateLimitResponse(emailLimit.retryAfterSeconds);
  }
  if (hasActiveJobForEmail(email)) return errorJson("There is already an active job for this email address.", 409);

  const hero = form.get("hero");
  if (!(hero instanceof File)) {
    return errorJson("Upload a hero image.", 400);
  }

  const jobId = randomUUID();
  let saved: Awaited<ReturnType<typeof saveHeroImage>>;
  try {
    saved = await saveHeroImage(hero, jobId);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Invalid hero image.", 400);
  }

  trackEvent({ event: "submit_clicked", ip, user: email, metadata: { username } });
  trackEvent({ event: "hero_image_uploaded", ip, user: email, metadata: { bytes: saved.bytes, mime: saved.mime, width: saved.width, height: saved.height } });
  trackEvent({ event: "form_completed", ip, user: email, metadata: { username } });

  const job = createJob({
    id: jobId,
    username,
    email,
    heroPath: saved.heroPath,
    outputDir: saved.outputDir,
    ipAddress: ip,
    metadata: { uploadBytes: saved.bytes, uploadMime: saved.mime, heroWidth: saved.width, heroHeight: saved.height }
  });

  void sendInitialProcessingEmail({ to: email, jobId: job.id, username }).catch((error) => {
    logError({
      event: "processing_email_sent",
      jobId: job.id,
      user: email,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  });
  void sendAdminJobCreatedEmail({ jobId: job.id, username, customerEmail: email, ip }).catch((error) => {
    logError({
      event: "admin_job_created_email_sent",
      jobId: job.id,
      user: email,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  });

  return json({ job: toPublicJob(job) }, { status: 201 });
}
