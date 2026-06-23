import { logError, logWarn, trackEvent } from "@instamosaic/db";
import { appUrl } from "./validation.ts";

type EmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  event: string;
  jobId: string;
};

export async function sendProcessingEmail(input: {
  to: string;
  jobId: string;
  username: string;
}): Promise<void> {
  const statusUrl = `${appUrl()}/status/${input.jobId}`;
  await sendEmail({
    to: input.to,
    jobId: input.jobId,
    event: "processing_email_sent",
    subject: "🎨 We're creating your InstaMosaic",
    text: [
      "We're downloading your Instagram photos now.",
      "",
      "This usually takes 5-15 minutes.",
      "",
      "Please keep your Instagram public until processing finishes.",
      "",
      `You can follow the progress here: ${statusUrl}`
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a">
        <h1 style="font-size:22px">We're creating your InstaMosaic</h1>
        <p>We're downloading your Instagram photos now.</p>
        <p>This usually takes 5-15 minutes.</p>
        <p>Please keep your Instagram public until processing finishes.</p>
        <p><a href="${statusUrl}" style="display:inline-block;background:#17202a;color:white;padding:12px 16px;border-radius:6px;text-decoration:none">View Status</a></p>
      </div>
    `
  });
}

export async function sendPreviewEmail(input: {
  to: string;
  jobId: string;
  username: string;
}): Promise<void> {
  const statusUrl = `${appUrl()}/status/${input.jobId}`;
  await sendEmail({
    to: input.to,
    jobId: input.jobId,
    event: "preview_email_sent",
    subject: "Your InstaMosaic is ready",
    text: [
      `Your InstaMosaic for @${input.username} is ready.`,
      "",
      `View your preview and unlock downloads here: ${statusUrl}`
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a">
        <h1 style="font-size:22px">Your InstaMosaic is ready</h1>
        <p>Your InstaMosaic for @${input.username} is ready.</p>
        <p><a href="${statusUrl}" style="display:inline-block;background:#17202a;color:white;padding:12px 16px;border-radius:6px;text-decoration:none">View Preview</a></p>
      </div>
    `
  });
}

export async function sendDigitalPurchaseEmail(input: {
  to: string;
  jobId: string;
  username: string;
  amountPaidCents?: number | null;
  currency?: string | null;
}): Promise<void> {
  const statusUrl = `${appUrl()}/status/${input.jobId}`;
  const amount = formatMoney(input.amountPaidCents, input.currency);
  await sendEmail({
    to: input.to,
    jobId: input.jobId,
    event: "digital_purchase_email_sent",
    subject: "Your InstaMosaic digital download is ready",
    text: [
      `Thanks for purchasing the InstaMosaic digital download for @${input.username}.`,
      amount ? `Amount paid: ${amount}` : "",
      "",
      `Download your digital files here: ${statusUrl}`
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a">
        <h1 style="font-size:22px">Your digital download is ready</h1>
        <p>Thanks for purchasing the InstaMosaic digital download for @${input.username}.</p>
        ${amount ? `<p>Amount paid: <strong>${amount}</strong></p>` : ""}
        <p><a href="${statusUrl}" style="display:inline-block;background:#17202a;color:white;padding:12px 16px;border-radius:6px;text-decoration:none">Download Digital Files</a></p>
      </div>
    `
  });
}

export async function sendAdminJobCreatedEmail(input: {
  jobId: string;
  username: string;
  customerEmail: string;
  ip?: string | undefined;
}): Promise<void> {
  const adminEmail = "chris@finnternet.com";
  const statusUrl = `${appUrl()}/status/${input.jobId}`;
  const adminUrl = `${appUrl()}/admin`;
  await sendEmail({
    to: adminEmail,
    jobId: input.jobId,
    event: "admin_job_created_email_sent",
    subject: `New InstaMosaic started: @${input.username}`,
    text: [
      `A new InstaMosaic was submitted for @${input.username}.`,
      "",
      `Customer email: ${input.customerEmail}`,
      input.ip ? `IP: ${input.ip}` : "",
      "",
      `Status: ${statusUrl}`,
      `Admin: ${adminUrl}`
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a">
        <h1 style="font-size:22px">New InstaMosaic started</h1>
        <p><strong>@${escapeHtml(input.username)}</strong> submitted a mosaic.</p>
        <p>Customer email: <strong>${escapeHtml(input.customerEmail)}</strong></p>
        ${input.ip ? `<p>IP: ${escapeHtml(input.ip)}</p>` : ""}
        <p>
          <a href="${statusUrl}" style="display:inline-block;background:#17202a;color:white;padding:12px 16px;border-radius:6px;text-decoration:none">View Status</a>
          <a href="${adminUrl}" style="display:inline-block;margin-left:8px;color:#17202a">Admin</a>
        </p>
      </div>
    `
  });
}

async function sendEmail(input: EmailInput): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = "InstaMosaic <onboarding@resend.dev>";

  if (!apiKey) {
    logWarn({
      event: input.event,
      jobId: input.jobId,
      user: input.to,
      message: "RESEND_API_KEY is not set; email was skipped.",
      metadata: { subject: input.subject, skipped: true }
    });
    trackEvent({ event: input.event, jobId: input.jobId, user: input.to, metadata: { skipped: true } });
    return;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html
      })
    });

    if (!response.ok) {
      throw new Error(`Resend failed with ${response.status}: ${await response.text()}`);
    }

    trackEvent({ event: input.event, jobId: input.jobId, user: input.to });
  } catch (error) {
    logError({
      event: input.event,
      jobId: input.jobId,
      user: input.to,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatMoney(amountCents?: number | null, currency?: string | null): string | null {
  if (typeof amountCents !== "number" || !Number.isFinite(amountCents)) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "usd"
    }).format(amountCents / 100);
  } catch {
    return `$${(amountCents / 100).toFixed(2)}`;
  }
}
