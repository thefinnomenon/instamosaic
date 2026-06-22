import { mkdir } from "node:fs/promises";
import path from "node:path";
import { generateMosaic, mosaicOptionsFromEnv } from "@instamosaic/mosaic";
import {
  claimNextJob,
  getJob,
  incrementJobRetry,
  logError,
  logInfo,
  logWarn,
  nowIso,
  storageDir,
  trackEvent,
  updateJob
} from "@instamosaic/db";
import { sendPreviewEmail, sendProcessingEmail } from "./email.ts";
import { checkInstagramProfile, downloadInstagramTiles } from "./instagram.ts";
export { checkInstagramProfile, downloadInstagramTiles, mockDownloadInstagramTiles } from "./instagram.ts";
export { sendDigitalPurchaseEmail } from "./email.ts";
export { appUrl, normalizeEmail, sanitizeInstagramUsername } from "./validation.ts";

export type ProcessJobOptions = {
  allowRetry?: boolean;
};

export async function processJob(jobId: string, options: ProcessJobOptions = {}): Promise<void> {
  const allowRetry = options.allowRetry ?? true;
  const current = getJob(jobId);
  if (!current) throw new Error(`Job not found: ${jobId}`);

  if (current.status === "completed") return;
  if (current.status === "failed" && !allowRetry) return;

  updateJob(jobId, {
    status: "processing",
    progress: 2,
    step: "Job created",
    processing_started_at: current.processing_started_at ?? nowIso(),
    error_message: null
  });

  trackEvent({ event: "worker_started", jobId, user: current.email });
  logInfo({ event: "worker_started", jobId, user: current.email, message: "Worker started processing job." });

  try {
    const check = await checkInstagramProfile(current.username);
    if (!check.exists) {
      throw new Error("Instagram profile was not found.");
    }
    if (!check.is_public) {
      throw new Error("Instagram profile is private. Make it public and resubmit or retry.");
    }

    updateJob(jobId, {
      progress: 6,
      step: "Instagram verified",
      ig_public: 1,
      ig_post_count: check.estimated_photo_count
    });
    trackEvent({ event: "instagram_check_public", jobId, user: current.email, metadata: { estimatedPhotoCount: check.estimated_photo_count } });

    const tilesDir = path.join(current.output_dir, "tiles");
    await mkdir(tilesDir, { recursive: true });
    updateJob(jobId, { progress: 8, step: "Downloading photos" });

    let lastDownloadProgress = 8;
    let lastDownloadProgressAt = 0;
    const updateDownloadProgress = (stage: string, downloaderProgress: number, downloadedCount?: number, totalCount?: number) => {
      const progress = Math.max(8, Math.min(70, Math.round(8 + downloaderProgress * 62)));
      const now = Date.now();
      if (progress <= lastDownloadProgress && now - lastDownloadProgressAt < 1_000) return;
      if (progress < 70 && progress - lastDownloadProgress < 1 && now - lastDownloadProgressAt < 750) return;
      lastDownloadProgress = progress;
      lastDownloadProgressAt = now;
      updateJob(jobId, {
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

    updateJob(jobId, {
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
      updateJob(jobId, { progress, step: stage === "Generating exports" ? "Generating exports" : "Building mosaic" });
    };

    const result = await generateMosaic({
      heroPath: current.hero_path,
      tilePaths: download.tile_paths,
      outputDir: current.output_dir,
      onProgress(stage, progress) {
        updateMosaicProgress(stage, progress);
      }
    });

    updateJob(jobId, {
      status: "completed",
      progress: 100,
      step: "Done",
      photos_used: result.tileCount,
      preview_path: result.outputs.socialPreview.path,
      square_preview_path: result.outputs.squarePreview.path,
      processing_completed_at: nowIso(),
      metadata: JSON.stringify({
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
          warnings: [...download.warnings, ...result.warnings]
        }
      })
    });

    trackEvent({ event: "worker_completed", jobId, user: current.email, metadata: { photosUsed: result.tileCount } });
    logInfo({ event: "worker_completed", jobId, user: current.email, message: "Worker completed job.", metadata: { photosUsed: result.tileCount } });
    await sendPreviewEmail({ to: current.email, jobId, username: current.username });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError({
      event: "worker_failed",
      jobId,
      user: current.email,
      message,
      stack: error instanceof Error ? error.stack : undefined
    });
    trackEvent({ event: "worker_failed", jobId, user: current.email, metadata: { message, retry: allowRetry } });

    const latest = getJob(jobId);
    if (allowRetry && latest && latest.retry_count < 1) {
      incrementJobRetry(jobId);
      updateJob(jobId, {
        status: "queued",
        progress: 5,
        step: "Job created",
        error_message: `Retrying after failure: ${message}`
      });
      logWarn({ event: "worker_retry", jobId, user: current.email, message: "Retrying failed job once." });
      await processJob(jobId, { allowRetry: false });
      return;
    }

    updateJob(jobId, {
      status: "failed",
      progress: 100,
      step: "Failed",
      error_message: message,
      processing_completed_at: nowIso()
    });
  }
}

export async function processNextJob(): Promise<boolean> {
  const job = claimNextJob();
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
