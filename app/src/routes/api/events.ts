import type { APIEvent } from "@solidjs/start/server";
import { trackEvent } from "@instamosaic/db";
import { getClientIp, json } from "../../lib/server.ts";

export async function POST({ request }: APIEvent): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    event?: string;
    jobId?: string;
    user?: string;
    metadata?: Record<string, unknown>;
  };
  const event = String(body.event || "").trim();
  if (!/^[a-z0-9_:-]{2,80}$/i.test(event)) {
    return json({ ok: false }, { status: 400 });
  }

  trackEvent({
    event,
    jobId: body.jobId,
    user: body.user,
    ip: getClientIp(request),
    metadata: body.metadata ?? {}
  });
  return json({ ok: true });
}
