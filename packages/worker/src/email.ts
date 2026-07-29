import {
  claimEmailDelivery,
  logError,
  logWarn,
  markEmailDeliveryFailed,
  markEmailDeliverySent,
  trackEvent
} from "@instamosaic/db";
import { appUrl } from "./validation.ts";

type EmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  event: string;
  jobId: string;
};

type EmailSendResult = {
  sent: boolean;
  providerMessageId: string | null;
  errorMessage: string | null;
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
  const claimed = await claimEmailDelivery({
    jobId: input.jobId,
    kind: "completion",
    recipient: input.to
  });
  if (!claimed) return;

  const statusUrl = `${appUrl()}/status/${input.jobId}`;
  const result = await sendEmail({
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
  if (result.sent) {
    await markEmailDeliverySent({
      jobId: input.jobId,
      kind: "completion",
      providerMessageId: result.providerMessageId
    });
  } else {
    await markEmailDeliveryFailed({
      jobId: input.jobId,
      kind: "completion",
      errorMessage: result.errorMessage ?? "Completion email was not sent."
    });
  }
}

export async function sendFailureEmail(input: {
  to: string;
  jobId: string;
  username: string;
  errorMessage?: string | null;
}): Promise<void> {
  const claimed = await claimEmailDelivery({
    jobId: input.jobId,
    kind: "failure",
    recipient: input.to
  });
  if (!claimed) return;

  const statusUrl = `${appUrl()}/status/${input.jobId}`;
  const result = await sendEmail({
    to: input.to,
    jobId: input.jobId,
    event: "failure_email_sent",
    subject: "We couldn't finish your InstaMosaic",
    text: [
      `We couldn't finish the InstaMosaic for @${input.username}.`,
      "",
      input.errorMessage ? `Reason: ${input.errorMessage}` : "",
      "",
      `You can view the status here: ${statusUrl}`
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a">
        <h1 style="font-size:22px">We couldn't finish your InstaMosaic</h1>
        <p>We couldn't finish the InstaMosaic for @${escapeHtml(input.username)}.</p>
        ${input.errorMessage ? `<p><strong>Reason:</strong> ${escapeHtml(input.errorMessage)}</p>` : ""}
        <p><a href="${statusUrl}" style="display:inline-block;background:#17202a;color:white;padding:12px 16px;border-radius:6px;text-decoration:none">View Status</a></p>
      </div>
    `
  });
  if (result.sent) {
    await markEmailDeliverySent({
      jobId: input.jobId,
      kind: "failure",
      providerMessageId: result.providerMessageId
    });
  } else {
    await markEmailDeliveryFailed({
      jobId: input.jobId,
      kind: "failure",
      errorMessage: result.errorMessage ?? "Failure email was not sent."
    });
  }
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

export async function sendMarketingReviewEmail(input: {
  to: string;
  jobId: string;
  marketingPostId: number;
  username: string;
  caption: string;
  bestAssetType: string;
  bestAssetPath?: string | null;
  revealVideoPath?: string | null;
  downloadToken: string;
}): Promise<void> {
  const statusUrl = `${appUrl()}/status/${input.jobId}`;
  const adminUrl = `${appUrl()}/admin?marketingPostId=${input.marketingPostId}`;
  const revealUrl = `${appUrl()}/api/download/${input.downloadToken}/reveal`;
  const socialPreviewUrl = `${appUrl()}/api/jobs/${input.jobId}/preview`;
  const squarePreviewUrl = `${appUrl()}/api/jobs/${input.jobId}/preview?kind=square`;

  await sendEmail({
    to: input.to,
    jobId: input.jobId,
    event: "marketing_review_email_sent",
    subject: `Review InstaMosaic marketing draft: @${input.username}`,
    text: [
      `A marketing draft for @${input.username} is ready to review.`,
      "",
      `Draft ID: ${input.marketingPostId}`,
      `Best asset: ${input.bestAssetType}`,
      input.bestAssetPath ? `Best asset path: ${input.bestAssetPath}` : "",
      input.revealVideoPath ? `Reveal video path: ${input.revealVideoPath}` : "",
      "",
      "Caption draft:",
      input.caption,
      "",
      `Admin: ${adminUrl}`,
      `Status: ${statusUrl}`,
      `Reveal video: ${revealUrl}`,
      `Social preview: ${socialPreviewUrl}`,
      `Square preview: ${squarePreviewUrl}`
    ].filter(Boolean).join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202a">
        <h1 style="font-size:22px">Marketing draft ready</h1>
        <p>A marketing draft for <strong>@${escapeHtml(input.username)}</strong> is ready to review.</p>
        <p><strong>Draft ID:</strong> ${input.marketingPostId}</p>
        <p><strong>Best asset:</strong> ${escapeHtml(input.bestAssetType)}</p>
        ${input.bestAssetPath ? `<p><strong>Best asset path:</strong> ${escapeHtml(input.bestAssetPath)}</p>` : ""}
        ${input.revealVideoPath ? `<p><strong>Reveal video path:</strong> ${escapeHtml(input.revealVideoPath)}</p>` : ""}
        <p>
          <a href="${adminUrl}" style="display:inline-block;background:#17202a;color:white;padding:12px 16px;border-radius:6px;text-decoration:none">Review Draft</a>
          <a href="${statusUrl}" style="display:inline-block;margin-left:8px;color:#17202a">View Status</a>
        </p>
        <p>
          <a href="${revealUrl}" style="color:#17202a">Reveal video</a><br>
          <a href="${socialPreviewUrl}" style="color:#17202a">Social preview</a><br>
          <a href="${squarePreviewUrl}" style="color:#17202a">Square preview</a>
        </p>
        <h2 style="font-size:16px">Caption draft</h2>
        <pre style="white-space:pre-wrap;background:#f4f6f4;padding:12px;border-radius:6px">${escapeHtml(input.caption)}</pre>
      </div>
    `
  });
}

async function sendEmail(input: EmailInput): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = "InstaMosaic <onboarding@resend.dev>";

  if (!apiKey) {
    await logWarn({
      event: input.event,
      jobId: input.jobId,
      user: input.to,
      message: "RESEND_API_KEY is not set; email was skipped.",
      metadata: { subject: input.subject, skipped: true }
    });
    await trackEvent({ event: input.event, jobId: input.jobId, user: input.to, metadata: { skipped: true } });
    return { sent: false, providerMessageId: null, errorMessage: "RESEND_API_KEY is not set; email was skipped." };
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

    const payload = await response.json().catch(() => ({}));
    await trackEvent({ event: input.event, jobId: input.jobId, user: input.to });
    return {
      sent: true,
      providerMessageId: typeof payload?.id === "string" ? payload.id : null,
      errorMessage: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError({
      event: input.event,
      jobId: input.jobId,
      user: input.to,
      message,
      stack: error instanceof Error ? error.stack : undefined
    });
    return { sent: false, providerMessageId: null, errorMessage: message };
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
