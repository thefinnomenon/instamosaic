import "dotenv/config";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { downloadInstagramTiles, mockDownloadInstagramTiles, sanitizeInstagramUsername } from "@instamosaic/worker";

const username = process.argv[2];
if (!username) {
  console.error("Usage: npm run test:download -- username");
  process.exit(1);
}

const cleanUsername = sanitizeInstagramUsername(username);
const outputDir = path.resolve("tmp", "test", cleanUsername, "tiles");
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const started = Date.now();
const useMock = process.argv.includes("--mock");
const downloader = useMock ? mockDownloadInstagramTiles : downloadInstagramTiles;
const result = await downloader({
  username: cleanUsername,
  outputDir,
  ...(useMock ? { maxImages: 8, tileSize: 64 } : {}),
  onProgress(event) {
    console.log(`progress: ${Math.round(event.progress * 100)}% ${event.stage}${typeof event.downloaded_count === "number" ? ` (${event.downloaded_count})` : ""}`);
  }
});

console.log(`downloaded: ${result.downloaded_count}`);
console.log(`skipped: ${result.skipped_count}`);
console.log(`processing_time_seconds: ${((Date.now() - started) / 1000).toFixed(2)}`);
console.log(`location: ${outputDir}`);
if (result.warnings.length) console.log(`warnings: ${result.warnings.join("; ")}`);
if (result.errors.length) console.log(`errors: ${result.errors.slice(0, 5).join("; ")}`);
