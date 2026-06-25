import "dotenv/config";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildRevealVideoCommand, generateRevealVideo } from "@instamosaic/worker";

const defaultOriginalImage = path.resolve("scripts", "hero.jpeg");
const defaultMosaicImage = existsSync(path.resolve("scripts", "reveal-mosaic.jpg"))
  ? path.resolve("scripts", "reveal-mosaic.jpg")
  : path.resolve("scripts", "social-mosaic.jpg");
const defaultOutputVideo = path.resolve("tmp", "test", "reveal", "reveal.mp4");

const originalImage = process.argv[2] ? path.resolve(process.argv[2]) : defaultOriginalImage;
const mosaicImage = process.argv[3] ? path.resolve(process.argv[3]) : defaultMosaicImage;
const outputVideo = process.argv[4] ? path.resolve(process.argv[4]) : defaultOutputVideo;

if (!existsSync(originalImage)) {
  console.error(`Original image not found: ${originalImage}`);
  console.error("Default expected path: scripts/hero.jpeg");
  console.error("Usage: npm run test:reveal -- [original.jpg] [mosaic.jpg] [output.mp4]");
  process.exit(1);
}

if (!existsSync(mosaicImage)) {
  console.error(`Mosaic image not found: ${mosaicImage}`);
  console.error("Default expected path: scripts/reveal-mosaic.jpg or scripts/social-mosaic.jpg");
  console.error("Usage: npm run test:reveal -- [original.jpg] [mosaic.jpg] [output.mp4]");
  process.exit(1);
}

const ffmpegCheck = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpegCheck.error || ffmpegCheck.status !== 0) {
  console.error("ffmpeg is not available on PATH, so the reveal video cannot be rendered.");
  console.error("On macOS, install it with: brew install ffmpeg");
  process.exit(1);
}

await mkdir(path.dirname(outputVideo), { recursive: true });

const previewCommand = buildRevealVideoCommand({
  originalImage,
  mosaicImage,
  textOverlay: "<generated-overlay.png>",
  outputVideo
});

console.log(`original: ${originalImage}`);
console.log(`mosaic:   ${mosaicImage}`);
console.log(`output:   ${outputVideo}`);
console.log("ffmpeg command:");
console.log([previewCommand.command, ...previewCommand.args].join(" "));

await generateRevealVideo({
  originalImage,
  mosaicImage,
  outputVideo,
  stats: {
    username: "demo",
    instagramPhotoCount: 2341,
    tileCount: 9600
  },
  logger: {
    debug: (message, metadata) => console.log(message, metadata ?? ""),
    info: (message, metadata) => console.log(message, metadata ?? "")
  }
});

console.log(`reveal: ${outputVideo}`);
