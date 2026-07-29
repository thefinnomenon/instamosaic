import Stripe from "stripe";
type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { getJob, logError, markJobPaid, toPublicJob, trackEvent } from "@instamosaic/db";
import { sendDigitalPurchaseEmail } from "@instamosaic/worker/app";
import { errorJson, json } from "../../../lib/server.ts";
import { stripeSecretKey } from "../../../lib/stripe.ts";

export async function POST({ request }: APIEvent): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; sessionId?: string };
  const job = body.jobId ? await getJob(body.jobId) : null;
  if (!job) return errorJson("Job not found.", 404);
  if (job.paid_at) return json({ job: await toPublicJob(job, true) });

  const sessionId = body.sessionId || job.stripe_session_id;
  if (!sessionId) return errorJson("Checkout session is missing.", 400);

  const secret = stripeSecretKey();
  if (!secret) return errorJson("Stripe is not configured.", 503);

  try {
    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.jobId !== job.id) return errorJson("Checkout session does not match this job.", 403);
    if (session.payment_status !== "paid") return errorJson("Checkout is not paid yet.", 409);

    const paidJob = await markJobPaid({
      jobId: job.id,
      stripeSessionId: session.id,
      amountPaidCents: session.amount_total ?? null,
      currency: session.currency ?? null
    });

    await trackEvent({ event: "stripe_checkout_confirmed", jobId: job.id, user: job.email, metadata: { sessionId: session.id } });
    await sendDigitalPurchaseEmail({
      to: paidJob.email,
      jobId: paidJob.id,
      username: paidJob.username,
      amountPaidCents: session.amount_total ?? null,
      currency: session.currency ?? null
    });

    return json({ job: await toPublicJob(paidJob, true) });
  } catch (error) {
    await logError({
      event: "stripe_checkout_confirm_failed",
      jobId: job.id,
      user: job.email,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { sessionId }
    });
    return errorJson("Unable to confirm Stripe checkout.", 500);
  }
}
