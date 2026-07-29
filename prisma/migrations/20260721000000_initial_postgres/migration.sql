-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "EmailDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 5,
    "stage" TEXT NOT NULL DEFAULT 'QUEUED',
    "igPublic" BOOLEAN,
    "igPostCount" INTEGER,
    "downloadedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "photosUsed" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "input" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "completionEmailSentAt" TIMESTAMP(3),
    "failureEmailSentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "amountPaidCents" INTEGER,
    "currency" TEXT,
    "stripeSessionId" TEXT,
    "downloadToken" TEXT NOT NULL,
    "ipAddress" TEXT,
    "workerExecutionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedAsset" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "etag" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneratedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobDispatch" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'PENDING',
    "taskName" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "recipient" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT,
    "event" TEXT NOT NULL,
    "user" TEXT,
    "ip" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "event" TEXT NOT NULL,
    "user" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Download" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "outputType" TEXT NOT NULL,
    "ip" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "scope" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "windowStartMs" BIGINT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("scope","identity")
);

-- CreateTable
CREATE TABLE "PrintOrder" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "externalOrderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "printshrimpOrderId" TEXT,
    "tracking" TEXT,
    "trackingCourier" TEXT,
    "completed" BOOLEAN,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrintOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingTarget" (
    "id" SERIAL NOT NULL,
    "instagramUsername" TEXT NOT NULL,
    "displayName" TEXT,
    "category" TEXT NOT NULL DEFAULT 'creator',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "rightsStatus" TEXT NOT NULL DEFAULT 'unknown',
    "rightsNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPost" (
    "id" SERIAL NOT NULL,
    "targetId" INTEGER,
    "jobId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'reel',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "caption" TEXT NOT NULL,
    "bestAssetType" TEXT,
    "bestAssetPath" TEXT,
    "revealVideoPath" TEXT,
    "plannedFor" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "permalink" TEXT,
    "publishNotes" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstagramMention" (
    "id" SERIAL NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "username" TEXT,
    "text" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "permissionStatus" TEXT NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_stripeSessionId_key" ON "GenerationJob"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_downloadToken_key" ON "GenerationJob"("downloadToken");

-- CreateIndex
CREATE INDEX "GenerationJob_status_createdAt_idx" ON "GenerationJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationJob_email_status_idx" ON "GenerationJob"("email", "status");

-- CreateIndex
CREATE INDEX "GenerationJob_ipAddress_status_idx" ON "GenerationJob"("ipAddress", "status");

-- CreateIndex
CREATE INDEX "GeneratedAsset_jobId_createdAt_idx" ON "GeneratedAsset"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedAsset_jobId_type_key" ON "GeneratedAsset"("jobId", "type");

-- CreateIndex
CREATE INDEX "JobDispatch_status_createdAt_idx" ON "JobDispatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "JobDispatch_jobId_idx" ON "JobDispatch"("jobId");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_createdAt_idx" ON "EmailDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_jobId_kind_key" ON "EmailDelivery"("jobId", "kind");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_event_createdAt_idx" ON "AnalyticsEvent"("event", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_jobId_createdAt_idx" ON "AnalyticsEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "LogEntry_level_createdAt_idx" ON "LogEntry"("level", "createdAt");

-- CreateIndex
CREATE INDEX "LogEntry_jobId_createdAt_idx" ON "LogEntry"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Download_jobId_startedAt_idx" ON "Download"("jobId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrintOrder_stripeSessionId_key" ON "PrintOrder"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintOrder_externalOrderNumber_key" ON "PrintOrder"("externalOrderNumber");

-- CreateIndex
CREATE INDEX "PrintOrder_jobId_createdAt_idx" ON "PrintOrder"("jobId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingTarget_instagramUsername_key" ON "MarketingTarget"("instagramUsername");

-- CreateIndex
CREATE INDEX "MarketingTarget_status_priority_updatedAt_idx" ON "MarketingTarget"("status", "priority", "updatedAt");

-- CreateIndex
CREATE INDEX "MarketingPost_status_plannedFor_createdAt_idx" ON "MarketingPost"("status", "plannedFor", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingPost_jobId_idx" ON "MarketingPost"("jobId");

-- CreateIndex
CREATE INDEX "MarketingPost_targetId_createdAt_idx" ON "MarketingPost"("targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstagramMention_sourceUrl_key" ON "InstagramMention"("sourceUrl");

-- CreateIndex
CREATE INDEX "InstagramMention_status_createdAt_idx" ON "InstagramMention"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "GeneratedAsset" ADD CONSTRAINT "GeneratedAsset_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobDispatch" ADD CONSTRAINT "JobDispatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Download" ADD CONSTRAINT "Download_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintOrder" ADD CONSTRAINT "PrintOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPost" ADD CONSTRAINT "MarketingPost_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "MarketingTarget"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPost" ADD CONSTRAINT "MarketingPost_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
