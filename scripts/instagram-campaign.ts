import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateMosaic, mosaicOptionsFromEnv } from "@instamosaic/mosaic";
import {
  downloadInstagramTiles,
  downloadMarketingHeroImage
} from "../packages/worker/src/instagram.ts";
import {
  generateRevealVideo,
  revealVideoFilename
} from "../packages/worker/src/reveal-video.ts";
import { instagramPublisherFromEnv } from "./instagram-publisher.ts";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetFile = resolveFromRepository(process.env.INSTAGRAM_CAMPAIGN_TARGETS || "marketing-targets.txt");
const stateFile = resolveFromRepository(process.env.INSTAGRAM_CAMPAIGN_STATE || "tmp/instagram-campaign-state.json");
const outputRoot = resolveFromRepository(process.env.INSTAGRAM_CAMPAIGN_OUTPUT_DIR || "tmp/instagram-campaign");
const lockFile = `${stateFile}.lock`;
const dryRun = process.argv.includes("--dry-run");
const generateOnly = process.argv.includes("--generate-only");

type CampaignState = {
  nextIndex: number;
  published: Array<{
    username: string;
    carouselId: string;
    carouselPermalink: string | null;
    storyId: string | null;
    outputDir: string;
    publishedAt: string;
  }>;
};

const lock = await acquireLock();
try {
  const targets = await readTargets();
  const state = await readState();
  const username = targets[state.nextIndex % targets.length];
  if (!username) throw new Error("No campaign target was selected.");

  console.log(`Next InstaMosaic campaign target: @${username}`);
  if (dryRun) {
    console.log("Dry run complete. No mosaic was generated and nothing was published.");
  } else {
    assertCampaignEnvironment();
    const assets = await generateCampaignAssets(username);
    if (generateOnly) {
      console.log("Generation-only run complete. Nothing was published.");
      console.log(`Local assets: ${assets.outputDir}`);
    } else {
      console.log(`Publishing reveal + mosaic carousel for @${username}...`);
      const publisher = instagramPublisherFromEnv();
      const mediaServer = await startMediaServer({
        revealVideoPath: assets.revealVideoPath,
        mosaicImagePath: assets.mosaicImagePath
      });
      const tunnel = await startTunnel(mediaServer.port);
      const revealVideoUrl = `${tunnel.url}/reveal.mp4`;
      const mosaicImageUrl = `${tunnel.url}/mosaic.jpg`;
      let carousel;
      let storyId: string | null = null;
      try {
        carousel = await publisher.publishCarousel({
          revealVideoUrl,
          mosaicImageUrl,
          caption: campaignCaption(username)
        });
        try {
          console.log(`Publishing reveal Story for @${username}...`);
          const story = await publisher.publishStory({
            videoUrl: revealVideoUrl,
            mentionUserId: assets.targetUserId
          });
          storyId = story.id;
        } catch (error) {
          console.error(`Story failed after the carousel was published: ${errorMessage(error)}`);
        }

        await writeState({
          nextIndex: (state.nextIndex + 1) % targets.length,
          published: [
            ...state.published,
            {
              username,
              carouselId: carousel.id,
              carouselPermalink: carousel.permalink,
              storyId,
              outputDir: path.relative(repositoryRoot, assets.outputDir),
              publishedAt: new Date().toISOString()
            }
          ].slice(-200)
        });
      } finally {
        tunnel.process.kill();
        await new Promise<void>((resolve) => mediaServer.server.close(() => resolve()));
      }

      console.log(`Campaign run complete for @${username}.`);
      if (carousel.permalink) console.log(`Post: ${carousel.permalink}`);
      if (!storyId) console.log("The carousel published, but its Story did not.");
      console.log(`Local assets: ${assets.outputDir}`);
    }
  }
} finally {
  await lock.close();
  await rm(lockFile, { force: true });
}

async function generateCampaignAssets(username: string): Promise<{
  outputDir: string;
  revealVideoPath: string;
  mosaicImagePath: string;
  targetUserId: string;
}> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(outputRoot, `${timestamp}-${username}`);
  const tilesDir = path.join(outputDir, "tiles");
  await mkdir(tilesDir, { recursive: true });

  console.log(`Downloading hero image for @${username}...`);
  const hero = await downloadMarketingHeroImage({
    username,
    outputDir,
    source: "top_liked"
  });
  console.log(
    `Selected most-liked available hero${hero.like_count == null ? "" : ` (${hero.like_count.toLocaleString()} likes)`}.`
  );

  console.log(`Downloading Instagram photos for @${username}...`);
  const download = await downloadInstagramTiles({
    username,
    outputDir: tilesDir,
    tileSize: mosaicOptionsFromEnv().tileSize,
    onProgress(event) {
      if (typeof event.downloaded_count === "number" && typeof event.total_count === "number") {
        process.stdout.write(`\r${event.stage}: ${event.downloaded_count}/${event.total_count}`);
      }
    }
  });
  process.stdout.write("\n");
  if (download.downloaded_count === 0) {
    throw new Error(download.errors[0] || `No usable Instagram photos were found for @${username}.`);
  }
  if (!download.user_id) {
    throw new Error(`Instagram posts did not include a user ID for @${username}; Story mention was not published.`);
  }

  console.log(`Generating mosaic from ${download.downloaded_count} photos...`);
  const mosaic = await generateMosaic({
    heroPath: hero.hero_path,
    tilePaths: download.tile_paths,
    outputDir,
    onProgress(stage, progress) {
      process.stdout.write(`\r${stage}: ${Math.round(progress * 100)}%`);
    }
  });
  process.stdout.write("\n");

  const revealVideoPath = path.join(outputDir, revealVideoFilename);
  await generateRevealVideo({
    originalImage: hero.hero_path,
    mosaicImage: mosaic.outputs.revealPreview.path,
    outputVideo: revealVideoPath,
    stats: {
      username,
      instagramPhotoCount: download.downloaded_count,
      tileCount: mosaic.cells
    }
  });

  return {
    outputDir,
    revealVideoPath,
    mosaicImagePath: mosaic.outputs.revealPreview.path,
    targetUserId: download.user_id
  };
}

