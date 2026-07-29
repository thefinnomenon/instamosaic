import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  DispatchStatus,
  EmailDeliveryStatus,
  GenerationJobStatus,
  Prisma,
  PrismaClient,
  type GeneratedAsset as PrismaGeneratedAsset,
  type GenerationJob as PrismaGenerationJob,
  type MarketingPost as PrismaMarketingPost,
  type MarketingTarget as PrismaMarketingTarget,
  type PrintOrder as PrismaPrintOrder
} from "./generated/prisma/client.ts";

type JsonRecord = Record<string, unknown>;

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type JobStep =
  | "Job created"
  | "Instagram verified"
  | "Downloading photos"
  | "Generating tiles"
  | "Building mosaic"
  | "Generating exports"
  | "Done"
  | "Failed"
  | string;

export type Job = {
  id: string;
  username: string;
  email: string;
  status: JobStatus;
  progress: number;
  step: JobStep;
  ig_public: number | null;
  ig_post_count: number | null;
  downloaded_count: number;
  skipped_count: number;
  photos_used: number;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  created_at: string;
  updated_at: string;
  error_message: string | null;
  retry_count: number;
  paid_at: string | null;
  amount_paid_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  hero_path: string;
  output_dir: string;
  preview_path: string | null;
  square_preview_path: string | null;
  download_token: string;
  ip_address: string | null;
  metadata: string | null;
};

export type PublicJob = {
  id: string;
  username: string;
  email: string;
  status: JobStatus;
  progress: number;
  step: string;
  queuePosition: number | null;
  igPublic: boolean | null;
  igPostCount: number | null;
  downloadedCount: number;
  skippedCount: number;
  photosUsed: number;
  processingStartedAt: string | null;
  processingCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  errorMessage: string | null;
  paid: boolean;
  previewAvailable: boolean;
  squarePreviewAvailable: boolean;
  downloadToken?: string;
  processingSeconds: number | null;
  oldestImagePostAt: string | null;
  newestImagePostAt: string | null;
  heroWidth: number | null;
  heroHeight: number | null;
  mosaicWidth: number | null;
  mosaicHeight: number | null;
  printOrder: PublicPrintOrder | null;
  assets?: PublicGeneratedAsset[];
};

export type PublicGeneratedAsset = {
  id: string;
  type: string;
  contentType: string;
  size: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
};

