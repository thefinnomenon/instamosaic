type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { getMarketingPost, nowIso, trackEvent, updateMarketingPost } from "@instamosaic/db";
import { errorJson, getClientIp, json } from "../../../../../../lib/server.ts";

export async function POST({ request, params }: APIEvent): Promise<Response> {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return errorJson("ADMIN_PASSWORD is not configured.", 503);
  const password = request.headers.get("x-admin-password");
  if (password !== configured) return errorJson("Unauthorized.", 401);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorJson("Invalid marketing post id.", 400);
  if (!await getMarketingPost(id)) return errorJson("Marketing post not found.", 404);

  const body = await request.json().catch(() => ({})) as { permalink?: unknown; notes?: unknown };
  const permalink = String(body.permalink || "").trim();
  if (!isInstagramUrl(permalink)) return errorJson("Enter a valid Instagram post, Reel, or story URL.", 400);

  const post = await updateMarketingPost(id, {
    status: "published",
    published_at: nowIso(),
    permalink,
    publish_notes: String(body.notes || "").trim() || null
  });
  await trackEvent({ event: "marketing_post_published", jobId: post.job_id ?? undefined, ip: getClientIp(request), metadata: { marketingPostId: post.id, permalink } });
  return json({ post });
}

function isInstagramUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ["instagram.com", "www.instagram.com"].includes(url.hostname);
  } catch {
    return false;
  }
}
