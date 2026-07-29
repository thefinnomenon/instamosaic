import type Stripe from "stripe";
import {
  createPrintOrder,
  getPrintOrderByStripeSession,
  logError,
  markPrintOrderFailed,
  markPrintOrderSubmitted,
  trackEvent,
  updatePrintOrderStatus,
  type Job
} from "@instamosaic/db";
import { appUrl } from "@instamosaic/worker/app";
import { env } from "./env.ts";

const PRINTSHRIMP_BASE_URL = "https://api.printshrimp.com/functions/v1";
const PRINTSHRIMP_CREATE_ORDER_URL = `${PRINTSHRIMP_BASE_URL}/api-create-order`;
const PRINTSHRIMP_GET_ORDER_URL = `${PRINTSHRIMP_BASE_URL}/api-get-order`;

type PrintShrimpPayload = {
  external_order_number: string;
  customerInfo: {
    name: string;
    email?: string;
    address1: string;
    address2?: string;
    city: string;
    state?: string;
    zip: string;
    country: string;
    phone?: string;
    shipping: "standard";
  };
  products: Array<{
    size: string;
    type: "Print" | "Frame";
    paper_type?: "Matte";
    variant?: "Black" | "White" | "Oak";
    image: {
      artwork_url: string;
    };
  }>;
};

type PrintShrimpOrderStatus = {
  order_id?: string;
  external_order_number?: string | null;
  status?: string;
  tracking?: string | null;
  tracking_courier?: string | null;
  completed?: boolean;
};

export async function submitPrintShrimpOrder(job: Job, session: Stripe.Checkout.Session): Promise<void> {
  const payload = printShrimpPayload(job, session);
  const existingOrder = await getPrintOrderByStripeSession(session.id);
  if (existingOrder?.status === "submitted" || existingOrder?.status === "submitting") return;
  if (!existingOrder) {
    await createPrintOrder({
      jobId: job.id,
      stripeSessionId: session.id,
      externalOrderNumber: payload.external_order_number,
      requestPayload: payload
    });
  }

  const apiKey = env("PRINTSHRIMP_API_KEY");
  if (!apiKey) {
    const message = "Print Shrimp is not configured.";
    await markPrintOrderFailed({ stripeSessionId: session.id, errorMessage: message });
    await logError({ event: "printshrimp_order_failed", jobId: job.id, user: job.email, message });
    await trackEvent({ event: "printshrimp_order_failed", jobId: job.id, user: job.email, metadata: { sessionId: session.id, message } });
    throw new Error(message);
  }

  try {
    const response = await fetch(PRINTSHRIMP_CREATE_ORDER_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    const responsePayload = parseJson(text) ?? { body: text };

    if (!response.ok) {
      throw new PrintShrimpError(`Print Shrimp failed with ${response.status}: ${text}`, responsePayload);
    }

    await markPrintOrderSubmitted({
      stripeSessionId: session.id,
      printshrimpOrderId: extractOrderId(responsePayload),
      responsePayload,
      ...printShrimpOrderFields(responsePayload)
    });
    await trackEvent({ event: "printshrimp_order_submitted", jobId: job.id, user: job.email, metadata: { sessionId: session.id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markPrintOrderFailed({
      stripeSessionId: session.id,
      errorMessage: message,
      responsePayload: error instanceof PrintShrimpError ? error.responsePayload : undefined
    });
    await logError({
      event: "printshrimp_order_failed",
      jobId: job.id,
      user: job.email,
      message,
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { sessionId: session.id }
    });
    await trackEvent({ event: "printshrimp_order_failed", jobId: job.id, user: job.email, metadata: { sessionId: session.id, message } });
    throw error;
  }
}

export async function syncPrintShrimpOrder(input: {
  stripeSessionId: string;
  externalOrderNumber: string;
  printshrimpOrderId?: string | null;
}): Promise<unknown> {
  const apiKey = env("PRINTSHRIMP_API_KEY");
  if (!apiKey) throw new Error("Print Shrimp is not configured.");

  const url = new URL(PRINTSHRIMP_GET_ORDER_URL);
  if (input.printshrimpOrderId) {
    url.searchParams.set("order_id", input.printshrimpOrderId);
  } else {
    url.searchParams.set("external_order_number", input.externalOrderNumber);
  }

  const response = await fetch(url, {
    headers: {
      "x-api-key": apiKey
    }
  });
  const text = await response.text();
  const responsePayload = parseJson(text) ?? { body: text };
  if (!response.ok) throw new PrintShrimpError(`Print Shrimp status failed with ${response.status}: ${text}`, responsePayload);

  await updatePrintOrderStatus({
    stripeSessionId: input.stripeSessionId,
    printshrimpOrderId: extractOrderId(responsePayload),
    responsePayload,
    ...printShrimpOrderFields(responsePayload)
  });

  return responsePayload;
}

function printShrimpPayload(job: Job, session: Stripe.Checkout.Session): PrintShrimpPayload {
  const customer = session.customer_details;
  const address = customer?.address;
  if (!customer?.name || !address?.line1 || !address.city || !address.postal_code || !address.country) {
    throw new Error("Stripe checkout is missing shipping details for Print Shrimp.");
  }
  const printSize = session.metadata?.printSize || "24x36";
  const printType = session.metadata?.printType === "Frame" ? "Frame" : "Print";
  const frameColor = frameVariant(session.metadata?.frameColor);

  return {
    external_order_number: `instamosaic-${job.id}-${session.id}`,
    customerInfo: {
      name: trim(customer.name, 60),
      ...(customer.email ? { email: trim(customer.email, 120) } : {}),
      address1: trim(address.line1, 60),
      ...(address.line2 ? { address2: trim(address.line2, 60) } : {}),
      city: trim(address.city, 60),
      ...(address.state ? { state: trim(address.state, 60) } : {}),
      zip: trim(address.postal_code, 30),
      country: address.country,
      ...(customer.phone ? { phone: trim(customer.phone, 30) } : {}),
      shipping: "standard"
    },
    products: [{
      size: printSize,
      type: printType,
      ...(printType === "Frame" ? { variant: frameColor } : { paper_type: "Matte" as const }),
      image: {
        artwork_url: `${appUrl()}/api/artwork/${job.download_token}?size=${encodeURIComponent(printSize)}`
      }
    }]
  };
}

function trim(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function frameVariant(value: string | undefined): "Black" | "White" | "Oak" {
  if (value === "White" || value === "Oak") return value;
  return "Black";
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractOrderId(value: unknown): string | null {
  const order = printShrimpOrder(value);
  if (order?.order_id) return order.order_id;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = record.id ?? record.order_id ?? record.orderId;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function printShrimpOrderFields(value: unknown): {
  status?: string | null;
  tracking?: string | null;
  trackingCourier?: string | null;
  completed?: boolean | null;
} {
  const order = printShrimpOrder(value);
  if (!order) return {};
  return {
    status: typeof order.status === "string" ? order.status : null,
    tracking: typeof order.tracking === "string" ? order.tracking : null,
    trackingCourier: typeof order.tracking_courier === "string" ? order.tracking_courier : null,
    completed: typeof order.completed === "boolean" ? order.completed : null
  };
}

function printShrimpOrder(value: unknown): PrintShrimpOrderStatus | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const order = record.order && typeof record.order === "object" ? record.order : record;
  return order as PrintShrimpOrderStatus;
}

class PrintShrimpError extends Error {
  constructor(message: string, readonly responsePayload: unknown) {
    super(message);
  }
}
