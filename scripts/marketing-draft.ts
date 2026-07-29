import "dotenv/config";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  createJob,
  createMarketingPost,
  getJob,
  storageDir,
  upsertMarketingTarget
} from "@instamosaic/db";
import { downloadOutputTypes } from "@instamosaic/mosaic";
import {
  normalizeEmail,
  processJob,
  revealVideoFilename,
  sanitizeInstagramUsername,
  sendMarketingReviewEmail
} from "@instamosaic/worker";
import sharp from "sharp";

const args = process.argv.slice(2);
const usernameArg = firstPositional(args);
const heroArg = secondPositional(args);

const wantsHelp = hasFlag(args, "--help");
if (!usernameArg || !heroArg || wantsHelp) {
  console.error([
    "Usage: npm run marketing:draft -- @username hero.jpg [options]",
    "",
    "Options:",
    "  --email you@example.com       Review email. Defaults to MARKETING_REVIEW_EMAIL, ADMIN_EMAIL, or chris@finnternet.com.",
    "  --caption \"text\"             Override the generated caption.",
    "  --rights-status status       Rights status to store on the target. Defaults to unknown.",
    "  --rights-notes \"text\"        Rights notes to store on the target.",
    "  --notes \"text\"               Internal target notes."
  ].join("\n"));
  process.exit(wantsHelp ? 0 : 1);
}

const username = sanitizeInstagramUsername(usernameArg);
const heroSourcePath = path.resolve(heroArg);
if (!existsSync(heroSourcePath)) {
  console.error(`Hero image not found: ${heroSourcePath}`);
  process.exit(1);
}

const reviewEmail = normalizeEmail(optionValue(args, "--email") || process.env.MARKETING_REVIEW_EMAIL || process.env.ADMIN_EMAIL || "chris@finnternet.com");
const rightsStatus = optionValue(args, "--rights-status") || "unknown";
const rightsNotes = optionValue(args, "--rights-notes") || null;
const notes = optionValue(args, "--notes") || null;
const caption = optionValue(args, "--caption") || defaultCaption(username);

const jobId = randomUUID();
const outputDir = path.join(storageDir(), "jobs", jobId);
await mkdir(outputDir, { recursive: true });

const savedHero = await copyHeroImage(heroSourcePath, outputDir);

const target = await upsertMarketingTarget({
  instagramUsername: username,
  category: "creator",
  rightsStatus,
  rightsNotes,
  notes
});

const job = await createJob({
  id: jobId,
  username,
  email: reviewEmail,
  heroPath: savedHero.heroPath,
  outputDir,
  metadata: {
    purpose: "marketing",
    uploadBytes: savedHero.bytes,
    uploadMime: savedHero.mime,
    heroWidth: savedHero.width,
    heroHeight: savedHero.height,
    marketing: {
      targetId: target.id,
      rightsStatus,
      rightsNotes,
      notes
    }
  }
});

console.log(`Created marketing job ${job.id} for @${username}`);
await processJob(job.id, { allowRetry: true });

const completedJob = await getJob(job.id);
if (!completedJob) {
  throw new Error(`Job disappeared after processing: ${job.id}`);
}
if (completedJob.status !== "completed") {
  throw new Error(`Marketing job failed: ${completedJob.error_message || completedJob.status}`);
}

const assets = bestInstagramAsset(completedJob.output_dir, completedJob.preview_path, completedJob.square_preview_path);
const post = await createMarketingPost({
  targetId: target.id,
  jobId: completedJob.id,
  kind: assets.bestAssetType === "reveal_video" ? "reel" : "feed",
  caption,
  bestAssetType: assets.bestAssetType,
  bestAssetPath: assets.bestAssetPath,
  revealVideoPath: assets.revealVideoPath
});

await sendMarketingReviewEmail({
  to: reviewEmail,
  jobId: completedJob.id,
  marketingPostId: post.id,
  username,
  caption,
  bestAssetType: assets.bestAssetType,
  bestAssetPath: assets.bestAssetPath,
  revealVideoPath: assets.revealVideoPath,
  downloadToken: completedJob.download_token
});

console.log(`Marketing draft ${post.id} is ready.`);
console.log(`Best asset: ${assets.bestAssetType} ${assets.bestAssetPath || ""}`.trim());
if (assets.revealVideoPath) console.log(`Reveal video: ${assets.revealVideoPath}`);
console.log(`Review email: ${reviewEmail}`);

async function copyHeroImage(sourcePath: string, outputDir: string): Promise<{
  heroPath: string;
  bytes: number;
  mime: string;
  width: number | null;
  height: number | null;
}> {
  const metadata = await sharp(sourcePath).rotate().metadata();
  const format = metadata.format;
  const extension = format === "jpeg" ? "jpg" : format === "png" || format === "webp" ? format : null;
  if (!extension) {
    throw new Error("Hero image must be a JPG, PNG, or WEBP file.");
  }
  const heroPath = path.join(outputDir, `hero-marketing.${extension}`);
  await copyFile(sourcePath, heroPath);
  const fileStat = await stat(heroPath);
  return {
    heroPath,
    bytes: fileStat.size,
    mime: extension === "jpg" ? "image/jpeg" : `image/${extension}`,
    width: metadata.width ?? null,
    height: metadata.height ?? null
  };
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

function defaultCaption(username: string): string {
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

function firstPositional(values: string[]): string | undefined {
  return values.find((value, index) => !value.startsWith("--") && (index === 0 || !values[index - 1]?.startsWith("--")));
}

function secondPositional(values: string[]): string | undefined {
  const positionals = values.filter((value, index) => !value.startsWith("--") && (index === 0 || !values[index - 1]?.startsWith("--")));
  return positionals[1];
}

function hasFlag(values: string[], name: string): boolean {
  return values.includes(name);
}

function optionValue(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  if (index < 0) return undefined;
  const value = values[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}
