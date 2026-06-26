import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

sharp.cache(false);
sharp.concurrency(1);

export type MosaicOptions = {
  masterWidth: number;
  masterHeight: number;
  columns: number;
  rows: number;
  screenWidth: number;
  screenHeight: number;
  screenColumns: number;
  screenRows: number;
  tileSize: number;
  heroBlendOpacity: number;
  watermarkText: string;
  watermarkOpacity: number;
  jpegQuality: number;
  tileReuseFactor: number;
  minRepeatRadius: number;
  tileColorMatch: number;
};

export type MosaicOutputType =
  | "master"
  | "revealPreview"
  | "socialPreview"
  | "squarePreview"
  | "print20x30"
  | "print18x24"
  | "print12x18"
  | "phoneWallpaper"
  | "desktopWallpaper";

export type MosaicOutput = {
  type: MosaicOutputType;
  path: string;
  width: number;
  height: number;
  watermarked: boolean;
};

export type MosaicResult = {
  outputDir: string;
  outputs: Record<MosaicOutputType, MosaicOutput>;
  tileCount: number;
  masterWidth: number;
  masterHeight: number;
  cells: number;
  columns: number;
  rows: number;
  maxTileReuse: number;
  processingMs: number;
  warnings: string[];
};

export type GenerateMosaicInput = {
  heroPath: string;
  tilesDir?: string;
  tilePaths?: string[];
  outputDir: string;
  options?: Partial<MosaicOptions>;
  onProgress?: (stage: string, progress: number) => void;
  /** Normalized face/subject center (0–1) in the original hero image. Auto-estimated if omitted. */
  heroFaceCenter?: { x: number; y: number };
};

type Lab = {
  l: number;
  a: number;
  b: number;
};

type Tile = {
  index: number;
  sourcePath: string;
  lab: Lab;
  quadLabs: [Lab, Lab, Lab, Lab];
};

type Placement = {
  tileIndex: number;
  left: number;
  top: number;
  width: number;
  height: number;
  avgR: number;
  avgG: number;
  avgB: number;
};

export const downloadOutputTypes: Record<MosaicOutputType, { filename: string; label: string }> = {
  master: { filename: "master-24x36.jpg", label: "24x36 master" },
  revealPreview: { filename: "reveal-1080x1920.jpg", label: "Reveal video mosaic" },
  print20x30: { filename: "print-20x30.jpg", label: "20x30 print" },
  print18x24: { filename: "print-18x24.jpg", label: "18x24 print" },
  print12x18: { filename: "print-12x18.jpg", label: "12x18 print" },
  phoneWallpaper: { filename: "wallpaper-phone.jpg", label: "Phone wallpaper" },
  desktopWallpaper: { filename: "wallpaper-desktop.jpg", label: "Desktop wallpaper" },
  socialPreview: { filename: "preview-social-1080x1350.jpg", label: "Social preview" },
  squarePreview: { filename: "preview-square-1080x1080.jpg", label: "Square preview" }
};

export function mosaicOptionsFromEnv(): MosaicOptions {
  return {
    masterWidth: 7200,
    masterHeight: 10800,
    // 80×120 → 90×90px tiles = 0.3" at 300 DPI, good detail for 24×36" print
    columns: 80,
    rows: 120,
    // Screen base: 1080×1920 at 54×96 → 20×20px tiles, detailed enough for social video
    screenWidth: 1080,
    screenHeight: 1920,
    screenColumns: 54,
    screenRows: 96,
    tileSize: 128,
    heroBlendOpacity: 0.28,
    watermarkText: "InstaMosaic",
    watermarkOpacity: 0.35,
    jpegQuality: 82,
    tileReuseFactor: 1.2,
    minRepeatRadius: 8,
    tileColorMatch: 0.45
  };
}

