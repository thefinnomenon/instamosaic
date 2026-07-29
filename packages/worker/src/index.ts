import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { downloadOutputTypes, generateMosaic, mosaicOptionsFromEnv } from "@instamosaic/mosaic";
import {
  claimNextJob,
  claimJob,
  createMarketingPost,
  getJob,
  incrementJobRetry,
  logError,
  logInfo,
  logWarn,
  nowIso,
  recordGeneratedAsset,
  storageDir,
  trackEvent,
  updateJob
} from "@instamosaic/db";
import { sendFailureEmail, sendMarketingReviewEmail, sendPreviewEmail, sendProcessingEmail } from "./email.ts";
import { checkInstagramProfile, downloadInstagramTiles } from "./instagram.ts";
import { generateRevealVideo, revealVideoFilename } from "./reveal-video.ts";
import { downloadToFile, jobOutputKey, storageBucket, uploadFile } from "@instamosaic/storage";
export { checkInstagramProfile, downloadInstagramTiles, downloadMarketingHeroImage, mockDownloadInstagramTiles } from "./instagram.ts";
export type { DownloadMarketingHeroResult, MarketingHeroSource } from "./instagram.ts";
export { sendAdminJobCreatedEmail, sendDigitalPurchaseEmail, sendMarketingReviewEmail } from "./email.ts";
export { appUrl, normalizeEmail, sanitizeInstagramUsername } from "./validation.ts";
export { buildRevealVideoCommand, generateRevealVideo, revealVideoFilename, type RevealVideoInput, type RevealVideoStats } from "./reveal-video.ts";

export type ProcessJobOptions = {
  allowRetry?: boolean;
};