async function readTargets(): Promise<string[]> {
  const contents = await readFile(targetFile, "utf8").catch(() => {
    throw new Error(`Campaign target file not found: ${targetFile}`);
  });
  const targets = contents
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map(sanitizeUsername);
  if (targets.length === 0) throw new Error(`Add at least one Instagram username to ${targetFile}.`);
  return [...new Set(targets)];
}

async function readState(): Promise<CampaignState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyState();
    const input = parsed as Record<string, unknown>;
    return {
      nextIndex: typeof input.nextIndex === "number" && Number.isInteger(input.nextIndex) ? Math.max(0, input.nextIndex) : 0,
      published: Array.isArray(input.published) ? input.published as CampaignState["published"] : []
    };
  } catch {
    return emptyState();
  }
}

function emptyState(): CampaignState {
  return { nextIndex: 0, published: [] };
}

async function writeState(state: CampaignState): Promise<void> {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, stateFile);
}

async function acquireLock() {
  await mkdir(path.dirname(lockFile), { recursive: true });
  try {
    return await open(lockFile, "wx");
  } catch {
    throw new Error(`Another campaign run is active, or a stale lock exists: ${lockFile}`);
  }
}

function campaignCaption(username: string): string {
  return [
    `We turned @${username}'s Instagram into a mosaic.`,
    "",
    "Every tiny tile comes from their posts. Swipe to see the finished piece.",
    "",
    "Who should we mosaic next?",
    "",
    `@${username} #InstaMosaic #PhotoMosaic #InstagramArt`
  ].join("\n");
}

function assertCampaignEnvironment(): void {
  const required = [
    "INSTAGRAM_RAPIDAPI_KEY",
    "INSTAGRAM_USER_ID",
    "INSTAGRAM_ACCESS_TOKEN"
  ];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing campaign environment variables: ${missing.join(", ")}`);
}

async function startMediaServer(input: {
  revealVideoPath: string;
  mosaicImagePath: string;
}): Promise<{ server: Server; port: number }> {
  const media = new Map([
    ["/reveal.mp4", { filePath: input.revealVideoPath, contentType: "video/mp4" }],
    ["/mosaic.jpg", { filePath: input.mosaicImagePath, contentType: "image/jpeg" }]
  ]);
  const server = createServer(async (request, response) => {
    try {
      const item = media.get(request.url ?? "");
      if (!item || (request.method !== "GET" && request.method !== "HEAD")) {
        response.writeHead(404).end();
        return;
      }
      const bytes = await readFile(item.filePath);
      response.writeHead(200, {
        "Content-Type": item.contentType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=3600"
      });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(500).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start campaign media server.");
  return { server, port: address.port };
}

async function startTunnel(port: number): Promise<{ process: ChildProcess; url: string }> {
  const process = spawn("ssh", [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ServerAliveInterval=30",
    "-R", `80:127.0.0.1:${port}`,
    "nokey@localhost.run"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Campaign media tunnel did not start.")), 60_000);
    const inspectOutput = (chunk: Buffer) => {
      const publicUrl = chunk.toString("utf8").match(/https:\/\/[a-z0-9-]+\.lhr\.life/)?.[0];
      if (!publicUrl) return;
      clearTimeout(timeout);
      resolve(publicUrl);
    };
    process.once("error", reject);
    process.once("exit", (code) => reject(new Error(`Campaign media tunnel exited with code ${String(code)}.`)));
    process.stdout?.on("data", inspectOutput);
    process.stderr?.on("data", inspectOutput);
  });

  await Promise.all([
    waitForPublicMedia(`${url}/reveal.mp4`),
    waitForPublicMedia(`${url}/mosaic.jpg`)
  ]);
  return { process, url };
}

async function waitForPublicMedia(url: string): Promise<void> {
  let lastStatus = "unreachable";
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000) });
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = errorMessage(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Campaign media tunnel did not serve ${url}: ${lastStatus}`);
}

function sanitizeUsername(input: string): string {
  const username = input.trim().replace(/^@+/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    throw new Error(`Invalid Instagram username in ${targetFile}: ${input}`);
  }
  return username;
}

function resolveFromRepository(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
