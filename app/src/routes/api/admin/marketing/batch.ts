import { randomUUID } from "node:crypto";
import path from "node:path";
type APIEvent = { request: Request; params: Record<string, string | undefined> };
import {
  createJob,
  logError,
  storageDir,
  trackEvent,
  upsertMarketingTarget
} from "@instamosaic/db";
import {
  normalizeEmail,
  sanitizeInstagramUsername
} from "@instamosaic/worker/app";
import { jobInputKey, uploadFile } from "@instamosaic/storage";
import { dispatchGenerationJob } from "../../../../lib/cloud-tasks.ts";
import { errorJson, getClientIp, json } from "../../../../lib/server.ts";

const MAX_BATCH_USERNAMES = 20;
type MarketingHeroSource = "profile" | "top_liked" | "recent";

type BatchResult = {
  username: string;
  status: "queued" | "failed";
  jobId?: string;
  heroSource?: string;
  error?: string;
};

export async function POST({ request }: APIEvent): Promise<Response> {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return errorJson("ADMIN_PASSWORD is not configured.", 503);
  const password = request.headers.get("x-admin-password");
  if (password !== configured) return errorJson("Unauthorized.", 401);

  const ip = getClientIp(request);
  const form = await request.formData();
  const reviewEmail = normalizeEmail(form.get("reviewEmail") || process.env.MARKETING_REVIEW_EMAIL || process.env.ADMIN_EMAIL || "chris@finnternet.com");
  const heroSource = parseHeroSource(form.get("heroSource"));
  const rightsStatus = String(form.get("rightsStatus") || "unknown").trim() || "unknown";
  const rightsNotes = stringOrNull(form.get("rightsNotes"));
  const notes = stringOrNull(form.get("notes"));
  const captionTemplate = stringOrNull(form.get("captionTemplate"));

  const usernames = uniqueUsernames(String(form.get("usernames") || ""));
  if (usernames.length === 0) return errorJson("Enter at least one Instagram username.", 400);
  if (usernames.length > MAX_BATCH_USERNAMES) return errorJson(`Batch is limited to ${MAX_BATCH_USERNAMES} usernames.`, 400);

  const results: BatchResult[] = [];
  for (const username of usernames) {
    try {
      const target = await upsertMarketingTarget({
        instagramUsername: username,
        category: "creator",
        rightsStatus,
        rightsNotes,
        notes
      });

      const jobId = randomUUID();
      const outputDir = path.join(storageDir(), "jobs", jobId);
      const { downloadMarketingHeroImage } = await import("@instamosaic/worker/marketing");
      const hero = await downloadMarketingHeroImage({
        username,
        outputDir,
        source: heroSource
      });
      const heroObjectKey = jobInputKey(jobId, `${username}-hero.jpg`);
      await uploadFile({
        key: heroObjectKey,
        filePath: hero.hero_path,
        contentType: "image/jpeg",
        metadata: { jobId, username, role: "marketing-hero" }
      });
      const caption = captionForUsername(username, captionTemplate);
      const job = await createJob({
        id: jobId,
        username,
        email: reviewEmail,
        heroPath: hero.hero_path,
        outputDir,
        ipAddress: ip,
        metadata: {
          purpose: "marketing",
          uploadBytes: null,
          uploadMime: "image/jpeg",
          heroWidth: hero.width,
          heroHeight: hero.height,
          heroObjectKey,
          marketing: {
            autoDraft: true,
            targetId: target.id,
            reviewEmail,
            heroSource: hero.source,
            heroSourceUrl: hero.source_url,
            heroLikeCount: hero.like_count,
            heroTakenAt: hero.taken_at,
            heroWarnings: hero.warnings,
            caption,
            rightsStatus,
            rightsNotes,
            notes
          }
        }
      });

      await dispatchGenerationJob(job.id);
      await trackEvent({ event: "marketing_job_queued", jobId: job.id, ip, metadata: { username, heroSource: hero.source } });
      results.push({ username, status: "queued", jobId: job.id, heroSource: hero.source });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logError({
        event: "marketing_job_queue_failed",
        message,
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { username, heroSource }
      });
      results.push({ username, status: "failed", error: message });
    }
  }

  return json({ results }, { status: results.some((result) => result.status === "queued") ? 201 : 400 });
}

function uniqueUsernames(value: string): string[] {
  const seen = new Set<string>();
  const usernames: string[] = [];
  for (const token of value.split(/[\s,]+/)) {
    if (!token.trim()) continue;
    const username = sanitizeInstagramUsername(token);
    const key = username.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    usernames.push(username);
  }
  return usernames;
}

function parseHeroSource(value: FormDataEntryValue | null): "auto" | MarketingHeroSource {
  if (value === "profile" || value === "top_liked" || value === "recent") return value;
  return "auto";
}

function stringOrNull(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function captionForUsername(username: string, template: string | null): string {
  if (template) return template.replaceAll("{username}", username).replaceAll("{@username}", `@${username}`);
  return [
    `We turned @${username}'s Instagram into a mosaic.`,
    "",
    "Every tiny tile comes from their public posts.",
    "",
    "Want one for your own profile? Make yours at instamosaic.com",
    "",
    `@${username} #InstaMosaic #PhotoMosaic #InstagramArt`
  ].join("\n");
}
