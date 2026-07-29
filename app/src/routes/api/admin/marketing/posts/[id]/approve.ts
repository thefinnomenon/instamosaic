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
  const current = await getMarketingPost(id);
  if (!current) return errorJson("Marketing post not found.", 404);

  const post = await updateMarketingPost(id, {
    status: "approved",
    approved_at: current.approved_at ?? nowIso(),
    error_message: null
  });
  await trackEvent({ event: "marketing_post_approved", jobId: post.job_id ?? undefined, ip: getClientIp(request), metadata: { marketingPostId: post.id } });
  return json({ post });
}
