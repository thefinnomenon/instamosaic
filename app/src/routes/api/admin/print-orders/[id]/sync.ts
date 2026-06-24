import type { APIEvent } from "@solidjs/start/server";
import { getPrintOrder, trackEvent } from "@instamosaic/db";
import { syncPrintShrimpOrder } from "../../../../../lib/printshrimp.ts";
import { errorJson, getClientIp, json } from "../../../../../lib/server.ts";

export async function POST({ params, request }: APIEvent): Promise<Response> {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) return errorJson("ADMIN_PASSWORD is not configured.", 503);

  const password = request.headers.get("x-admin-password");
  if (password !== configured) return errorJson("Unauthorized.", 401);

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return errorJson("Invalid print order id.", 400);

  const order = getPrintOrder(id);
  if (!order) return errorJson("Print order not found.", 404);

  const result = await syncPrintShrimpOrder({
    stripeSessionId: order.stripe_session_id,
    externalOrderNumber: order.external_order_number,
    printshrimpOrderId: order.printshrimp_order_id
  });

  trackEvent({ event: "printshrimp_order_synced", jobId: order.job_id, ip: getClientIp(request), metadata: { printOrderId: id } });
  return json({ result });
}
