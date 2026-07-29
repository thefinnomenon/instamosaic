type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { getDashboardMetrics, trackEvent } from "@instamosaic/db";
import { errorJson, getClientIp, json } from "../../../lib/server.ts";

export async function GET({ request }: APIEvent): Promise<Response> {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) {
    return errorJson("ADMIN_PASSWORD is not configured.", 503);
  }

  const url = new URL(request.url);
  const password = request.headers.get("x-admin-password") || url.searchParams.get("password");
  if (password !== configured) {
    return errorJson("Unauthorized.", 401);
  }

  await trackEvent({ event: "admin_dashboard_viewed", ip: getClientIp(request) });
  return json({ metrics: await getDashboardMetrics() });
}
