import "dotenv/config";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { generateMosaic } from "@instamosaic/mosaic";
import { checkInstagramProfile, downloadInstagramTiles, mockDownloadInstagramTiles, sanitizeInstagramUsername } from "@instamosaic/worker";

const username = process.argv[2];
const heroPath = process.argv[3];
if (!username || !heroPath) {
  console.error("Usage: npm run test:pipeline -- username hero.jpg");
  process.exit(1);
}

const cleanUsername = sanitizeInstagramUsername(username);
const useMock = process.argv.includes("--mock");
const baseDir = path.resolve("tmp", "test", cleanUsername);
const tilesDir = path.join(baseDir, "tiles");
const outputDir = path.join(baseDir, "output");
await rm(baseDir, { recursive: true, force: true });
await mkdir(tilesDir, { recursive: true });
await mkdir(outputDir, { recursive: true });

const started = Date.now();
console.log("check");
const check = useMock
  ? { exists: true, is_public: true, estimated_photo_count: 12 }
  : await checkInstagramProfile(cleanUsername);
console.log(`exists: ${check.exists}`);
console.log(`public: ${check.is_public}`);
console.log(`estimated_photo_count: ${check.estimated_photo_count}`);
if (!check.exists || !check.is_public) process.exit(2);

console.log("download");
const download = useMock
  ? await mockDownloadInstagramTiles({ outputDir: tilesDir, maxImages: 12, tileSize: 64 })
  : await downloadInstagramTiles({ username: cleanUsername, outputDir: tilesDir });
console.log(`downloaded: ${download.downloaded_count}`);
console.log(`skipped: ${download.skipped_count}`);
if (download.downloaded_count === 0) process.exit(3);

console.log("mosaic");
const mosaic = await generateMosaic({
  heroPath: path.resolve(heroPath),
  tilePaths: download.tile_paths,
  outputDir,
  onProgress(stage, progress) {
    console.log(`${Math.round(progress * 100)}% ${stage}`);
  }
});

console.log(`processing_time_seconds: ${((Date.now() - started) / 1000).toFixed(2)}`);
console.log(`artifacts: ${baseDir}`);
console.log(`tile_count: ${mosaic.tileCount}`);
console.log(`master: ${mosaic.masterWidth}x${mosaic.masterHeight}`);
console.log(`grid: ${mosaic.columns}x${mosaic.rows}`);
for (const output of Object.values(mosaic.outputs)) {
  console.log(`${output.type}: ${output.path}`);
}