export async function processJob(jobId: string, options: ProcessJobOptions = {}): Promise<void> {
  const allowRetry = options.allowRetry ?? true;
  const existing = await getJob(jobId);
  if (!existing) throw new Error(`Job not found: ${jobId}`);
  if (existing.status === "completed") return;
  if (existing.status === "processing") return;
  if (existing.status === "failed" && !allowRetry) return;

  const current = existing.status === "queued" ? await claimJob(jobId) : existing;
  if (!current || current.status !== "processing") return;
  const initialMetadata = parseJsonObject(current.metadata);

  await trackEvent({ event: "worker_started", jobId, user: current.email });
  await logInfo({ event: "worker_started", jobId, user: current.email, message: "Worker started processing job." });

  try {
    await ensureHeroInputAvailable(current, initialMetadata);
    const check = await checkInstagramProfile(current.username);
    if (!check.exists) {
      throw new Error("Instagram profile was not found.");
    }
    if (!check.is_public) {
      throw new Error("Instagram profile is private. Make it public and resubmit or retry.");
    }

    await updateJob(jobId, {
      progress: 6,
      step: "Instagram verified",
      ig_public: 1,
      ig_post_count: check.estimated_photo_count
    });
    await trackEvent({ event: "instagram_check_public", jobId, user: current.email, metadata: { estimatedPhotoCount: check.estimated_photo_count } });

    const tilesDir = path.join(current.output_dir, "tiles");
    await mkdir(tilesDir, { recursive: true });
    await updateJob(jobId, { progress: 8, step: "Downloading photos" });

    let lastDownloadProgress = 8;
    let lastDownloadProgressAt = 0;
    const updateDownloadProgress = (stage: string, downloaderProgress: number, downloadedCount?: number, totalCount?: number) => {
      const progress = Math.max(8, Math.min(70, Math.round(8 + downloaderProgress * 62)));
      const now = Date.now();
      if (progress <= lastDownloadProgress && now - lastDownloadProgressAt < 1_000) return;
      if (progress < 70 && progress - lastDownloadProgress < 1 && now - lastDownloadProgressAt < 750) return;
      lastDownloadProgress = progress;
      lastDownloadProgressAt = now;
      void updateJob(jobId, {
        progress,
        step: stage,
        ...(typeof downloadedCount === "number" ? { downloaded_count: downloadedCount } : {}),
        // Store actual photo count discovered during pagination (overrides profile estimate)
        ...(typeof totalCount === "number" && totalCount > 0 ? { ig_post_count: totalCount } : {})
      });
    };
    const download = await downloadInstagramTiles({
      username: current.username,
      outputDir: tilesDir,
      tileSize: mosaicOptionsFromEnv().tileSize,
      onProgress(event) {
        updateDownloadProgress(event.stage, event.progress, event.downloaded_count, event.total_count);
      }
    });

    if (download.downloaded_count === 0) {
      throw new Error(download.errors[0] || "No Instagram image posts could be downloaded.");
    }

    await updateJob(jobId, {
      progress: 72,
      step: "Generating tiles",
      downloaded_count: download.downloaded_count,
      skipped_count: download.skipped_count
    });

    let lastMosaicProgress = 72;
    let lastMosaicProgressAt = 0;
    const updateMosaicProgress = (stage: string, generatorProgress: number) => {
      const progress = Math.max(72, Math.min(98, Math.round(72 + generatorProgress * 26)));
      const now = Date.now();
      if (progress <= lastMosaicProgress && now - lastMosaicProgressAt < 1_000) return;
      if (progress < 98 && progress - lastMosaicProgress < 1 && now - lastMosaicProgressAt < 750) return;
      lastMosaicProgress = progress;
      lastMosaicProgressAt = now;
      void updateJob(jobId, { progress, step: stage === "Generating exports" ? "Generating exports" : "Building mosaic" });
    };

    const result = await generateMosaic({
      heroPath: current.hero_path,
      tilePaths: download.tile_paths,
      outputDir: current.output_dir,
      onProgress(stage, progress) {
        updateMosaicProgress(stage, progress);
      }
    });

    await updateJob(jobId, { progress: 98, step: "Generating exports" });
    const revealVideoPath = path.join(current.output_dir, revealVideoFilename);
    const revealWarnings: string[] = [];
    try {
      await generateRevealVideo({
        originalImage: current.hero_path,
        mosaicImage: result.outputs.revealPreview.path,
        outputVideo: revealVideoPath,
        stats: {
          username: current.username,
          instagramPhotoCount: result.tileCount,
          tileCount: result.cells
        },
        logger: {
          debug: (message, metadata) => void logInfo({ event: "reveal_video_debug", jobId, user: current.email, message, metadata }),
          info: (message, metadata) => void logInfo({ event: "reveal_video_generated", jobId, user: current.email, message, metadata })
        }
      });
      await trackEvent({ event: "reveal_video_generated", jobId, user: current.email, metadata: { output: revealVideoFilename } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      revealWarnings.push(`Reveal video was not generated: ${message}`);
      await logWarn({
        event: "reveal_video_failed",
        jobId,
        user: current.email,
        message,
        metadata: { output: revealVideoFilename }
      });
      await trackEvent({ event: "reveal_video_failed", jobId, user: current.email, metadata: { message } });
    }

    await uploadGeneratedOutputs({
      jobId,
      outputDir: current.output_dir,
      outputs: result.outputs,
      revealVideoPath,
      revealGenerated: revealWarnings.length === 0
    });

    const completedJob = await updateJob(jobId, {
      status: "completed",
      progress: 100,
      step: "Done",
      photos_used: result.tileCount,
      preview_path: result.outputs.socialPreview.path,
      square_preview_path: result.outputs.squarePreview.path,
      processing_completed_at: nowIso(),
      metadata: JSON.stringify({
        ...initialMetadata,
        previewPath: result.outputs.socialPreview.path,
        squarePreviewPath: result.outputs.squarePreview.path,
        instagram: {
          oldestImagePostAt: download.oldest_image_post_at ?? null,
          newestImagePostAt: download.newest_image_post_at ?? null
        },
        mosaic: {
          cells: result.cells,
          columns: result.columns,
          rows: result.rows,
          masterWidth: result.masterWidth,
          masterHeight: result.masterHeight,
          maxTileReuse: result.maxTileReuse,
          processingMs: result.processingMs,
          revealVideo: revealWarnings.length === 0 ? revealVideoFilename : null,
          warnings: [...download.warnings, ...result.warnings, ...revealWarnings]
        }
      })
    });

    await trackEvent({ event: "worker_completed", jobId, user: current.email, metadata: { photosUsed: result.tileCount } });
    await logInfo({ event: "worker_completed", jobId, user: current.email, message: "Worker completed job.", metadata: { photosUsed: result.tileCount } });
    if (!isMarketingJob(initialMetadata)) {
      await sendPreviewEmail({ to: current.email, jobId, username: current.username });
    } else {
      try {
        await maybeCreateMarketingDraft({
          jobId,
          username: current.username,
          reviewEmail: current.email,
          outputDir: current.output_dir,
          previewPath: result.outputs.socialPreview.path,
          squarePreviewPath: result.outputs.squarePreview.path,
          downloadToken: completedJob.download_token,
          metadata: initialMetadata
        });
      } catch (draftError) {
        await logError({
          event: "marketing_draft_failed",
          jobId,
          user: current.email,
          message: draftError instanceof Error ? draftError.message : String(draftError),
          stack: draftError instanceof Error ? draftError.stack : undefined
        });
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError({
      event: "worker_failed",
      jobId,
      user: current.email,
      message,
      stack: error instanceof Error ? error.stack : undefined
    });
    await trackEvent({ event: "worker_failed", jobId, user: current.email, metadata: { message, retry: allowRetry } });

    const latest = await getJob(jobId);
    if (allowRetry && latest && latest.retry_count < 1) {
      await incrementJobRetry(jobId);
      await updateJob(jobId, {
        status: "queued",
        progress: 5,
        step: "Job created",
        error_message: `Retrying after failure: ${message}`
      });
      await logWarn({ event: "worker_retry", jobId, user: current.email, message: "Retrying failed job once." });
      await processJob(jobId, { allowRetry: false });
      return;
    }

    await updateJob(jobId, {
      status: "failed",
      progress: 100,
      step: "Failed",
      error_message: message,
      processing_completed_at: nowIso()
    });
    if (!isMarketingJob(initialMetadata)) {
      await sendFailureEmail({ to: current.email, jobId, username: current.username, errorMessage: message });
    }
  }
}

export async function processNextJob(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;
  await processJob(job.id);
  return true;
}

export async function runWorkerLoop(input: { pollMs?: number | undefined; once?: boolean | undefined } = {}): Promise<void> {
  const pollMs = input.pollMs ?? 5_000;
  await mkdir(storageDir(), { recursive: true });
  while (true) {
    const processed = await processNextJob();
    if (input.once) return;
    if (!processed) await sleep(pollMs);
  }
}

export async function sendInitialProcessingEmail(input: {
  to: string;
  jobId: string;
  username: string;
}): Promise<void> {
  await sendProcessingEmail(input);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isMarketingJob(metadata: Record<string, unknown>): boolean {
  if (metadata.purpose === "marketing") return true;
  const marketing = metadata.marketing;
  return Boolean(marketing && typeof marketing === "object");
}

async function maybeCreateMarketingDraft(input: {
  jobId: string;
  username: string;
  reviewEmail: string;
  outputDir: string;
  previewPath: string | null;
  squarePreviewPath: string | null;
  downloadToken: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const marketing = objectValue(input.metadata.marketing);
  if (!marketing || marketing.autoDraft !== true) return;

  const assets = bestInstagramAsset(input.outputDir, input.previewPath, input.squarePreviewPath);
  const targetId = typeof marketing.targetId === "number" ? marketing.targetId : null;
  const caption = typeof marketing.caption === "string" && marketing.caption.trim()
    ? marketing.caption.trim()
    : defaultMarketingCaption(input.username);
  const reviewEmail = typeof marketing.reviewEmail === "string" && marketing.reviewEmail.trim()
    ? marketing.reviewEmail.trim()
    : input.reviewEmail;

  const post = await createMarketingPost({
    targetId,
    jobId: input.jobId,
    kind: assets.bestAssetType === "reveal_video" ? "reel" : "feed",
    caption,
    bestAssetType: assets.bestAssetType,
    bestAssetPath: assets.bestAssetPath,
    revealVideoPath: assets.revealVideoPath
  });

  await sendMarketingReviewEmail({
    to: reviewEmail,
    jobId: input.jobId,
    marketingPostId: post.id,
    username: input.username,
    caption,
    bestAssetType: assets.bestAssetType,
    bestAssetPath: assets.bestAssetPath,
    revealVideoPath: assets.revealVideoPath,
    downloadToken: input.downloadToken
  });
}

function bestInstagramAsset(outputDir: string, previewPath: string | null, squarePreviewPath: string | null): {
  bestAssetType: string;
  bestAssetPath: string | null;
  revealVideoPath: string | null;
} {
  const revealVideoPath = path.join(outputDir, revealVideoFilename);
  if (existsSync(revealVideoPath)) {
    return {
      bestAssetType: "reveal_video",
      bestAssetPath: revealVideoPath,
      revealVideoPath
    };
  }
  if (squarePreviewPath && existsSync(squarePreviewPath)) {
    return {
      bestAssetType: "square_preview",
      bestAssetPath: squarePreviewPath,
      revealVideoPath: null
    };
  }
  if (previewPath && existsSync(previewPath)) {
    return {
      bestAssetType: "social_preview",
      bestAssetPath: previewPath,
      revealVideoPath: null
    };
  }
  const fallback = path.join(outputDir, downloadOutputTypes.socialPreview.filename);
  return {
    bestAssetType: "social_preview",
    bestAssetPath: existsSync(fallback) ? fallback : null,
    revealVideoPath: null
  };
}

function defaultMarketingCaption(username: string): string {
  return [
    `We turned @${username}'s Instagram into a mosaic.`,
    "",
    "Every tiny tile comes from their public posts.",
    "",
    "Want one for your own profile? Make yours at instamosaic.com",
    "",
    `@${username} #InstaMosaic #PhotoMosaic #InstagramArt`
  ].join("\n");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function ensureHeroInputAvailable(job: {
  id: string;
  hero_path: string;
}, metadata: Record<string, unknown>): Promise<void> {
  const heroObjectKey = typeof metadata.heroObjectKey === "string" ? metadata.heroObjectKey : null;
  if (!heroObjectKey) return;
  await downloadToFile({ key: heroObjectKey, destination: job.hero_path });
}

async function uploadGeneratedOutputs(input: {
  jobId: string;
  outputDir: string;
  outputs: Record<string, { type: string; path: string; width: number; height: number }>;
  revealVideoPath: string;
  revealGenerated: boolean;
}): Promise<void> {
  for (const output of Object.values(input.outputs)) {
    const key = jobOutputKey(input.jobId, output.type, path.basename(output.path));
    const stored = await uploadFile({
      key,
      filePath: output.path,
      contentType: "image/jpeg",
      metadata: { jobId: input.jobId, type: output.type }
    });
    await recordGeneratedAsset({
      jobId: input.jobId,
      type: output.type,
      bucket: stored.bucket,
      objectKey: stored.key,
      contentType: stored.contentType,
      size: stored.size,
      width: output.width,
      height: output.height,
      etag: stored.etag
    });
  }

  if (input.revealGenerated) {
    const key = jobOutputKey(input.jobId, "reveal", revealVideoFilename);
    const stored = await uploadFile({
      key,
      filePath: input.revealVideoPath,
      contentType: "video/mp4",
      metadata: { jobId: input.jobId, type: "reveal" }
    });
    await recordGeneratedAsset({
      jobId: input.jobId,
      type: "reveal",
      bucket: storageBucket(),
      objectKey: stored.key,
      contentType: stored.contentType,
      size: stored.size,
      width: 1080,
      height: 1920,
      etag: stored.etag
    });
  }
}
