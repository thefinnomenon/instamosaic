import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import sharp from "sharp";
import { sanitizeInstagramUsername } from "./validation.ts";

const DEFAULT_TILE_SIZE = 128;
const DOWNLOAD_CONCURRENCY = 16;
const MOCK_PHOTO_COUNT = 80;
let localEnvLoaded = false;

export type InstagramCheckResult = {
  username: string;
  exists: boolean;
  is_public: boolean;
  estimated_photo_count: number;
  warnings: string[];
  errors: string[];
};

export type DownloadTilesResult = {
  downloaded_count: number;
  skipped_count: number;
  tile_paths: string[];
  oldest_image_post_at?: string | null;
  newest_image_post_at?: string | null;
  warnings: string[];
  errors: string[];
  processing_seconds: number;
};

export type DownloadProgressEvent = {
  stage: string;
  progress: number;
  downloaded_count?: number;
  total_count?: number;
};

type JsonObject = Record<string, unknown>;

type MediaItem = {
  url: string;
  takenAt: number | null;
};

export async function checkInstagramProfile(usernameInput: string): Promise<InstagramCheckResult> {
  const username = sanitizeInstagramUsername(usernameInput);
  const payload = await rapidApiPost("profile", { username });
  const result = objectValue(payload.result);

  if (!result || !result.username) {
    return {
      username,
      exists: false,
      is_public: false,
      estimated_photo_count: 0,
      warnings: ["RapidAPI returned no profile for this username."],
      errors: []
    };
  }

  const timelineMedia = objectValue(result.edge_owner_to_timeline_media);
  return {
    username: String(result.username || username),
    exists: true,
    is_public: !Boolean(result.is_private),
    estimated_photo_count: numberValue(timelineMedia?.count),
    warnings: ["RapidAPI profile check validates visibility only; media is counted during download."],
    errors: []
  };
}

