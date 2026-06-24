import Stripe from "stripe";
import type { APIEvent } from "@solidjs/start/server";
import { getJob, logError, trackEvent, updateJob } from "@instamosaic/db";
import { appUrl } from "@instamosaic/worker";
import { env } from "../../../lib/env.ts";
import { printPriceCents } from "../../../lib/print-pricing.ts";
import { errorJson, getClientIp, json } from "../../../lib/server.ts";
import { stripeSecretKey } from "../../../lib/stripe.ts";

const CURRENCY = "usd";
const ALLOWED_COUNTRIES = ["US", "GB", "CA", "AU", "NL", "DE", "FR", "ES", "IT", "IE", "BR"] as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[];
const PRINT_SIZES = new Set(["12x18", "20x30", "24x36"]);
const FRAME_COLORS = new Set(["Black", "White", "Oak"]);

export async function POST({ request }: APIEvent): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; size?: string; framed?: boolean; frameColor?: string };
  const job = body.jobId ? getJob(body.jobId) : null;
  if (!job) return errorJson("Job not found.", 404);
  if (job.status !== "completed") return errorJson("Mosaic is not ready yet.", 409);
  const printSize = PRINT_SIZES.has(String(body.size || "")) ? String(body.size) : "20x30";
  const printType = body.framed ? "Frame" : "Print";
  const frameColor = FRAME_COLORS.has(String(body.frameColor || "")) ? String(body.frameColor) : "Black";
  const priceCents = printPriceCents(printSize, printType === "Frame");

  trackEvent({ event: "checkout_clicked", jobId: job.id, user: job.email, ip: getClientIp(request), metadata: { product: "physical_print", printSize, printType, frameColor: printType === "Frame" ? frameColor : null, priceCents } });

  const secret = stripeSecretKey();
  if (!secret) return errorJson("Stripe is not configured.", 503);
  if (!env("PRINTSHRIMP_API_KEY")) {
    return errorJson("Print fulfillment is not configured.", 503);
  }

  try {
    const stripe = new Stripe(secret);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: job.email,
      metadata: { jobId: job.id, product: "physical_print", printSize, printType, frameColor },
      phone_number_collection: { enabled: true },
      shipping_address_collection: {
        allowed_countries: ALLOWED_COUNTRIES
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency: CURRENCY },
            display_name: "Standard shipping"
          }
        }
      ],
      payment_intent_data: {
        receipt_email: job.email
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: CURRENCY,
            unit_amount: priceCents,
            product_data: {
              name: `InstaMosaic ${printSize} ${printType === "Frame" ? `${frameColor} framed print` : "matte print"}`,
              description: `${printSize} ${printType === "Frame" ? `${frameColor} frame` : "matte print"} for @${job.username}`
            }
          }
        }
      ],
      success_url: `${appUrl()}/status/${job.id}?print=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl()}/status/${job.id}?print=cancelled`
    });

    updateJob(job.id, { stripe_session_id: session.id });
    trackEvent({ event: "stripe_checkout_created", jobId: job.id, user: job.email, metadata: { sessionId: session.id, product: "physical_print", printSize, printType, frameColor: printType === "Frame" ? frameColor : null } });
    return json({ url: session.url });
  } catch (error) {
    logError({
      event: "stripe_checkout_failed",
      jobId: job.id,
      user: job.email,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { product: "physical_print" }
    });
    trackEvent({ event: "stripe_checkout_failed", jobId: job.id, user: job.email, metadata: { product: "physical_print" } });
    return errorJson("Unable to create Stripe checkout.", 500);
  }
}
