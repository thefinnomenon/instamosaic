import Stripe from "stripe";
type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { createPrintOrder, getJob, getJobByStripeSession, getPrintOrderByStripeSession, logError, markJobPaid, markPrintOrderSubmitted, trackEvent } from "@instamosaic/db";
import { sendDigitalPurchaseEmail } from "@instamosaic/worker/app";
import { submitPrintShrimpOrder } from "../../../lib/printshrimp.ts";
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
    const job = (session.metadata?.jobId ? await getJob(session.metadata.jobId) : null) || await getJobByStripeSession(session.id);
    if (job) {
      if (session.metadata?.product === "physical_print") {
        await trackEvent({ event: "stripe_checkout_completed", jobId: job.id, user: job.email, metadata: { sessionId: session.id, product: "physical_print" } });
        // Unlock digital files as part of print purchase.
        const wasAlreadyPaid = Boolean(job.paid_at);
        const paidJob = await markJobPaid({
          jobId: job.id,
          stripeSessionId: session.id,
          amountPaidCents: session.amount_total ?? null,
          currency: session.currency ?? null
        });
        if (!wasAlreadyPaid) {
          await sendDigitalPurchaseEmail({
            to: paidJob.email,
            jobId: paidJob.id,
            username: paidJob.username,
            amountPaidCents: session.amount_total ?? null,
            currency: session.currency ?? null
          });
        }
        if (!session.livemode) {
          await recordTestPrintOrder(job.id, session);
          await trackEvent({ event: "printshrimp_order_skipped_test_mode", jobId: job.id, user: job.email, metadata: { sessionId: session.id, product: "physical_print" } });
          return json({ received: true, printShrimpSkipped: "test_mode" });
        }
        await submitPrintShrimpOrder(job, session);
        return json({ received: true });
      }

      const wasAlreadyPaid = Boolean(job.paid_at);
      const paidJob = await markJobPaid({
        jobId: job.id,
        stripeSessionId: session.id,
        amountPaidCents: session.amount_total ?? null,
        currency: session.currency ?? null
      });
      await trackEvent({ event: "stripe_checkout_completed", jobId: job.id, user: job.email, metadata: { sessionId: session.id } });
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
    const job = (session.metadata?.jobId ? await getJob(session.metadata.jobId) : null) || await getJobByStripeSession(session.id);
    if (job) {
      await logError({ event: "stripe_checkout_failed", jobId: job.id, user: job.email, message: "Stripe asynchronous payment failed." });
      await trackEvent({ event: "stripe_checkout_failed", jobId: job.id, user: job.email, metadata: { sessionId: session.id } });
    }
  }

  return json({ received: true });
}

async function recordTestPrintOrder(jobId: string, session: Stripe.Checkout.Session): Promise<void> {
  if (!await getPrintOrderByStripeSession(session.id)) {
    await createPrintOrder({
      jobId,
      stripeSessionId: session.id,
      externalOrderNumber: `test-instamosaic-${jobId}-${session.id}`,
      requestPayload: {
        testMode: true,
        printSize: session.metadata?.printSize ?? null,
        printType: session.metadata?.printType ?? null,
        frameColor: session.metadata?.frameColor ?? null
      }
    });
  }
  await markPrintOrderSubmitted({
    stripeSessionId: session.id,
    status: "test_mode",
    responsePayload: { testMode: true, message: "Stripe test checkout completed. PrintShrimp order was not submitted." },
    completed: false
  });
}