export async function generateMosaic(input: GenerateMosaicInput): Promise<MosaicResult> {
  const started = Date.now();
  let options = { ...mosaicOptionsFromEnv(), ...input.options };
  validateOptions(options);
  await mkdir(input.outputDir, { recursive: true });

  const tilePaths = input.tilePaths?.length ? input.tilePaths : await listTileImages(input.tilesDir);
  if (tilePaths.length === 0) {
    throw new Error("No Instagram tiles found. Download tiles before generating a mosaic.");
  }

  input.onProgress?.("Loading Instagram tiles", 0.05);
  const tiles = await loadTiles(tilePaths);
  const warnings: string[] = [];
  if (tiles.length < 25) {
    warnings.push(`Only ${tiles.length} tiles were available; the mosaic will reuse tiles heavily.`);
  }

  // Detect subject/face center for smart crops
  const faceCenter = input.heroFaceCenter ?? await getSmartCropCenter(input.heroPath);

  // Normalize EXIF orientation once. Sharp metadata does not reflect `.rotate()`
  // dimensions, but extract regions are applied after rotation in the pipeline.
  const orientedHero = await sharp(input.heroPath).rotate().toBuffer({ resolveWithObject: true });
  const heroInput = orientedHero.data;
  const heroW = orientedHero.info.width;
  const heroH = orientedHero.info.height;
  options = orientOptionsForHero(options, heroW, heroH);

  // ── PRINT PASS ──────────────────────────────────────────────────────────────
  input.onProgress?.("Matching print mosaic cells", 0.1);
  const printHeroRegion = cropRegionForFace(heroW, heroH, options.masterWidth, options.masterHeight, faceCenter);
  const printHeroRaw = await sharp(heroInput)
    .extract(printHeroRegion)
    .resize(options.masterWidth, options.masterHeight)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const printPlacements = buildPlacements({
    heroBuffer: printHeroRaw.data,
    channels: printHeroRaw.info.channels,
    width: options.masterWidth,
    height: options.masterHeight,
    columns: options.columns,
    rows: options.rows,
    tiles,
    tileReuseFactor: options.tileReuseFactor,
    minRepeatRadius: options.minRepeatRadius,
    onProgress: (fraction) => input.onProgress?.("Matching print mosaic cells", interpolate(0.10, 0.24, fraction))
  });

  input.onProgress?.("Building print mosaic", 0.25);
  const printLayerPath = path.join(input.outputDir, ".print-layer.jpg");
  await writeTileLayer({
    outputPath: printLayerPath,
    width: options.masterWidth,
    height: options.masterHeight,
    placements: printPlacements,
    tiles,
    jpegQuality: options.jpegQuality,
    tileColorMatch: options.tileColorMatch,
    onProgress: (fraction) => input.onProgress?.("Building print mosaic", interpolate(0.25, 0.47, fraction))
  });

  input.onProgress?.("Blending print hero", 0.48);
  const masterPath = path.join(input.outputDir, downloadOutputTypes.master.filename);
  const printHeroOverlay = await sharp(heroInput)
    .extract(printHeroRegion)
    .resize(options.masterWidth, options.masterHeight)
    .ensureAlpha(clamp(options.heroBlendOpacity, 0, 1))
    .png()
    .toBuffer();

  await sharp(printLayerPath)
    .composite([{ input: printHeroOverlay, blend: "over" }])
    .jpeg({ quality: options.jpegQuality, mozjpeg: true })
    .withMetadata({ density: 300 })
    .toFile(masterPath);

  await rm(printLayerPath, { force: true });

  // ── SCREEN PASS ─────────────────────────────────────────────────────────────
  input.onProgress?.("Matching screen mosaic cells", 0.55);
  const screenHeroRegion = cropRegionForFace(heroW, heroH, options.screenWidth, options.screenHeight, faceCenter);
  const screenHeroRaw = await sharp(heroInput)
    .extract(screenHeroRegion)
    .resize(options.screenWidth, options.screenHeight)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Cap radius so it doesn't over-constrain the smaller grid
  const screenRadius = Math.min(options.minRepeatRadius, Math.floor(options.screenColumns / 4));
  const screenPlacements = buildPlacements({
    heroBuffer: screenHeroRaw.data,
    channels: screenHeroRaw.info.channels,
    width: options.screenWidth,
    height: options.screenHeight,
    columns: options.screenColumns,
    rows: options.screenRows,
    tiles,
    tileReuseFactor: options.tileReuseFactor,
    minRepeatRadius: screenRadius,
    onProgress: (fraction) => input.onProgress?.("Matching screen mosaic cells", interpolate(0.55, 0.61, fraction))
  });

  input.onProgress?.("Building screen mosaic", 0.62);
  const screenLayerPath = path.join(input.outputDir, ".screen-layer.jpg");
  await writeTileLayer({
    outputPath: screenLayerPath,
    width: options.screenWidth,
    height: options.screenHeight,
    placements: screenPlacements,
    tiles,
    jpegQuality: options.jpegQuality,
    tileColorMatch: options.tileColorMatch,
    onProgress: (fraction) => input.onProgress?.("Building screen mosaic", interpolate(0.62, 0.71, fraction))
  });

  input.onProgress?.("Blending screen hero", 0.72);
  const screenMasterPath = path.join(input.outputDir, ".screen-master.jpg");
  const screenHeroOverlay = await sharp(heroInput)
    .extract(screenHeroRegion)
    .resize(options.screenWidth, options.screenHeight)
    .ensureAlpha(clamp(options.heroBlendOpacity, 0, 1))
    .png()
    .toBuffer();

  await sharp(screenLayerPath)
    .composite([{ input: screenHeroOverlay, blend: "over" }])
    .jpeg({ quality: options.jpegQuality, mozjpeg: true })
    .toFile(screenMasterPath);

  await rm(screenLayerPath, { force: true });

  // ── EXPORTS ─────────────────────────────────────────────────────────────────
  input.onProgress?.("Generating exports", 0.80);
  const outputs = await exportOutputs({
    masterPath,
    screenMasterPath,
    outputDir: input.outputDir,
    options,
    faceCenter,
    onProgress: (fraction) => input.onProgress?.("Generating exports", interpolate(0.80, 0.96, fraction))
  });

  await rm(screenMasterPath, { force: true });

  const reuseCounts = printPlacements.reduce((counts, placement) => {
    counts.set(placement.tileIndex, (counts.get(placement.tileIndex) ?? 0) + 1);
    return counts;
  }, new Map<number, number>());

  input.onProgress?.("Done", 1);
  return {
    outputDir: input.outputDir,
    outputs,
    tileCount: tiles.length,
    masterWidth: outputs.master.width,
    masterHeight: outputs.master.height,
    cells: options.columns * options.rows,
    columns: options.columns,
    rows: options.rows,
    maxTileReuse: Math.max(...reuseCounts.values()),
    processingMs: Date.now() - started,
    warnings
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function listTileImages(tilesDir?: string): Promise<string[]> {
  if (!tilesDir) return [];
  const entries = await readdir(tilesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
    .map((entry) => path.join(tilesDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Estimate the subject center in the hero image.
 * The slight upward bias preserves heads better for people-focused portraits.
 */
async function getSmartCropCenter(heroPath: string): Promise<{ x: number; y: number }> {
  await sharp(heroPath).rotate().metadata();
  return { x: 0.5, y: 0.42 };
}

function orientOptionsForHero(options: MosaicOptions, heroWidth: number, heroHeight: number): MosaicOptions {
  const heroIsLandscape = heroWidth > heroHeight;
  const outputIsLandscape = options.masterWidth > options.masterHeight;
  if (!heroIsLandscape || outputIsLandscape) return options;

  return {
    ...options,
    masterWidth: options.masterHeight,
    masterHeight: options.masterWidth,
    columns: options.rows,
    rows: options.columns,
    screenWidth: options.screenHeight,
    screenHeight: options.screenWidth,
    screenColumns: options.screenRows,
    screenRows: options.screenColumns
  };
}

/**
 * Compute the extract region from a source image that centers the crop on `face`
 * while filling the target dimensions. Returned region is in source pixel coords.
 */
function cropRegionForFace(
  srcWidth: number,
  srcHeight: number,
  targetWidth: number,
  targetHeight: number,
  face: { x: number; y: number }
): { left: number; top: number; width: number; height: number } {
  const srcAspect = srcWidth / srcHeight;
  const targetAspect = targetWidth / targetHeight;

  let cropW: number, cropH: number, left: number, top: number;

  if (targetAspect > srcAspect) {
    // Target wider → use full source width, crop height
    cropW = srcWidth;
    cropH = Math.floor(srcWidth / targetAspect);
    left = 0;
    top = clamp(Math.round(face.y * srcHeight - cropH / 2), 0, srcHeight - cropH);
  } else {
    // Target taller (or same ratio) → use full source height, crop width
    cropH = srcHeight;
    cropW = Math.floor(srcHeight * targetAspect);
    top = 0;
    left = clamp(Math.round(face.x * srcWidth - cropW / 2), 0, srcWidth - cropW);
  }

  cropW = clamp(cropW, 1, srcWidth);
  cropH = clamp(cropH, 1, srcHeight);
  left = clamp(left, 0, srcWidth - cropW);
  top = clamp(top, 0, srcHeight - cropH);

  return {
    left: Math.floor(left),
    top: Math.floor(top),
    width: Math.floor(cropW),
    height: Math.floor(cropH)
  };
}

async function loadTiles(tilePaths: string[]): Promise<Tile[]> {
  const tiles: Tile[] = [];
  for (const sourcePath of tilePaths) {
    try {
      // Sample tile as 2x2 grid (TL, TR, BL, BR) for directional color matching
      const { data, info } = await sharp(sourcePath)
        .rotate()
        .resize(2, 2, { fit: "cover" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      if (info.channels < 3) throw new Error(`Unsupported channel count: ${info.channels}`);
      const ch = info.channels;
      const quadLabs: [Lab, Lab, Lab, Lab] = [
        rgbToLab(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0),                             // TL
        rgbToLab(data[ch] ?? 0, data[ch + 1] ?? 0, data[ch + 2] ?? 0),                 // TR
        rgbToLab(data[ch * 2] ?? 0, data[ch * 2 + 1] ?? 0, data[ch * 2 + 2] ?? 0),    // BL
        rgbToLab(data[ch * 3] ?? 0, data[ch * 3 + 1] ?? 0, data[ch * 3 + 2] ?? 0)     // BR
      ];
      const lab = rgbToLab(
        ((data[0] ?? 0) + (data[ch] ?? 0) + (data[ch * 2] ?? 0) + (data[ch * 3] ?? 0)) / 4,
        ((data[1] ?? 0) + (data[ch + 1] ?? 0) + (data[ch * 2 + 1] ?? 0) + (data[ch * 3 + 1] ?? 0)) / 4,
        ((data[2] ?? 0) + (data[ch + 2] ?? 0) + (data[ch * 2 + 2] ?? 0) + (data[ch * 3 + 2] ?? 0)) / 4
      );
      tiles.push({ index: tiles.length, sourcePath, lab, quadLabs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load tile ${sourcePath}: ${message}`);
    }
  }
  return tiles;
}

function buildPlacements(input: {
  heroBuffer: Buffer;
  channels: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  tiles: Tile[];
  tileReuseFactor: number;
  minRepeatRadius: number;
  onProgress?: (fraction: number) => void;
}): Placement[] {
  const cells = input.columns * input.rows;
  const maxReuse = Math.max(1, Math.ceil((cells / input.tiles.length) * input.tileReuseFactor));
  const reuse = new Array(input.tiles.length).fill(0) as number[];
  const grid = new Array<number>(cells).fill(-1);
  const placements: Placement[] = [];
  const radius = Math.max(0, input.minRepeatRadius);

  // Randomize processing order — prevents raster-scan stripe/diagonal patterns.
  // With shuffled order the spatial exclusion zone is genuinely radial rather
  // than biased to the upper-left quadrant.
  const cellOrder = Array.from({ length: cells }, (_, i) => i);
  for (let i = cellOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cellOrder[i]!;
    cellOrder[i] = cellOrder[j]!;
    cellOrder[j] = tmp;
  }

  // Global recency ring: prevents the same tile from appearing in rapid
  // succession anywhere in the image, even outside the spatial radius.
  const recentSize = Math.min(Math.round(radius * radius * 0.5), Math.floor(input.tiles.length / 2));
  const recentRing: number[] = [];

  const progressEvery = Math.max(1, Math.floor(cells / 100));

  for (let orderIdx = 0; orderIdx < cells; orderIdx += 1) {
    const cellIndex = cellOrder[orderIdx]!;
    const row = Math.floor(cellIndex / input.columns);
    const column = cellIndex % input.columns;

    const left = Math.floor((column * input.width) / input.columns);
    const right = Math.floor(((column + 1) * input.width) / input.columns);
    const top = Math.floor((row * input.height) / input.rows);
    const bottom = Math.floor(((row + 1) * input.height) / input.rows);

    const quadLabs = cellQuadLabs(input.heroBuffer, input.channels, input.width, left, top, right, bottom);

    // Full-radius spatial exclusion in all 8 directions (not just upper-left),
    // seeded with the global recency ring.
    const nearby = new Set<number>(recentRing);
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        const r = row + dr;
        const c = column + dc;
        if (r >= 0 && r < input.rows && c >= 0 && c < input.columns) {
          const t = grid[r * input.columns + c];
          if (t !== undefined && t >= 0) nearby.add(t);
        }
      }
    }

    const tileIndex = findClosestTile(quadLabs, input.tiles, reuse, maxReuse, nearby);
    reuse[tileIndex] = (reuse[tileIndex] ?? 0) + 1;
    grid[cellIndex] = tileIndex;

    // Advance recency ring
    recentRing.push(tileIndex);
    if (recentRing.length > recentSize) recentRing.shift();

    const { r: avgR, g: avgG, b: avgB } = averageRegionRgb(input.heroBuffer, input.channels, input.width, left, top, right, bottom);
    placements.push({ tileIndex, left, top, width: right - left, height: bottom - top, avgR, avgG, avgB });

    if (orderIdx % progressEvery === 0 || orderIdx === cells - 1) {
      input.onProgress?.((orderIdx + 1) / cells);
    }
  }

  return placements;
}

function averageRegionRgb(
  buffer: Buffer,
  channels: number,
  imageWidth: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): { r: number; g: number; b: number } {
  let r = 0;
  let g = 0;
  let b = 0;
  let pixels = 0;

  for (let y = top; y < bottom; y += 1) {
    let offset = (y * imageWidth + left) * channels;
    for (let x = left; x < right; x += 1) {
      r += buffer[offset] ?? 0;
      g += buffer[offset + 1] ?? 0;
      b += buffer[offset + 2] ?? 0;
      pixels += 1;
      offset += channels;
    }
  }

  if (pixels === 0) return { r: 0, g: 0, b: 0 };
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

function averageRegionLab(
  buffer: Buffer,
  channels: number,
  imageWidth: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): Lab {
  const rgb = averageRegionRgb(buffer, channels, imageWidth, left, top, right, bottom);
  return rgbToLab(rgb.r, rgb.g, rgb.b);
}

function cellQuadLabs(
  buffer: Buffer,
  channels: number,
  imageWidth: number,
  left: number,
  top: number,
  right: number,
  bottom: number
): [Lab, Lab, Lab, Lab] {
  const midX = Math.floor((left + right) / 2);
  const midY = Math.floor((top + bottom) / 2);
  return [
    averageRegionLab(buffer, channels, imageWidth, left, top, midX, midY),
    averageRegionLab(buffer, channels, imageWidth, midX, top, right, midY),
    averageRegionLab(buffer, channels, imageWidth, left, midY, midX, bottom),
    averageRegionLab(buffer, channels, imageWidth, midX, midY, right, bottom)
  ];
}

function quadDistanceSquared(heroQuads: [Lab, Lab, Lab, Lab], tile: Tile): number {
  return (
    labDistanceSquared(heroQuads[0], tile.quadLabs[0]) +
    labDistanceSquared(heroQuads[1], tile.quadLabs[1]) +
    labDistanceSquared(heroQuads[2], tile.quadLabs[2]) +
    labDistanceSquared(heroQuads[3], tile.quadLabs[3])
  );
}

function findClosestTile(
  target: [Lab, Lab, Lab, Lab],
  tiles: Tile[],
  reuse: number[],
  maxReuse: number,
  nearby: Set<number>
): number {
  // Unified scoring replaces the old 4-tier binary fallback.
  // Both penalties are continuous so tile selection grades smoothly rather than
  // snapping between tiers, which was causing visible clustering.
  //
  // Reuse penalty: quadratic growth — a tile used N times costs (1 + 0.12N)²
  // more than a fresh tile, strongly discouraging hot tiles.
  //   N=0  → 1×    N=5  → 2.6×    N=10 → 4.8×    N=20 → 11.6×
  //
  // Spatial penalty: tiles seen within the radius or recency window cost 8×
  // more, so only a dramatically better color match can override.
  //
  // Adding 1 to dist before multiplying prevents a perfect-match (dist=0)
  // from nullifying the spatial penalty.

  let bestIdx = 0;
  let bestScore = Infinity;
  let fallbackIdx = 0;
  let fallbackDist = Infinity;

  for (const tile of tiles) {
    const reuseCount = reuse[tile.index] ?? 0;
    const dist = quadDistanceSquared(target, tile);

    // Unconstrained fallback: used only when every tile has hit maxReuse
    if (dist < fallbackDist) { fallbackDist = dist; fallbackIdx = tile.index; }

    if (reuseCount >= maxReuse) continue;

    const reusePenalty = (1 + reuseCount * 0.12) ** 2;
    const nearbyPenalty = nearby.has(tile.index) ? 8 : 1;
    const score = (dist + 1) * reusePenalty * nearbyPenalty;

    if (score < bestScore) { bestScore = score; bestIdx = tile.index; }
  }

  return bestScore < Infinity ? bestIdx : fallbackIdx;
}

async function writeTileLayer(input: {
  outputPath: string;
  width: number;
  height: number;
  placements: Placement[];
  tiles: Tile[];
  jpegQuality: number;
  tileColorMatch: number;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  const CHANNELS = 3;
  const LOAD_CONCURRENCY = 16;

  // Collect unique (tileIndex, width, height) combos
  const uniqueKeys = new Map<string, { tileIndex: number; width: number; height: number }>();
  for (let placementIndex = 0; placementIndex < input.placements.length; placementIndex += 1) {
    const p = input.placements[placementIndex]!;
    const key = `${p.tileIndex}:${p.width}x${p.height}`;
    if (!uniqueKeys.has(key)) uniqueKeys.set(key, { tileIndex: p.tileIndex, width: p.width, height: p.height });
  }

  // Load each unique tile as raw RGB (concurrency-limited)
  const rawTileCache = new Map<string, Buffer>();
  const pending = [...uniqueKeys.entries()];
  for (let i = 0; i < pending.length; i += LOAD_CONCURRENCY) {
    const batch = pending.slice(i, i + LOAD_CONCURRENCY);
    await Promise.all(
      batch.map(async ([key, { tileIndex, width, height }]) => {
        const tile = input.tiles[tileIndex];
        if (!tile) throw new Error(`Tile index not found: ${tileIndex}`);
        const { data } = await sharp(tile.sourcePath)
          .rotate()
          .resize(width, height, { fit: "cover", position: "attention" })
          .removeAlpha()
          .modulate({ saturation: 0.82 })
          .raw()
          .toBuffer({ resolveWithObject: true });
        rawTileCache.set(key, data);
      })
    );
  }

  // Blit tile pixels directly into canvas buffer, then color-match blend
  const canvas = Buffer.alloc(input.width * input.height * CHANNELS, 255);
  const colorMatch = clamp(input.tileColorMatch, 0, 1);
  const invMatch = 1 - colorMatch;

  const progressEvery = Math.max(1, Math.floor(input.placements.length / 100));
  for (let placementIndex = 0; placementIndex < input.placements.length; placementIndex += 1) {
    const p = input.placements[placementIndex]!;
    const key = `${p.tileIndex}:${p.width}x${p.height}`;
    const tileData = rawTileCache.get(key);
    if (!tileData) continue;

    if (colorMatch === 0) {
      // Fast path: no blending, just copy
      for (let row = 0; row < p.height; row += 1) {
        const srcOffset = row * p.width * CHANNELS;
        const dstOffset = ((p.top + row) * input.width + p.left) * CHANNELS;
        tileData.copy(canvas, dstOffset, srcOffset, srcOffset + p.width * CHANNELS);
      }
    } else {
      // Blit with per-pixel color blend toward cell average
      for (let row = 0; row < p.height; row += 1) {
        const dstRowOffset = ((p.top + row) * input.width + p.left) * CHANNELS;
        const srcRowOffset = row * p.width * CHANNELS;
        for (let col = 0; col < p.width; col += 1) {
          const src = srcRowOffset + col * CHANNELS;
          const dst = dstRowOffset + col * CHANNELS;
          canvas[dst]     = Math.round((tileData[src]     ?? 0) * invMatch + p.avgR * colorMatch);
          canvas[dst + 1] = Math.round((tileData[src + 1] ?? 0) * invMatch + p.avgG * colorMatch);
          canvas[dst + 2] = Math.round((tileData[src + 2] ?? 0) * invMatch + p.avgB * colorMatch);
        }
      }
    }

    if (placementIndex % progressEvery === 0 || placementIndex === input.placements.length - 1) {
      input.onProgress?.((placementIndex + 1) / input.placements.length);
    }
  }

  await sharp(canvas, { raw: { width: input.width, height: input.height, channels: CHANNELS } })
    .jpeg({ quality: input.jpegQuality, mozjpeg: true })
    .withMetadata({ density: 300 })
    .toFile(input.outputPath);
}

function interpolate(start: number, end: number, fraction: number): number {
  return start + (end - start) * clamp(fraction, 0, 1);
}

async function exportOutputs(input: {
  masterPath: string;
  screenMasterPath: string;
  outputDir: string;
  options: MosaicOptions;
  faceCenter: { x: number; y: number };
  onProgress?: (fraction: number) => void;
}): Promise<Record<MosaicOutputType, MosaicOutput>> {
  const { masterPath, screenMasterPath, outputDir, options } = input;

  // Get actual dimensions (may differ from options if sharp rounded)
  const masterMeta = await sharp(masterPath).metadata();
  const masterW = masterMeta.width ?? options.masterWidth;
  const masterH = masterMeta.height ?? options.masterHeight;

  const screenMeta = await sharp(screenMasterPath).metadata();
  const screenW = screenMeta.width ?? options.screenWidth;
  const screenH = screenMeta.height ?? options.screenHeight;
  const landscape = masterW > masterH;
  const socialSize = landscape ? { width: 1350, height: 1080 } : { width: 1080, height: 1350 };
  const print20x30Size = landscape ? { width: 9000, height: 6000 } : { width: 6000, height: 9000 };
  const print18x24Size = landscape ? { width: 7200, height: 5400 } : { width: 5400, height: 7200 };
  const print12x18Size = landscape ? { width: 5400, height: 3600 } : { width: 3600, height: 5400 };

  // Keep these sequential. Running the large master-derived exports in parallel
  // can exceed memory on small Docker hosts and get the worker OOM-killed.
  const revealPreview = await exportResized({
    sourcePath: screenMasterPath, sourceWidth: screenW, sourceHeight: screenH,
    outputPath: path.join(outputDir, downloadOutputTypes.revealPreview.filename),
    width: 1080, height: 1920, watermarked: false, cropCenter: { x: 0.5, y: 0.5 }, options
  });
  input.onProgress?.(1 / 8);

  const socialPreview = await exportResized({
    sourcePath: screenMasterPath, sourceWidth: screenW, sourceHeight: screenH,
    outputPath: path.join(outputDir, downloadOutputTypes.socialPreview.filename),
    width: socialSize.width, height: socialSize.height, watermarked: false, cropCenter: { x: 0.5, y: 0.5 }, options
  });
  input.onProgress?.(2 / 8);

  const squarePreview = await exportResized({
    sourcePath: screenMasterPath, sourceWidth: screenW, sourceHeight: screenH,
    outputPath: path.join(outputDir, downloadOutputTypes.squarePreview.filename),
    width: 1080, height: 1080, watermarked: false, cropCenter: { x: 0.5, y: 0.5 }, options
  });
  input.onProgress?.(3 / 8);

  const print20x30 = await exportResized({
    sourcePath: masterPath, sourceWidth: masterW, sourceHeight: masterH,
    outputPath: path.join(outputDir, downloadOutputTypes.print20x30.filename),
    width: print20x30Size.width, height: print20x30Size.height, density: 300, watermarked: false, cropCenter: { x: 0.5, y: 0.5 }, options
  });
  input.onProgress?.(4 / 8);

  const print18x24 = await exportResized({
    sourcePath: masterPath, sourceWidth: masterW, sourceHeight: masterH,
    outputPath: path.join(outputDir, downloadOutputTypes.print18x24.filename),
    width: print18x24Size.width, height: print18x24Size.height, density: 300, watermarked: false, cropCenter: { x: 0.5, y: 0.5 }, options
  });
  input.onProgress?.(5 / 8);

  const print12x18 = await exportResized({
    sourcePath: masterPath, sourceWidth: masterW, sourceHeight: masterH,
    outputPath: path.join(outputDir, downloadOutputTypes.print12x18.filename),
    width: print12x18Size.width, height: print12x18Size.height, density: 300, watermarked: false, cropCenter: { x: 0.5, y: 0.5 }, options
  });
  input.onProgress?.(6 / 8);

  const phoneWallpaper = await exportResized({
    sourcePath: masterPath, sourceWidth: masterW, sourceHeight: masterH,
    outputPath: path.join(outputDir, downloadOutputTypes.phoneWallpaper.filename),
    width: 1290, height: 2796, watermarked: false, cropCenter: { x: 0.5, y: 0.5 }, options
  });
  input.onProgress?.(7 / 8);

  const desktopWallpaper = await exportResized({
    sourcePath: masterPath, sourceWidth: masterW, sourceHeight: masterH,
    outputPath: path.join(outputDir, downloadOutputTypes.desktopWallpaper.filename),
    width: 2560, height: 1440, watermarked: false, cropCenter: { x: 0.5, y: 0.38 }, options
  });
  input.onProgress?.(1);

  return {
    master: { type: "master", path: masterPath, width: masterW, height: masterH, watermarked: false },
    revealPreview,
    socialPreview,
    squarePreview,
    print20x30,
    print18x24,
    print12x18,
    phoneWallpaper,
    desktopWallpaper
  };
}

async function exportResized(input: {
  sourcePath: string;
  sourceWidth: number;
  sourceHeight: number;
  outputPath: string;
  width: number;
  height: number;
  density?: number;
  watermarked: boolean;
  cropCenter: { x: number; y: number };
  options: MosaicOptions;
}): Promise<MosaicOutput> {
  const region = cropRegionForFace(input.sourceWidth, input.sourceHeight, input.width, input.height, input.cropCenter);

  let image = sharp(input.sourcePath)
    .extract(region)
    .resize(input.width, input.height);

  if (input.watermarked) {
    image = image.composite([
      {
        input: Buffer.from(watermarkSvg(input.width, input.height, input.options.watermarkText, input.options.watermarkOpacity)),
        blend: "over"
      }
    ]);
  }

  await image
    .jpeg({ quality: input.options.jpegQuality, mozjpeg: true })
    .withMetadata(input.density ? { density: input.density } : {})
    .toFile(input.outputPath);

  const type = Object.entries(downloadOutputTypes).find(([, value]) => input.outputPath.endsWith(value.filename))?.[0];
  if (!type) throw new Error(`Unknown output file: ${input.outputPath}`);

  return {
    type: type as MosaicOutputType,
    path: input.outputPath,
    width: input.width,
    height: input.height,
    watermarked: input.watermarked
  };
}

function watermarkSvg(width: number, height: number, text: string, opacity: number): string {
  const safeText = escapeXml(text);
  const fontSize = Math.max(48, Math.round(Math.min(width, height) / 11));
  const gap = Math.round(fontSize * 3.3);
  const rows = Math.ceil(height / gap) + 3;
  const cols = Math.ceil(width / gap) + 3;
  const marks: string[] = [];

  for (let row = -1; row < rows; row += 1) {
    for (let col = -1; col < cols; col += 1) {
      marks.push(
        `<text x="${col * gap}" y="${row * gap}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="rgba(255,255,255,${clamp(opacity, 0, 1)})" stroke="rgba(0,0,0,${clamp(opacity * 0.45, 0, 1)})" stroke-width="2">${safeText}</text>`
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <g transform="rotate(-28 ${width / 2} ${height / 2})">${marks.join("")}</g>
  </svg>`;
}

function rgbToLab(r: number, g: number, b: number): Lab {
  const [x, y, z] = rgbToXyz(r, g, b);
  const refX = 95.047;
  const refY = 100;
  const refZ = 108.883;
  const fx = xyzPivot(x / refX);
  const fy = xyzPivot(y / refY);
  const fz = xyzPivot(z / refZ);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rr = rgbPivot(r / 255);
  const gg = rgbPivot(g / 255);
  const bb = rgbPivot(b / 255);
  return [
    (rr * 0.4124 + gg * 0.3576 + bb * 0.1805) * 100,
    (rr * 0.2126 + gg * 0.7152 + bb * 0.0722) * 100,
    (rr * 0.0193 + gg * 0.1192 + bb * 0.9505) * 100
  ];
}

function rgbPivot(value: number): number {
  return value > 0.04045 ? ((value + 0.055) / 1.055) ** 2.4 : value / 12.92;
}

function xyzPivot(value: number): number {
  return value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
}

function labDistanceSquared(left: Lab, right: Lab): number {
  return (left.l - right.l) ** 2 + (left.a - right.a) ** 2 + (left.b - right.b) ** 2;
}

function validateOptions(options: MosaicOptions): void {
  const positiveIntegerKeys = ["masterWidth", "masterHeight", "columns", "rows", "screenWidth", "screenHeight", "screenColumns", "screenRows", "tileSize", "jpegQuality"] as const;
  for (const key of positiveIntegerKeys) {
    if (!Number.isInteger(options[key]) || options[key] <= 0) {
      throw new Error(`Invalid mosaic option ${key}: ${options[key]}`);
    }
  }
  if (options.columns > options.masterWidth || options.rows > options.masterHeight) {
    throw new Error("Mosaic grid cannot have more rows or columns than master pixels.");
  }
  if (options.screenColumns > options.screenWidth || options.screenRows > options.screenHeight) {
    throw new Error("Screen grid cannot have more rows or columns than screen dimensions.");
  }
  if (options.heroBlendOpacity < 0 || options.heroBlendOpacity > 1) {
    throw new Error("Hero blend opacity must be between 0 and 1.");
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