export async function downloadInstagramTiles(input: {
  username: string;
  outputDir: string;
  maxImages?: number;
  tileSize?: number;
  onProgress?: (event: DownloadProgressEvent) => void;
}): Promise<DownloadTilesResult> {
  const started = Date.now();
  const username = sanitizeInstagramUsername(input.username);
  const maxImages = input.maxImages;
  const tileSize = input.tileSize ?? DEFAULT_TILE_SIZE;
  await mkdir(input.outputDir, { recursive: true });

  const warnings: string[] = [];
  const errors: string[] = [];
  const mediaItems: MediaItem[] = [];
  const seenUrls = new Set<string>();
  let maxId = "";
  let pagesChecked = 0;

  while (true) {
    if (maxImages && mediaItems.length >= maxImages) break;

    pagesChecked += 1;
    input.onProgress?.({ stage: "Finding photos", progress: Math.min(0.12, pagesChecked * 0.02), total_count: mediaItems.length });
    const payload = await rapidApiPost("posts", { username, maxId });
    const pageItems = mediaItemsFromPostsPayload(payload);
    if (pageItems.length === 0) warnings.push("RapidAPI returned no image media on this page.");

    for (const item of pageItems) {
      if (maxImages && mediaItems.length >= maxImages) break;
      if (seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      mediaItems.push(item);
    }

    const nextCursor = nextCursorFromPostsPayload(payload);
    if (!nextCursor || nextCursor === maxId) break;
    maxId = nextCursor;
  }

  input.onProgress?.({ stage: "Downloading photos", progress: 0.15, total_count: mediaItems.length });
  const tilePathsByIndex = new Array<string | null>(mediaItems.length).fill(null);
  let completed = 0;
  let skippedCount = 0;

  await mapConcurrent(mediaItems, Math.min(DOWNLOAD_CONCURRENCY, Math.max(1, mediaItems.length)), async (item, index) => {
    const tilePath = path.join(input.outputDir, `tile-${String(index).padStart(5, "0")}.jpg`);
    try {
      await downloadTile(item.url, tilePath, tileSize);
      tilePathsByIndex[index] = tilePath;
    } catch (error) {
      skippedCount += 1;
      errors.push(`Skipped image: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      completed += 1;
      const downloadedCount = tilePathsByIndex.filter(Boolean).length;
      input.onProgress?.({
        stage: "Downloading photos",
        progress: 0.15 + (0.80 * completed / Math.max(1, mediaItems.length)),
        downloaded_count: downloadedCount,
        total_count: mediaItems.length
      });
    }
  });

  const tilePaths = tilePathsByIndex.filter((tilePath): tilePath is string => Boolean(tilePath));
  const takenAt = mediaItems
    .map((item, index) => tilePathsByIndex[index] ? item.takenAt : null)
    .filter((value): value is number => typeof value === "number");

  if (tilePaths.length === 0 && errors.length === 0) warnings.push("No image posts were available to download.");
  if (errors.length > 10) {
    warnings.push(`Suppressed ${errors.length - 10} additional image download errors.`);
    errors.length = 10;
  }

  input.onProgress?.({ stage: "Preparing photos", progress: 0.98, downloaded_count: tilePaths.length, total_count: mediaItems.length });
  return {
    downloaded_count: tilePaths.length,
    skipped_count: skippedCount,
    tile_paths: tilePaths,
    oldest_image_post_at: takenAt.length ? isoFromUnix(Math.min(...takenAt)) : null,
    newest_image_post_at: takenAt.length ? isoFromUnix(Math.max(...takenAt)) : null,
    warnings,
    errors,
    processing_seconds: Number(((Date.now() - started) / 1000).toFixed(2))
  };
}

function rapidApiKey(): string {
  loadLocalEnv();
  const key = process.env.INSTAGRAM_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY;
  if (!key) throw new Error("INSTAGRAM_RAPIDAPI_KEY or RAPIDAPI_KEY is required.");
  return key;
}

async function rapidApiPost(endpoint: "profile" | "posts", body: JsonObject): Promise<JsonObject> {
  loadLocalEnv();
  const host = process.env.INSTAGRAM_RAPIDAPI_HOST || "instagram120.p.rapidapi.com";
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`https://${host}/api/instagram/${endpoint}`, {
        method: "POST",
        headers: {
          "x-rapidapi-key": rapidApiKey(),
          "x-rapidapi-host": host,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      }, 45_000);

      if (response.status >= 500 && attempt < 2) {
        await sleep(1_000 + attempt * 1_000);
        continue;
      }
      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 500).replace(/\n/g, " ");
        throw new Error(`RapidAPI request failed with HTTP ${response.status}: ${responseBody}`);
      }
      const payload = await response.json();
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("RapidAPI returned an unexpected response shape.");
      }
      return payload as JsonObject;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1_000 + attempt * 1_000);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function loadLocalEnv(): void {
  if (localEnvLoaded) return;
  localEnvLoaded = true;

  for (const envPath of [path.resolve(process.cwd(), ".env"), path.resolve(process.cwd(), "../.env")]) {
    if (existsSync(envPath)) loadDotenv({ path: envPath });
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function mediaItemsFromPostsPayload(payload: JsonObject): MediaItem[] {
  const result = objectValue(payload.result);
  const edges = arrayValue(result?.edges);
  const items: MediaItem[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const node = objectValue(objectValue(edge)?.node);
    if (!node) continue;
    const nodeTakenAt = takenAtFromMedia(node);
    const carousel = arrayValue(node.carousel_media);
    const media = carousel.length ? carousel : [node];

    for (const entry of media) {
      const mediaNode = objectValue(entry);
      if (!mediaNode || isVideoMedia(mediaNode)) continue;
      const url = bestMediaUrl(mediaNode);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      items.push({ url, takenAt: takenAtFromMedia(mediaNode, nodeTakenAt) });
    }
  }
  return items;
}

function nextCursorFromPostsPayload(payload: JsonObject): string | null {
  const pageInfo = objectValue(objectValue(payload.result)?.page_info);
  if (!pageInfo?.has_next_page) return null;
  return typeof pageInfo.end_cursor === "string" && pageInfo.end_cursor ? pageInfo.end_cursor : null;
}

function bestMediaUrl(item: JsonObject): string | null {
  const candidates = arrayValue(objectValue(item.image_versions2)?.candidates)
    .map((candidate) => objectValue(candidate))
    .filter((candidate): candidate is JsonObject => candidate !== null && typeof candidate.url === "string");
  if (!candidates.length) return null;
  candidates.sort((a, b) => candidateScore(a) - candidateScore(b));
  return String(candidates[0]!.url);
}

function candidateScore(candidate: JsonObject): number {
  const width = numberValue(candidate.width);
  const height = numberValue(candidate.height);
  const squarePenalty = width === height ? 0 : 1_000_000;
  const exactPenalty = width === 150 && height === 150 ? 0 : 100_000;
  return squarePenalty + exactPenalty + Math.abs(width - 150) + Math.abs(height - 150);
}

function isVideoMedia(item: JsonObject): boolean {
  if (String(item.media_type) === "2") return true;
  if (["clips", "igtv", "reels", "reel"].includes(String(item.product_type || ""))) return true;
  if (arrayValue(item.video_versions).length > 0) return true;
  return Boolean(item.video_dash_manifest);
}

function takenAtFromMedia(item: JsonObject, fallback: number | null = null): number | null {
  const raw = item.taken_at ?? item.taken_at_timestamp ?? item.device_timestamp ?? fallback;
  const value = numberValue(raw);
  if (!value) return null;
  return value > 10_000_000_000 ? Math.floor(value / 1_000_000) : value;
}

async function downloadTile(url: string, destination: string, tileSize: number): Promise<void> {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; InstaMosaic/0.1; +https://instamosaic.local)",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
    }
  }, 30_000);
  if (!response.ok) throw new Error(`Image request failed with HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await sharp(bytes)
    .rotate()
    .resize(tileSize, tileSize, { fit: "cover", position: "attention" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(destination);
}

export async function mockDownloadInstagramTiles(input: {
  outputDir: string;
  tileSize?: number;
  maxImages?: number;
  onProgress?: (event: DownloadProgressEvent) => void;
}): Promise<DownloadTilesResult> {
  const started = Date.now();
  const tileSize = input.tileSize ?? DEFAULT_TILE_SIZE;
  const count = Math.min(input.maxImages || MOCK_PHOTO_COUNT, MOCK_PHOTO_COUNT);
  const tilePaths: string[] = [];
  input.onProgress?.({ stage: "Generating mock photos", progress: 0.5, total_count: count });
  for (let index = 0; index < count; index += 1) {
    const hue = index / Math.max(1, count);
    const r = Math.round(128 + 127 * Math.sin(hue * Math.PI * 2));
    const g = Math.round(128 + 127 * Math.sin(hue * Math.PI * 2 + 2.1));
    const b = Math.round(128 + 127 * Math.sin(hue * Math.PI * 2 + 4.2));
    const tilePath = path.join(input.outputDir, `mock-${String(index).padStart(4, "0")}.jpg`);
    await sharp({ create: { width: tileSize, height: tileSize, channels: 3, background: { r, g, b } } })
      .jpeg({ quality: 88 })
      .toFile(tilePath);
    tilePaths.push(tilePath);
  }
  input.onProgress?.({ stage: "Preparing photos", progress: 1, downloaded_count: tilePaths.length, total_count: count });
  return {
    downloaded_count: tilePaths.length,
    skipped_count: 0,
    tile_paths: tilePaths,
    oldest_image_post_at: null,
    newest_image_post_at: null,
    warnings: ["Mock Instagram tile download enabled."],
    errors: [],
    processing_seconds: Number(((Date.now() - started) / 1000).toFixed(2))
  };
}

async function mapConcurrent<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isoFromUnix(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