export type PublicPrintOrder = {
  id: number;
  status: string;
  printshrimpOrderId: string | null;
  tracking: string | null;
  trackingCourier: string | null;
  completed: boolean | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateJobInput = {
  id?: string;
  username: string;
  email: string;
  heroPath: string;
  outputDir: string;
  ipAddress?: string | null;
  metadata?: JsonRecord;
};

export type PrintOrder = {
  id: number;
  job_id: string;
  stripe_session_id: string;
  external_order_number: string;
  status: string;
  printshrimp_order_id: string | null;
  tracking: string | null;
  tracking_courier: string | null;
  completed: number | null;
  request_payload: string | null;
  response_payload: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingTarget = {
  id: number;
  instagram_username: string;
  display_name: string | null;
  category: string;
  priority: number;
  status: string;
  notes: string | null;
  rights_status: string;
  rights_notes: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingPost = {
  id: number;
  target_id: number | null;
  job_id: string | null;
  kind: string;
  status: string;
  caption: string;
  best_asset_type: string | null;
  best_asset_path: string | null;
  reveal_video_path: string | null;
  planned_for: string | null;
  approved_at: string | null;
  published_at: string | null;
  permalink: string | null;
  publish_notes: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type InstagramMention = {
  id: number;
  source_url: string;
  username: string | null;
  text: string | null;
  status: string;
  permission_status: string;
  notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type GeneratedAsset = {
  id: string;
  job_id: string;
  type: string;
  bucket: string;
  object_key: string;
  content_type: string;
  size: number | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  etag: string | null;
  created_at: string;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

function createPrismaClient(): PrismaClient {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  if (databaseUrl.startsWith("prisma://") || databaseUrl.startsWith("prisma+postgres://")) {
    return new PrismaClient({ accelerateUrl: databaseUrl });
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl })
  });
}

export function nowIso(date = new Date()): string {
  return date.toISOString();
}

export function appRoot(): string {
  return process.cwd();
}

export function storageDir(): string {
  const directory = path.join(os.tmpdir(), "instamosaic");
  mkdirSync(directory, { recursive: true });
  return directory;
}

export function dbPath(): string {
  throw new Error("SQLite has been removed. Use Prisma Postgres via DATABASE_URL and DIRECT_URL.");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

export async function initDb(): Promise<void> {
  await prisma.$connect();
}

export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  const id = input.id ?? randomUUID();
  const token = randomToken();
  const metadata = input.metadata ?? {};
  const job = await prisma.generationJob.create({
    data: {
      id,
      username: input.username,
      email: input.email,
      downloadToken: token,
      ipAddress: input.ipAddress ?? null,
      input: {
        heroPath: input.heroPath,
        outputDir: input.outputDir
      },
      metadata: toJson(metadata),
      stage: "QUEUED",
      progress: 5
    }
  });
  await trackEvent({ event: "job_created", jobId: id, user: input.email, ip: input.ipAddress ?? undefined });
  await logInfo({ event: "job_created", jobId: id, user: input.email, message: `Created job for ${input.username}` });
  return toLegacyJob(job);
}

export async function getJob(id: string): Promise<Job | null> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  return job ? toLegacyJob(job) : null;
}

export async function getJobByDownloadToken(token: string): Promise<Job | null> {
  const job = await prisma.generationJob.findUnique({ where: { downloadToken: token } });
  return job ? toLegacyJob(job) : null;
}

export async function getJobByStripeSession(sessionId: string): Promise<Job | null> {
  const job = await prisma.generationJob.findUnique({ where: { stripeSessionId: sessionId } });
  return job ? toLegacyJob(job) : null;
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<Job> {
  const data: Prisma.GenerationJobUpdateInput = {};
  if (patch.status !== undefined) data.status = legacyStatusToPrisma(patch.status);
  if (patch.progress !== undefined) data.progress = patch.progress;
  if (patch.step !== undefined) data.stage = stageFromLegacyStep(patch.step);
  if (patch.ig_public !== undefined) data.igPublic = patch.ig_public == null ? null : patch.ig_public === 1;
  if (patch.ig_post_count !== undefined) data.igPostCount = patch.ig_post_count;
  if (patch.downloaded_count !== undefined) data.downloadedCount = patch.downloaded_count;
  if (patch.skipped_count !== undefined) data.skippedCount = patch.skipped_count;
  if (patch.photos_used !== undefined) data.photosUsed = patch.photos_used;
  if (patch.processing_started_at !== undefined) data.processingStartedAt = dateOrNull(patch.processing_started_at);
  if (patch.processing_completed_at !== undefined) {
    const completed = dateOrNull(patch.processing_completed_at);
    data.completedAt = completed;
    if (completed && patch.status === "completed") data.failedAt = null;
  }
  if (patch.error_message !== undefined) data.errorMessage = patch.error_message;
  if (patch.retry_count !== undefined) data.attemptCount = patch.retry_count;
  if (patch.paid_at !== undefined) data.paidAt = dateOrNull(patch.paid_at);
  if (patch.amount_paid_cents !== undefined) data.amountPaidCents = patch.amount_paid_cents;
  if (patch.currency !== undefined) data.currency = patch.currency;
  if (patch.stripe_session_id !== undefined) data.stripeSessionId = patch.stripe_session_id;
  if (patch.metadata !== undefined) data.metadata = toJson(parseJsonRecord(patch.metadata));
  if (patch.status === "failed") data.failedAt = new Date();
  if (Object.keys(data).length === 0) {
    const current = await getJob(id);
    if (!current) throw new Error(`Job not found: ${id}`);
    return current;
  }
  const job = await prisma.generationJob.update({ where: { id }, data });
  return toLegacyJob(job);
}

export async function claimNextJob(): Promise<Job | null> {
  const candidate = await prisma.generationJob.findFirst({
    where: { status: GenerationJobStatus.QUEUED },
    orderBy: { createdAt: "asc" }
  });
  if (!candidate) return null;
  const claimed = await claimJob(candidate.id);
  return claimed;
}

export async function claimJob(id: string): Promise<Job | null> {
  const now = new Date();
  const result = await prisma.generationJob.updateMany({
    where: {
      id,
      status: GenerationJobStatus.QUEUED
    },
    data: {
      status: GenerationJobStatus.PROCESSING,
      progress: 5,
      stage: "QUEUED",
      processingStartedAt: now,
      heartbeatAt: now,
      attemptCount: { increment: 1 },
      errorMessage: null,
      errorCode: null
    }
  });
  if (result.count === 0) return getJob(id);
  return getJob(id);
}

export async function incrementJobRetry(id: string): Promise<void> {
  await prisma.generationJob.update({ where: { id }, data: { attemptCount: { increment: 1 } } });
}

export async function markJobPaid(input: {
  jobId: string;
  stripeSessionId?: string | null;
  amountPaidCents?: number | null;
  currency?: string | null;
}): Promise<Job> {
  const job = await prisma.generationJob.update({
    where: { id: input.jobId },
    data: {
      paidAt: new Date(),
      stripeSessionId: input.stripeSessionId ?? null,
      amountPaidCents: input.amountPaidCents ?? null,
      currency: input.currency ?? null
    }
  });
  return toLegacyJob(job);
}

export async function recordGeneratedAsset(input: {
  jobId: string;
  type: string;
  bucket: string;
  objectKey: string;
  contentType: string;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  checksum?: string | null;
  etag?: string | null;
}): Promise<GeneratedAsset> {
  const asset = await prisma.generatedAsset.upsert({
    where: { jobId_type: { jobId: input.jobId, type: input.type } },
    create: {
      jobId: input.jobId,
      type: input.type,
      bucket: input.bucket,
      objectKey: input.objectKey,
      contentType: input.contentType,
      size: input.size ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: input.checksum ?? null,
      etag: input.etag ?? null
    },
    update: {
      bucket: input.bucket,
      objectKey: input.objectKey,
      contentType: input.contentType,
      size: input.size ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: input.checksum ?? null,
      etag: input.etag ?? null
    }
  });
  return toLegacyAsset(asset);
}

export async function listGeneratedAssets(jobId: string): Promise<GeneratedAsset[]> {
  const assets = await prisma.generatedAsset.findMany({ where: { jobId }, orderBy: { createdAt: "asc" } });
  return assets.map(toLegacyAsset);
}

export async function getGeneratedAsset(jobId: string, type: string): Promise<GeneratedAsset | null> {
  const asset = await prisma.generatedAsset.findUnique({ where: { jobId_type: { jobId, type } } });
  return asset ? toLegacyAsset(asset) : null;
}

export async function createJobDispatch(jobId: string): Promise<void> {
  await prisma.jobDispatch.create({ data: { jobId } });
}

export async function markJobDispatchSent(input: { id?: string; jobId: string; taskName?: string | null }): Promise<void> {
  const dispatch = input.id
    ? await prisma.jobDispatch.findUnique({ where: { id: input.id } })
    : await prisma.jobDispatch.findFirst({ where: { jobId: input.jobId, status: DispatchStatus.PENDING }, orderBy: { createdAt: "asc" } });
  if (!dispatch) return;
  await prisma.jobDispatch.update({
    where: { id: dispatch.id },
    data: { status: DispatchStatus.SENT, taskName: input.taskName ?? null, sentAt: new Date(), errorMessage: null }
  });
}

export async function markJobDispatchFailed(input: { jobId: string; errorMessage: string }): Promise<void> {
  const dispatch = await prisma.jobDispatch.findFirst({ where: { jobId: input.jobId, status: DispatchStatus.PENDING }, orderBy: { createdAt: "asc" } });
  if (!dispatch) return;
  await prisma.jobDispatch.update({
    where: { id: dispatch.id },
    data: { status: DispatchStatus.FAILED, errorMessage: input.errorMessage }
  });
}

export async function markCompletionEmailSent(input: { jobId: string; providerMessageId?: string | null }): Promise<void> {
  const now = new Date();
  await prisma.$transaction([
    prisma.emailDelivery.upsert({
      where: { jobId_kind: { jobId: input.jobId, kind: "completion" } },
      create: {
        jobId: input.jobId,
        kind: "completion",
        recipient: "",
        status: EmailDeliveryStatus.SENT,
        providerMessageId: input.providerMessageId ?? null,
        sentAt: now
      },
      update: {
        status: EmailDeliveryStatus.SENT,
        providerMessageId: input.providerMessageId ?? null,
        sentAt: now,
        errorMessage: null
      }
    }),
    prisma.generationJob.update({ where: { id: input.jobId }, data: { completionEmailSentAt: now } })
  ]);
}

export async function claimEmailDelivery(input: { jobId: string; kind: string; recipient: string; staleAfterMs?: number }): Promise<boolean> {
  try {
    await prisma.emailDelivery.create({
      data: {
        jobId: input.jobId,
        kind: input.kind,
        recipient: input.recipient,
        status: EmailDeliveryStatus.PENDING
      }
    });
    return true;
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const staleCutoff = new Date(Date.now() - (input.staleAfterMs ?? 30 * 60_000));
  const claimed = await prisma.emailDelivery.updateMany({
    where: {
      jobId: input.jobId,
      kind: input.kind,
      OR: [
        { status: EmailDeliveryStatus.FAILED },
        { status: EmailDeliveryStatus.PENDING, updatedAt: { lt: staleCutoff } }
      ]
    },
    data: {
      recipient: input.recipient,
      status: EmailDeliveryStatus.PENDING,
      errorMessage: null,
      providerMessageId: null
    }
  });
  return claimed.count > 0;
}

export async function markEmailDeliverySent(input: { jobId: string; kind: string; providerMessageId?: string | null }): Promise<void> {
  const now = new Date();
  await prisma.emailDelivery.update({
    where: { jobId_kind: { jobId: input.jobId, kind: input.kind } },
    data: {
      status: EmailDeliveryStatus.SENT,
      providerMessageId: input.providerMessageId ?? null,
      sentAt: now,
      errorMessage: null
    }
  });
  if (input.kind === "completion") {
    await prisma.generationJob.update({ where: { id: input.jobId }, data: { completionEmailSentAt: now } });
  }
  if (input.kind === "failure") {
    await prisma.generationJob.update({ where: { id: input.jobId }, data: { failureEmailSentAt: now } });
  }
}

export async function markEmailDeliveryFailed(input: { jobId: string; kind: string; errorMessage: string }): Promise<void> {
  await prisma.emailDelivery.update({
    where: { jobId_kind: { jobId: input.jobId, kind: input.kind } },
    data: {
      status: EmailDeliveryStatus.FAILED,
      errorMessage: input.errorMessage
    }
  });
}

export async function getPrintOrderByStripeSession(sessionId: string): Promise<PrintOrder | null> {
  const order = await prisma.printOrder.findUnique({ where: { stripeSessionId: sessionId } });
  return order ? toLegacyPrintOrder(order) : null;
}

export async function getPrintOrder(id: number): Promise<PrintOrder | null> {
  const order = await prisma.printOrder.findUnique({ where: { id } });
  return order ? toLegacyPrintOrder(order) : null;
}

export async function getLatestPrintOrderForJob(jobId: string): Promise<PrintOrder | null> {
  const order = await prisma.printOrder.findFirst({ where: { jobId }, orderBy: { createdAt: "desc" } });
  return order ? toLegacyPrintOrder(order) : null;
}

export async function createPrintOrder(input: {
  jobId: string;
  stripeSessionId: string;
  externalOrderNumber: string;
  requestPayload: unknown;
}): Promise<PrintOrder> {
  const order = await prisma.printOrder.create({
    data: {
      jobId: input.jobId,
      stripeSessionId: input.stripeSessionId,
      externalOrderNumber: input.externalOrderNumber,
      status: "submitting",
      requestPayload: toJson(input.requestPayload)
    }
  });
  return toLegacyPrintOrder(order);
}

export async function markPrintOrderSubmitted(input: {
  stripeSessionId: string;
  printshrimpOrderId?: string | null;
  responsePayload: unknown;
  status?: string | null;
  tracking?: string | null;
  trackingCourier?: string | null;
  completed?: boolean | null;
}): Promise<void> {
  await prisma.printOrder.update({
    where: { stripeSessionId: input.stripeSessionId },
    data: {
      status: input.status ?? "submitted",
      printshrimpOrderId: input.printshrimpOrderId ?? null,
      tracking: input.tracking ?? null,
      trackingCourier: input.trackingCourier ?? null,
      completed: input.completed ?? null,
      responsePayload: toJson(input.responsePayload),
      errorMessage: null
    }
  });
}

export async function updatePrintOrderStatus(input: {
  stripeSessionId: string;
  printshrimpOrderId?: string | null;
  status?: string | null;
  tracking?: string | null;
  trackingCourier?: string | null;
  completed?: boolean | null;
  responsePayload: unknown;
}): Promise<void> {
  const data: Prisma.PrintOrderUpdateInput = {
    tracking: input.tracking ?? null,
    trackingCourier: input.trackingCourier ?? null,
    completed: input.completed ?? null,
    responsePayload: toJson(input.responsePayload),
    errorMessage: null
  };
  if (input.printshrimpOrderId !== undefined) data.printshrimpOrderId = input.printshrimpOrderId;
  if (input.status != null) data.status = input.status;
  await prisma.printOrder.update({
    where: { stripeSessionId: input.stripeSessionId },
    data
  });
}

export async function markPrintOrderFailed(input: {
  stripeSessionId: string;
  errorMessage: string;
  responsePayload?: unknown;
}): Promise<void> {
  await prisma.printOrder.update({
    where: { stripeSessionId: input.stripeSessionId },
    data: {
      status: "failed",
      errorMessage: input.errorMessage,
      ...(input.responsePayload == null ? {} : { responsePayload: toJson(input.responsePayload) })
    }
  });
}

export async function upsertMarketingTarget(input: {
  instagramUsername: string;
  displayName?: string | null;
  category?: string | null;
  priority?: number | null;
  status?: string | null;
  notes?: string | null;
  rightsStatus?: string | null;
  rightsNotes?: string | null;
}): Promise<MarketingTarget> {
  const existing = await prisma.marketingTarget.findUnique({ where: { instagramUsername: input.instagramUsername } });
  const target = await prisma.marketingTarget.upsert({
    where: { instagramUsername: input.instagramUsername },
    create: {
      instagramUsername: input.instagramUsername,
      displayName: input.displayName ?? null,
      category: input.category || "creator",
      priority: input.priority ?? 0,
      status: input.status || "active",
      notes: input.notes ?? null,
      rightsStatus: input.rightsStatus || "unknown",
      rightsNotes: input.rightsNotes ?? null
    },
    update: {
      displayName: input.displayName ?? existing?.displayName ?? null,
      category: input.category || existing?.category || "creator",
      priority: input.priority ?? existing?.priority ?? 0,
      status: input.status || existing?.status || "active",
      notes: input.notes ?? existing?.notes ?? null,
      rightsStatus: input.rightsStatus ?? existing?.rightsStatus ?? "unknown",
      rightsNotes: input.rightsNotes ?? existing?.rightsNotes ?? null
    }
  });
  return toLegacyMarketingTarget(target);
}

export async function getMarketingTargetByUsername(username: string): Promise<MarketingTarget | null> {
  const target = await prisma.marketingTarget.findFirst({ where: { instagramUsername: { equals: username, mode: "insensitive" } } });
  return target ? toLegacyMarketingTarget(target) : null;
}

export async function createMarketingPost(input: {
  targetId?: number | null;
  jobId?: string | null;
  kind?: string | null;
  status?: string | null;
  caption: string;
  bestAssetType?: string | null;
  bestAssetPath?: string | null;
  revealVideoPath?: string | null;
  plannedFor?: string | null;
}): Promise<MarketingPost> {
  const post = await prisma.marketingPost.create({
    data: {
      targetId: input.targetId ?? null,
      jobId: input.jobId ?? null,
      kind: input.kind || "reel",
      status: input.status || "draft",
      caption: input.caption,
      bestAssetType: input.bestAssetType ?? null,
      bestAssetPath: input.bestAssetPath ?? null,
      revealVideoPath: input.revealVideoPath ?? null,
      plannedFor: dateOrNull(input.plannedFor)
    }
  });
  await trackEvent({ event: "marketing_post_created", jobId: input.jobId ?? undefined, metadata: { marketingPostId: post.id, targetId: input.targetId ?? null } });
  return toLegacyMarketingPost(post);
}

export async function getMarketingPost(id: number): Promise<MarketingPost | null> {
  const post = await prisma.marketingPost.findUnique({ where: { id } });
  return post ? toLegacyMarketingPost(post) : null;
}

export async function updateMarketingPost(id: number, patch: Partial<MarketingPost>): Promise<MarketingPost> {
  const post = await prisma.marketingPost.update({
    where: { id },
    data: {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.caption !== undefined ? { caption: patch.caption } : {}),
      ...(patch.best_asset_type !== undefined ? { bestAssetType: patch.best_asset_type } : {}),
      ...(patch.best_asset_path !== undefined ? { bestAssetPath: patch.best_asset_path } : {}),
      ...(patch.reveal_video_path !== undefined ? { revealVideoPath: patch.reveal_video_path } : {}),
      ...(patch.planned_for !== undefined ? { plannedFor: dateOrNull(patch.planned_for) } : {}),
      ...(patch.approved_at !== undefined ? { approvedAt: dateOrNull(patch.approved_at) } : {}),
      ...(patch.published_at !== undefined ? { publishedAt: dateOrNull(patch.published_at) } : {}),
      ...(patch.permalink !== undefined ? { permalink: patch.permalink } : {}),
      ...(patch.publish_notes !== undefined ? { publishNotes: patch.publish_notes } : {}),
      ...(patch.error_message !== undefined ? { errorMessage: patch.error_message } : {})
    }
  });
  return toLegacyMarketingPost(post);
}

export async function listRecentMarketingPosts(limit = 20): Promise<MarketingPost[]> {
  const posts = await prisma.marketingPost.findMany({ orderBy: { createdAt: "desc" }, take: Math.max(1, Math.min(100, limit)) });
  return posts.map(toLegacyMarketingPost);
}

export async function listMarketingTargets(limit = 100): Promise<MarketingTarget[]> {
  const targets = await prisma.marketingTarget.findMany({
    orderBy: [{ status: "asc" }, { priority: "desc" }, { updatedAt: "desc" }],
    take: Math.max(1, Math.min(500, limit))
  });
  return targets.map(toLegacyMarketingTarget);
}

export async function createInstagramMention(input: {
  sourceUrl: string;
  username?: string | null;
  text?: string | null;
  status?: string | null;
  permissionStatus?: string | null;
  notes?: string | null;
}): Promise<InstagramMention> {
  const update: Prisma.InstagramMentionUpdateInput = {
    status: input.status || "new",
    permissionStatus: input.permissionStatus || "unknown"
  };
  if (input.username !== undefined) update.username = input.username;
  if (input.text !== undefined) update.text = input.text;
  if (input.notes !== undefined) update.notes = input.notes;
  const mention = await prisma.instagramMention.upsert({
    where: { sourceUrl: input.sourceUrl },
    create: {
      sourceUrl: input.sourceUrl,
      username: input.username ?? null,
      text: input.text ?? null,
      status: input.status || "new",
      permissionStatus: input.permissionStatus || "unknown",
      notes: input.notes ?? null
    },
    update
  });
  return {
    id: mention.id,
    source_url: mention.sourceUrl,
    username: mention.username,
    text: mention.text,
    status: mention.status,
    permission_status: mention.permissionStatus,
    notes: mention.notes,
    reviewed_at: isoOrNull(mention.reviewedAt),
    created_at: mention.createdAt.toISOString(),
    updated_at: mention.updatedAt.toISOString()
  };
}

export async function toPublicJob(job: Job, includeDownloadToken = false): Promise<PublicJob> {
  const started = job.processing_started_at ? Date.parse(job.processing_started_at) : Number.NaN;
  const completed = job.processing_completed_at ? Date.parse(job.processing_completed_at) : Number.NaN;
  const processingSeconds = Number.isFinite(started) && Number.isFinite(completed) ? Math.max(0, Math.round((completed - started) / 1000)) : null;
  const metadata = parseJsonRecord(job.metadata);
  const instagramMetadata = objectValue(metadata.instagram) ?? {};
  const mosaicMetadata = objectValue(metadata.mosaic) ?? {};
  const assets = await listGeneratedAssets(job.id);

  return {
    id: job.id,
    username: job.username,
    email: job.email,
    status: job.status,
    progress: job.progress,
    step: job.step,
    queuePosition: await queuePosition(job),
    igPublic: job.ig_public == null ? null : job.ig_public === 1,
    igPostCount: job.ig_post_count,
    downloadedCount: job.downloaded_count,
    skippedCount: job.skipped_count,
    photosUsed: job.photos_used,
    processingStartedAt: job.processing_started_at,
    processingCompletedAt: job.processing_completed_at,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    errorMessage: job.error_message,
    paid: Boolean(job.paid_at),
    previewAvailable: assets.some((asset) => asset.type === "socialPreview") || Boolean(job.preview_path),
    squarePreviewAvailable: assets.some((asset) => asset.type === "squarePreview") || Boolean(job.square_preview_path),
    ...(includeDownloadToken ? { downloadToken: job.download_token } : {}),
    processingSeconds,
    oldestImagePostAt: typeof instagramMetadata.oldestImagePostAt === "string" ? instagramMetadata.oldestImagePostAt : null,
    newestImagePostAt: typeof instagramMetadata.newestImagePostAt === "string" ? instagramMetadata.newestImagePostAt : null,
    heroWidth: finiteNumber(metadata.heroWidth),
    heroHeight: finiteNumber(metadata.heroHeight),
    mosaicWidth: finiteNumber(mosaicMetadata.masterWidth),
    mosaicHeight: finiteNumber(mosaicMetadata.masterHeight),
    printOrder: toPublicPrintOrder(await getLatestPrintOrderForJob(job.id)),
    assets: assets.map((asset) => ({
      id: asset.id,
      type: asset.type,
      contentType: asset.content_type,
      size: asset.size,
      width: asset.width,
      height: asset.height,
      createdAt: asset.created_at
    }))
  };
}

export async function trackEvent(input: {
  event: string;
  jobId?: string | undefined;
  user?: string | undefined;
  ip?: string | undefined;
  metadata?: JsonRecord | undefined;
}): Promise<void> {
  await prisma.analyticsEvent.create({
    data: {
      jobId: input.jobId ?? null,
      event: input.event,
      user: input.user ?? null,
      ip: input.ip ?? null,
      metadata: toJson(input.metadata ?? {})
    }
  });
}

export async function logInfo(input: {
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  metadata?: JsonRecord | undefined;
}): Promise<void> {
  await writeLog({ ...input, level: "info" });
}

export async function logWarn(input: {
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  metadata?: JsonRecord | undefined;
}): Promise<void> {
  await writeLog({ ...input, level: "warn" });
}

export async function logError(input: {
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  stack?: string | undefined;
  metadata?: JsonRecord | undefined;
}): Promise<void> {
  await writeLog({ ...input, level: "error" });
}

export async function assertRateLimit(input: {
  scope: string;
  identity: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const nowMs = Date.now();
  const row = await prisma.rateLimit.findUnique({ where: { scope_identity: { scope: input.scope, identity: input.identity } } });
  if (!row || nowMs - Number(row.windowStartMs) >= input.windowMs) {
    await prisma.rateLimit.upsert({
      where: { scope_identity: { scope: input.scope, identity: input.identity } },
      create: { scope: input.scope, identity: input.identity, windowStartMs: BigInt(nowMs), count: 1 },
      update: { windowStartMs: BigInt(nowMs), count: 1 }
    });
    return { allowed: true, remaining: Math.max(0, input.limit - 1), retryAfterSeconds: 0 };
  }
  const retryAfterSeconds = Math.max(1, Math.ceil((input.windowMs - (nowMs - Number(row.windowStartMs))) / 1000));
  if (row.count >= input.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  await prisma.rateLimit.update({
    where: { scope_identity: { scope: input.scope, identity: input.identity } },
    data: { count: { increment: 1 } }
  });
  return { allowed: true, remaining: Math.max(0, input.limit - row.count - 1), retryAfterSeconds: 0 };
}

export async function hasActiveJobForIp(ip: string): Promise<boolean> {
  const count = await prisma.generationJob.count({ where: { ipAddress: ip, status: { in: [GenerationJobStatus.QUEUED, GenerationJobStatus.PROCESSING] } } });
  return count > 0;
}

export async function hasActiveJobForEmail(email: string): Promise<boolean> {
  const count = await prisma.generationJob.count({
    where: { email: { equals: email, mode: "insensitive" }, status: { in: [GenerationJobStatus.QUEUED, GenerationJobStatus.PROCESSING] } }
  });
  return count > 0;
}

export async function recordDownloadStarted(input: { jobId: string; token: string; outputType: string; ip?: string | undefined }): Promise<number> {
  const row = await prisma.download.create({
    data: {
      jobId: input.jobId,
      token: input.token,
      outputType: input.outputType,
      ip: input.ip ?? null
    }
  });
  await trackEvent({ event: "download_started", jobId: input.jobId, ip: input.ip, metadata: { outputType: input.outputType } });
  return row.id;
}

export async function recordDownloadCompleted(downloadId: number, jobId: string, outputType: string, ip?: string | undefined): Promise<void> {
  await prisma.download.update({ where: { id: downloadId }, data: { completedAt: new Date() } });
  await trackEvent({ event: "download_completed", jobId, ip, metadata: { outputType } });
}

export async function getDashboardMetrics(): Promise<Record<string, unknown>> {
  const [
    totalJobs,
    completedJobs,
    failedJobs,
    paidJobs,
    downloads,
    printOrders,
    revenue,
    recentJobs,
    recentAnalytics,
    recentErrors,
    recentPrintOrders,
    recentMarketingPosts,
    funnel
  ] = await Promise.all([
    prisma.generationJob.count(),
    prisma.generationJob.count({ where: { status: GenerationJobStatus.COMPLETED } }),
    prisma.generationJob.count({ where: { status: GenerationJobStatus.FAILED } }),
    prisma.generationJob.count({ where: { paidAt: { not: null } } }),
    prisma.download.count({ where: { completedAt: { not: null } } }),
    prisma.printOrder.count(),
    prisma.generationJob.aggregate({ where: { paidAt: { not: null } }, _sum: { amountPaidCents: true } }),
    prisma.generationJob.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.analyticsEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.logEntry.findMany({ where: { level: "error" }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.printOrder.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.marketingPost.findMany({ include: { target: true, job: true }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.analyticsEvent.groupBy({
      by: ["event"],
      where: {
        event: {
          in: [
            "landing_page_loaded",
            "instagram_check_public",
            "form_completed",
            "submit_clicked",
            "job_created",
            "worker_completed",
            "checkout_clicked",
            "stripe_checkout_completed",
            "download_completed"
          ]
        }
      },
      _count: { event: true }
    })
  ]);

  const averageProcessingSeconds = await averageProcessingSecondsValue();

  return {
    totalJobs,
    completedJobs,
    failedJobs,
    paidJobs,
    averageProcessingSeconds,
    revenueCents: revenue._sum.amountPaidCents ?? 0,
    downloads,
    printOrders,
    conversion: {
      completedRate: totalJobs ? completedJobs / totalJobs : 0,
      paidRate: completedJobs ? paidJobs / completedJobs : 0
    },
    funnel: funnel.map((row) => ({ event: row.event, count: row._count.event })),
    recentJobs: recentJobs.map((job) => ({
      id: job.id,
      username: job.username,
      email: job.email,
      status: prismaStatusToLegacy(job.status),
      progress: job.progress,
      step: legacyStepFromStage(job.stage),
      photos_used: job.photosUsed,
      paid_at: isoOrNull(job.paidAt),
      created_at: job.createdAt.toISOString(),
      updated_at: job.updatedAt.toISOString(),
      error_message: job.errorMessage
    })),
    recentPrintOrders: recentPrintOrders.map(toLegacyPrintOrder),
    recentMarketingPosts: recentMarketingPosts.map((post) => ({
      id: post.id,
      target: post.target?.instagramUsername ?? null,
      username: post.job?.username ?? null,
      job_status: post.job ? prismaStatusToLegacy(post.job.status) : null,
      job_progress: post.job?.progress ?? null,
      job_step: post.job ? legacyStepFromStage(post.job.stage) : null,
      download_token: post.job?.downloadToken ?? null,
      job_id: post.jobId,
      kind: post.kind,
      status: post.status,
      caption: post.caption,
      best_asset_type: post.bestAssetType,
      best_asset_path: post.bestAssetPath,
      reveal_video_path: post.revealVideoPath,
      planned_for: isoOrNull(post.plannedFor),
      approved_at: isoOrNull(post.approvedAt),
      published_at: isoOrNull(post.publishedAt),
      permalink: post.permalink,
      publish_notes: post.publishNotes,
      error_message: post.errorMessage,
      created_at: post.createdAt.toISOString(),
      updated_at: post.updatedAt.toISOString()
    })),
    recentAnalytics: recentAnalytics.map((row) => ({
      id: row.id,
      job_id: row.jobId,
      event: row.event,
      user: row.user,
      ip: row.ip,
      metadata: JSON.stringify(row.metadata ?? {}),
      created_at: row.createdAt.toISOString()
    })),
    recentErrors: recentErrors.map((row) => ({
      id: row.id,
      job_id: row.jobId,
      level: row.level,
      event: row.event,
      user: row.user,
      message: row.message,
      stack: row.stack,
      metadata: JSON.stringify(row.metadata ?? {}),
      created_at: row.createdAt.toISOString()
    }))
  };
}

export async function resetDbForTests(): Promise<void> {
  await prisma.$transaction([
    prisma.instagramMention.deleteMany(),
    prisma.marketingPost.deleteMany(),
    prisma.marketingTarget.deleteMany(),
    prisma.emailDelivery.deleteMany(),
    prisma.jobDispatch.deleteMany(),
    prisma.generatedAsset.deleteMany(),
    prisma.printOrder.deleteMany(),
    prisma.download.deleteMany(),
    prisma.analyticsEvent.deleteMany(),
    prisma.logEntry.deleteMany(),
    prisma.rateLimit.deleteMany(),
    prisma.generationJob.deleteMany()
  ]);
}

async function writeLog(input: {
  level: "info" | "warn" | "error";
  event: string;
  message: string;
  jobId?: string | undefined;
  user?: string | undefined;
  stack?: string | undefined;
  metadata?: JsonRecord | undefined;
}): Promise<void> {
  await prisma.logEntry.create({
    data: {
      jobId: input.jobId ?? null,
      level: input.level,
      event: input.event,
      user: input.user ?? null,
      message: input.message,
      stack: input.stack ?? null,
      metadata: toJson(input.metadata ?? {})
    }
  });
}

async function queuePosition(job: Job): Promise<number | null> {
  if (job.status !== "queued") return null;
  return 1 + await prisma.generationJob.count({
    where: {
      status: GenerationJobStatus.QUEUED,
      OR: [
        { createdAt: { lt: new Date(job.created_at) } },
        { createdAt: new Date(job.created_at), id: { lt: job.id } }
      ]
    }
  });
}

async function averageProcessingSecondsValue(): Promise<number> {
  const rows = await prisma.generationJob.findMany({
    where: { processingStartedAt: { not: null }, completedAt: { not: null } },
    select: { processingStartedAt: true, completedAt: true }
  });
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => {
    if (!row.processingStartedAt || !row.completedAt) return sum;
    return sum + Math.max(0, (row.completedAt.getTime() - row.processingStartedAt.getTime()) / 1000);
  }, 0);
  return Math.round(total / rows.length);
}

function toLegacyJob(job: PrismaGenerationJob): Job {
  const input = objectValue(job.input) ?? {};
  const metadata = objectValue(job.metadata) ?? {};
  return {
    id: job.id,
    username: job.username,
    email: job.email,
    status: prismaStatusToLegacy(job.status),
    progress: job.progress,
    step: legacyStepFromStage(job.stage),
    ig_public: job.igPublic == null ? null : job.igPublic ? 1 : 0,
    ig_post_count: job.igPostCount,
    downloaded_count: job.downloadedCount,
    skipped_count: job.skippedCount,
    photos_used: job.photosUsed,
    processing_started_at: isoOrNull(job.processingStartedAt),
    processing_completed_at: isoOrNull(job.completedAt),
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    error_message: job.errorMessage,
    retry_count: job.attemptCount,
    paid_at: isoOrNull(job.paidAt),
    amount_paid_cents: job.amountPaidCents,
    currency: job.currency,
    stripe_session_id: job.stripeSessionId,
    hero_path: typeof input.heroPath === "string" ? input.heroPath : "",
    output_dir: typeof input.outputDir === "string" ? input.outputDir : path.join(storageDir(), "jobs", job.id),
    preview_path: typeof metadata.previewPath === "string" ? metadata.previewPath : null,
    square_preview_path: typeof metadata.squarePreviewPath === "string" ? metadata.squarePreviewPath : null,
    download_token: job.downloadToken,
    ip_address: job.ipAddress,
    metadata: JSON.stringify(metadata)
  };
}

function toLegacyPrintOrder(order: PrismaPrintOrder): PrintOrder {
  return {
    id: order.id,
    job_id: order.jobId,
    stripe_session_id: order.stripeSessionId,
    external_order_number: order.externalOrderNumber,
    status: order.status,
    printshrimp_order_id: order.printshrimpOrderId,
    tracking: order.tracking,
    tracking_courier: order.trackingCourier,
    completed: order.completed == null ? null : order.completed ? 1 : 0,
    request_payload: order.requestPayload == null ? null : JSON.stringify(order.requestPayload),
    response_payload: order.responsePayload == null ? null : JSON.stringify(order.responsePayload),
    error_message: order.errorMessage,
    created_at: order.createdAt.toISOString(),
    updated_at: order.updatedAt.toISOString()
  };
}

function toLegacyMarketingTarget(target: PrismaMarketingTarget): MarketingTarget {
  return {
    id: target.id,
    instagram_username: target.instagramUsername,
    display_name: target.displayName,
    category: target.category,
    priority: target.priority,
    status: target.status,
    notes: target.notes,
    rights_status: target.rightsStatus,
    rights_notes: target.rightsNotes,
    created_at: target.createdAt.toISOString(),
    updated_at: target.updatedAt.toISOString()
  };
}

function toLegacyMarketingPost(post: PrismaMarketingPost): MarketingPost {
  return {
    id: post.id,
    target_id: post.targetId,
    job_id: post.jobId,
    kind: post.kind,
    status: post.status,
    caption: post.caption,
    best_asset_type: post.bestAssetType,
    best_asset_path: post.bestAssetPath,
    reveal_video_path: post.revealVideoPath,
    planned_for: isoOrNull(post.plannedFor),
    approved_at: isoOrNull(post.approvedAt),
    published_at: isoOrNull(post.publishedAt),
    permalink: post.permalink,
    publish_notes: post.publishNotes,
    error_message: post.errorMessage,
    created_at: post.createdAt.toISOString(),
    updated_at: post.updatedAt.toISOString()
  };
}

function toLegacyAsset(asset: PrismaGeneratedAsset): GeneratedAsset {
  return {
    id: asset.id,
    job_id: asset.jobId,
    type: asset.type,
    bucket: asset.bucket,
    object_key: asset.objectKey,
    content_type: asset.contentType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    checksum: asset.checksum,
    etag: asset.etag,
    created_at: asset.createdAt.toISOString()
  };
}

function toPublicPrintOrder(order: PrintOrder | null): PublicPrintOrder | null {
  if (!order) return null;
  return {
    id: order.id,
    status: order.status,
    printshrimpOrderId: order.printshrimp_order_id,
    tracking: order.tracking,
    trackingCourier: order.tracking_courier,
    completed: order.completed == null ? null : order.completed === 1,
    errorMessage: order.error_message,
    createdAt: order.created_at,
    updatedAt: order.updated_at
  };
}

function prismaStatusToLegacy(status: GenerationJobStatus): JobStatus {
  if (status === GenerationJobStatus.COMPLETED) return "completed";
  if (status === GenerationJobStatus.FAILED || status === GenerationJobStatus.CANCELLED) return "failed";
  if (status === GenerationJobStatus.PROCESSING) return "processing";
  return "queued";
}

function legacyStatusToPrisma(status: JobStatus): GenerationJobStatus {
  if (status === "completed") return GenerationJobStatus.COMPLETED;
  if (status === "failed") return GenerationJobStatus.FAILED;
  if (status === "processing") return GenerationJobStatus.PROCESSING;
  return GenerationJobStatus.QUEUED;
}

function stageFromLegacyStep(step: string): string {
  if (step === "Job created") return "QUEUED";
  if (step === "Instagram verified") return "PREPARING_IMAGES";
  if (step === "Downloading photos") return "DOWNLOADING_INPUTS";
  if (step === "Generating tiles") return "PREPARING_IMAGES";
  if (step === "Building mosaic") return "GENERATING_MASTER";
  if (step === "Generating exports") return "GENERATING_VARIANTS";
  if (step === "Done") return "COMPLETED";
  if (step === "Failed") return "FAILED";
  return step.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function legacyStepFromStage(stage: string): string {
  if (stage === "QUEUED") return "Job created";
  if (stage === "DOWNLOADING_INPUTS") return "Downloading photos";
  if (stage === "PREPARING_IMAGES") return "Generating tiles";
  if (stage === "GENERATING_MASTER") return "Building mosaic";
  if (stage === "GENERATING_VARIANTS") return "Generating exports";
  if (stage === "UPLOADING_OUTPUTS") return "Generating exports";
  if (stage === "FINALIZING") return "Generating exports";
  if (stage === "COMPLETED") return "Done";
  if (stage === "FAILED") return "Failed";
  return stage;
}

function parseJsonRecord(value: string | null | Prisma.JsonValue): JsonRecord {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return objectValue(parsed) ?? {};
    } catch {
      return {};
    }
  }
  return objectValue(value) ?? {};
}

function objectValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function dateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
