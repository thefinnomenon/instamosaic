import Stripe from "stripe";
import type { APIEvent } from "@solidjs/start/server";
import { getJob, logError, trackEvent, updateJob } from "@instamosaic/db";
import { appUrl } from "@instamosaic/worker";
import { errorJson, getClientIp, json } from "../../../lib/server.ts";
import { stripeSecretKey } from "../../../lib/stripe.ts";

const PRICE_CENTS = 499;
const CURRENCY = "usd";

export async function POST({ request }: APIEvent): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { jobId?: string };
  const job = body.jobId ? getJob(body.jobId) : null;
  if (!job) return errorJson("Job not found.", 404);
  if (job.status !== "completed") return errorJson("Mosaic is not ready yet.", 409);
  if (job.paid_at) return json({ url: `${appUrl()}/status/${job.id}` });

  trackEvent({ event: "checkout_clicked", jobId: job.id, user: job.email, ip: getClientIp(request) });

  const secret = stripeSecretKey();
  if (!secret) return errorJson("Stripe is not configured.", 503);

  try {
    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: job.email,
      metadata: { jobId: job.id },
      payment_intent_data: {
        receipt_email: job.email
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: PRICE_CENTS,
            product_data: {
              name: "InstaMosaic digital download",
              description: `High-resolution digital files for @${job.username}`
            }
          }
        }
      ],
      success_url: `${appUrl()}/status/${job.id}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/status/${job.id}?checkout=cancelled`
    });

    updateJob(job.id, { stripe_session_id: session.id });
    trackEvent({ event: "stripe_checkout_created", jobId: job.id, user: job.email, metadata: { sessionId: session.id } });
    return json({ url: session.url });
  } catch (error) {
    logError({
      event: "stripe_checkout_failed",
      jobId: job.id,
      user: job.email,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    trackEvent({ event: "stripe_checkout_failed", jobId: job.id, user: job.email });
    return errorJson("Unable to create Stripe checkout.", 500);
  }
}
