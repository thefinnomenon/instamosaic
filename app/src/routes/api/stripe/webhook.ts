import Stripe from "stripe";
import type { APIEvent } from "@solidjs/start/server";
import { getJob, getJobByStripeSession, logError, markJobPaid, trackEvent } from "@instamosaic/db";
import { sendDigitalPurchaseEmail } from "@instamosaic/worker";
import { errorJson, json } from "../../../lib/server.ts";
import { stripeSecretKey, stripeWebhookSecret } from "../../../lib/stripe.ts";

export async function POST({ request }: APIEvent): Promise<Response> {
  const secret = stripeSecretKey();
  const webhookSecret = stripeWebhookSecret();
  if (!secret || !webhookSecret) return errorJson("Stripe webhook is not configured.", 503);

  const stripe = new Stripe(secret);
  const signature = request.headers.get("stripe-signature");
  if (!signature) return errorJson("Missing Stripe signature.", 400);

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Invalid Stripe webhook signature.", 400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const job = (session.metadata?.jobId ? getJob(session.metadata.jobId) : null) || getJobByStripeSession(session.id);
    if (job) {
      const wasAlreadyPaid = Boolean(job.paid_at);
      const paidJob = markJobPaid({
        jobId: job.id,
        stripeSessionId: session.id,
        amountPaidCents: session.amount_total ?? null,
        currency: session.currency ?? null
      });
      trackEvent({ event: "stripe_checkout_completed", jobId: job.id, user: job.email, metadata: { sessionId: session.id } });
      if (!wasAlreadyPaid) {
        await sendDigitalPurchaseEmail({
          to: paidJob.email,
          jobId: paidJob.id,
          username: paidJob.username,
          amountPaidCents: session.amount_total ?? null,
          currency: session.currency ?? null
        });
      }
    }
  }

  if (event.type === "checkout.session.async_payment_failed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const job = (session.metadata?.jobId ? getJob(session.metadata.jobId) : null) || getJobByStripeSession(session.id);
    if (job) {
      logError({ event: "stripe_checkout_failed", jobId: job.id, user: job.email, message: "Stripe asynchronous payment failed." });
      trackEvent({ event: "stripe_checkout_failed", jobId: job.id, user: job.email, metadata: { sessionId: session.id } });
    }
  }

  return json({ received: true });
}
