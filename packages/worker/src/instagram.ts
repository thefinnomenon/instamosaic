import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import sharp from "sharp";
import { sanitizeInstagramUsername } from "./validation.ts";

const DEFAULT_TILE_SIZE = 128;
const DEFAULT_MAX_IMAGES = 500;
const DOWNLOAD_CONCURRENCY = 8;
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
  user_id: string | null;
  downloaded_count: number;
  skipped_count: number;
  tile_paths: string[];
  oldest_image_post_at?: string | null;
  newest_image_post_at?: string | null;
  warnings: string[];
  errors: string[];
  processing_seconds: number;
};

export type MarketingHeroSource = "profile" | "top_liked" | "recent";

export type DownloadMarketingHeroResult = {
  username: string;
  source: MarketingHeroSource;
  hero_path: string;
  source_url: string;
  like_count: number | null;
  taken_at: string | null;
  width: number | null;
  height: number | null;
  warnings: string[];
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

type HeroCandidate = {
  url: string;
  source: MarketingHeroSource;
  likeCount: number | null;
  takenAt: number | null;
  width: number | null;
  height: number | null;
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
  const maxImages = input.maxImages ?? DEFAULT_MAX_IMAGES;
  const tileSize = input.tileSize ?? DEFAULT_TILE_SIZE;
  await mkdir(input.outputDir, { recursive: true });

  const warnings: string[] = [];
  const errors: string[] = [];
  const mediaItems: MediaItem[] = [];
  const seenUrls = new Set<string>();
  let userId: string | null = null;
  let maxId = "";
  let pagesChecked = 0;

  while (true) {
    if (maxImages && mediaItems.length >= maxImages) break;

    pagesChecked += 1;
    input.onProgress?.({ stage: "Finding photos", progress: Math.min(0.12, pagesChecked * 0.02), total_count: mediaItems.length });
    const payload = await rapidApiPost("posts", { username, maxId });
    userId ??= instagramUserIdFromPostsPayload(payload, username);
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
    user_id: userId,
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

export async function downloadMarketingHeroImage(input: {
  username: string;
  outputDir: string;
  source?: "auto" | MarketingHeroSource;
}): Promise<DownloadMarketingHeroResult> {
  const username = sanitizeInstagramUsername(input.username);
  await mkdir(input.outputDir, { recursive: true });
  const wantedSource = input.source ?? "auto";
  const warnings: string[] = [];
  let candidate: HeroCandidate | null = null;

  if (wantedSource === "auto" || wantedSource === "profile") {
    try {
      candidate = await profileHeroCandidate(username);
      if (!candidate && wantedSource === "profile") {
        throw new Error("Profile response did not include a usable profile photo URL.");
      }
    } catch (error) {
      if (wantedSource === "profile") throw error;
      warnings.push(`Profile photo was not usable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!candidate && (wantedSource === "auto" || wantedSource === "top_liked" || wantedSource === "recent")) {
    const postSource = wantedSource === "recent" ? "recent" : "top_liked";
    candidate = await postHeroCandidate(username, postSource);
  }

  if (!candidate) {
    throw new Error("No usable hero image was found for this Instagram profile.");
  }

  const heroPath = path.join(input.outputDir, `hero-${candidate.source}.jpg`);
  const metadata = await downloadHero(candidate.url, heroPath);
  return {
    username,
    source: candidate.source,
    hero_path: heroPath,
    source_url: candidate.url,
    like_count: candidate.likeCount,
    taken_at: candidate.takenAt ? isoFromUnix(candidate.takenAt) : null,
    width: metadata.width,
    height: metadata.height,
    warnings
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

  for (const envPath of [".env", "../.env"]) {
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

async function profileHeroCandidate(username: string): Promise<HeroCandidate | null> {
  const payload = await rapidApiPost("profile", { username });
  const result = objectValue(payload.result);
  if (!result) return null;
  const url = bestProfilePhotoUrl(result);
  if (!url) return null;
  return {
    url,
    source: "profile",
    likeCount: null,
    takenAt: null,
    width: null,
    height: null
  };
}

async function postHeroCandidate(username: string, source: "top_liked" | "recent"): Promise<HeroCandidate | null> {
  let maxId = "";
  let pagesChecked = 0;
  let best: HeroCandidate | null = null;

  while (pagesChecked < 4) {
    pagesChecked += 1;
    const payload = await rapidApiPost("posts", { username, maxId });
    const candidates = heroCandidatesFromPostsPayload(payload, source);
    for (const candidate of candidates) {
      if (!best || heroCandidateScore(candidate, source) > heroCandidateScore(best, source)) {
        best = candidate;
      }
    }
    const nextCursor = nextCursorFromPostsPayload(payload);
    if (!nextCursor || nextCursor === maxId) break;
    maxId = nextCursor;
  }

  return best;
}

function bestProfilePhotoUrl(profile: JsonObject): string | null {
  const directFields = [
    "profile_pic_url_hd",
    "profile_pic_url",
    "hd_profile_pic_url",
    "profile_pic_url_high_resolution"
  ];
  for (const field of directFields) {
    const value = profile[field];
    if (typeof value === "string" && value.startsWith("http")) return value;
  }

  const nestedObjects = [
    objectValue(profile.hd_profile_pic_url_info),
    objectValue(profile.profile_pic_url_info),
    objectValue(profile.profile_pic_hd)
  ].filter((value): value is JsonObject => Boolean(value));
  for (const entry of nestedObjects) {
    if (typeof entry.url === "string" && entry.url.startsWith("http")) return entry.url;
  }

  const versions = [
    ...arrayValue(profile.hd_profile_pic_versions),
    ...arrayValue(profile.profile_pic_versions)
  ].map((value) => objectValue(value)).filter((value): value is JsonObject => Boolean(value));
  versions.sort((a, b) => areaValue(b) - areaValue(a));
  const best = versions.find((value) => typeof value.url === "string");
  return typeof best?.url === "string" ? best.url : null;
}

function instagramUserId(profile: JsonObject): string | null {
  for (const field of ["id", "pk", "user_id", "instagram_id"]) {
    const value = profile[field];
    if ((typeof value === "string" || typeof value === "number") && String(value).trim()) {
      return String(value);
    }
  }
  return null;
}

function heroCandidatesFromPostsPayload(payload: JsonObject, source: "top_liked" | "recent"): HeroCandidate[] {
  const result = objectValue(payload.result);
  const edges = arrayValue(result?.edges);
  const items: HeroCandidate[] = [];
  const seen = new Set<string>();

  for (const edge of edges) {
    const node = objectValue(objectValue(edge)?.node);
    if (!node || isVideoMedia(node)) continue;
    const nodeTakenAt = takenAtFromMedia(node);
    const nodeLikeCount = likeCountFromMedia(node);
    const carousel = arrayValue(node.carousel_media);
    const media = carousel.length ? carousel : [node];

    for (const entry of media) {
      const mediaNode = objectValue(entry);
      if (!mediaNode || isVideoMedia(mediaNode)) continue;
      const candidate = bestLargeMediaCandidate(mediaNode);
      if (!candidate?.url || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      items.push({
        url: candidate.url,
        source,
        likeCount: likeCountFromMedia(mediaNode, nodeLikeCount),
        takenAt: takenAtFromMedia(mediaNode, nodeTakenAt),
        width: candidate.width,
        height: candidate.height
      });
    }
  }
  return items;
}

function nextCursorFromPostsPayload(payload: JsonObject): string | null {
  const pageInfo = objectValue(objectValue(payload.result)?.page_info);
  if (!pageInfo?.has_next_page) return null;
  return typeof pageInfo.end_cursor === "string" && pageInfo.end_cursor ? pageInfo.end_cursor : null;
}

function instagramUserIdFromPostsPayload(payload: JsonObject, username: string): string | null {
  const edges = arrayValue(objectValue(payload.result)?.edges);
  for (const edge of edges) {
    const node = objectValue(objectValue(edge)?.node);
    if (!node) continue;
    for (const field of ["user", "owner"]) {
      const account = objectValue(node[field]);
      if (!account || String(account.username || "").toLowerCase() !== username.toLowerCase()) continue;
      const userId = instagramUserId(account);
      if (userId) return userId;
    }
  }
  return null;
}

function bestMediaUrl(item: JsonObject): string | null {
  const candidates = arrayValue(objectValue(item.image_versions2)?.candidates)
    .map((candidate) => objectValue(candidate))
    .filter((candidate): candidate is JsonObject => candidate !== null && typeof candidate.url === "string");
  if (!candidates.length) return null;
  candidates.sort((a, b) => candidateScore(a) - candidateScore(b));
  return String(candidates[0]!.url);
}

function bestLargeMediaCandidate(item: JsonObject): { url: string; width: number | null; height: number | null } | null {
  const candidates = arrayValue(objectValue(item.image_versions2)?.candidates)
    .map((candidate) => objectValue(candidate))
    .filter((candidate): candidate is JsonObject => candidate !== null && typeof candidate.url === "string");
  if (!candidates.length && typeof item.display_url === "string") {
    return { url: item.display_url, width: null, height: null };
  }
  if (!candidates.length && typeof item.thumbnail_src === "string") {
    return { url: item.thumbnail_src, width: null, height: null };
  }
  candidates.sort((a, b) => areaValue(b) - areaValue(a));
  const best = candidates[0];
  return best ? { url: String(best.url), width: numberOrNull(best.width), height: numberOrNull(best.height) } : null;
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

function likeCountFromMedia(item: JsonObject, fallback: number | null = null): number | null {
  const direct = numberOrNull(item.like_count ?? item.likes_count);
  if (direct !== null) return direct;
  const edgeLiked = numberOrNull(objectValue(item.edge_liked_by)?.count);
  if (edgeLiked !== null) return edgeLiked;
  const previewLike = numberOrNull(objectValue(item.edge_media_preview_like)?.count);
  if (previewLike !== null) return previewLike;
  return fallback;
}

function takenAtFromMedia(item: JsonObject, fallback: number | null = null): number | null {
  const raw = item.taken_at ?? item.taken_at_timestamp ?? item.device_timestamp ?? fallback;
  const value = numberValue(raw);
  if (!value) return null;
  return value > 10_000_000_000 ? Math.floor(value / 1_000_000) : value;
}

async function downloadTile(url: string, destination: string, tileSize: number): Promise<void> {
  const bytes = await downloadImageBytes(url, "Image", 30_000);
  await sharp(bytes)
    .rotate()
    .resize(tileSize, tileSize, { fit: "cover", position: "attention" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toFile(destination);
}

async function downloadHero(url: string, destination: string): Promise<{ width: number | null; height: number | null }> {
  const bytes = await downloadImageBytes(url, "Hero image", 30_000);
  const result = await sharp(bytes)
    .rotate()
    .jpeg({ quality: 92, mozjpeg: true })
    .toFile(destination);
  return { width: result.width ?? null, height: result.height ?? null };
}

async function downloadImageBytes(url: string, label: string, timeoutMs: number): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; InstaMosaic/0.1; +https://instamosaic.local)",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
    if (!response.ok) throw new Error(`${label} request failed with HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timeout);
  }
}

function heroCandidateScore(candidate: HeroCandidate, source: "top_liked" | "recent"): number {
  if (source === "recent") return candidate.takenAt ?? 0;
  const likes = candidate.likeCount ?? -1;
  return likes * 1_000_000_000 + (candidate.takenAt ?? 0);
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
    user_id: null,
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

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function areaValue(value: JsonObject): number {
  const width = numberValue(value.width);
  const height = numberValue(value.height);
  return width * height;
}

function isoFromUnix(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
