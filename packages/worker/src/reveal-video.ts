import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const revealVideoFilename = "reveal.mp4";

export type RevealVideoStats = {
  username?: string;
  instagramPhotoCount?: number | null;
  tileCount?: number | null;
};

export type RevealVideoInput = {
  originalImage: string;
  mosaicImage: string;
  outputVideo: string;
  stats?: RevealVideoStats;
  logger?: RevealVideoLogger;
};

export type RevealVideoLogger = {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  info?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type RevealVideoCommand = {
  command: string;
  args: string[];
  filterComplex: string;
};

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const ORIGINAL_SECONDS = 3.2;
const MOSAIC_SECONDS = 5.8;
const TOTAL_SECONDS = 8;
const ORIGINAL_FRAMES = ORIGINAL_SECONDS * FPS;
const MOSAIC_FRAMES = MOSAIC_SECONDS * FPS;

export async function generateRevealVideo(input: RevealVideoInput): Promise<void> {
  const tempDir = path.join(path.dirname(input.outputVideo), `.reveal-video-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true });
  const originalFrame = path.join(tempDir, "original-frame.png");
  const mosaicFrame = path.join(tempDir, "mosaic-frame.png");
  const textOverlay = path.join(tempDir, "text-overlay.png");

  try {
    await writeRevealFrame(input.originalImage, originalFrame);
    await writeRevealFrame(input.mosaicImage, mosaicFrame);
    await writeTextOverlay(textOverlay, input.stats);
    const command = buildRevealVideoCommand({
      originalImage: originalFrame,
      mosaicImage: mosaicFrame,
      textOverlay,
      outputVideo: input.outputVideo
    });

    input.logger?.debug?.("Rendering reveal video.", { command: command.command, args: command.args });
    await runFfmpeg(command);
    input.logger?.info?.("Reveal video rendered.", { outputVideo: input.outputVideo });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function buildRevealVideoCommand(input: {
  originalImage: string;
  mosaicImage: string;
  textOverlay: string;
  outputVideo: string;
}): RevealVideoCommand {
  const original = [
    "[0:v]setsar=1,",
    `zoompan=z='if(lte(on,30),1,1+4.2*(1-cos(PI*(on-30)/${ORIGINAL_FRAMES - 31}))/2)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${ORIGINAL_FRAMES}:s=${WIDTH}x${HEIGHT}:fps=${FPS},`,
    `trim=duration=${ORIGINAL_SECONDS},setpts=PTS-STARTPTS[original]`
  ].join("");

  const mosaicZoom = [
    "if(lte(on,18),5.2,",
    "if(lte(on,108),5.2-4.2*(1-cos(PI*(on-18)/90))/2,1))"
  ].join("");

  const mosaic = [
    "[1:v]setsar=1,",
    `zoompan=z='${mosaicZoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${MOSAIC_FRAMES}:s=${WIDTH}x${HEIGHT}:fps=${FPS},`,
    `trim=duration=${MOSAIC_SECONDS},setpts=PTS-STARTPTS[mosaic-base]`
  ].join("");

  const text = [
    `[2:v]fps=${FPS},scale=${WIDTH}:${HEIGHT},format=rgba,`,
    "setpts=PTS-STARTPTS[text]"
  ].join("");

  const compose = [
    "[original][mosaic-base]xfade=transition=fade:duration=0.45:offset=2.75[base]",
    "[base][text]overlay=0:0,format=yuv420p[v]"
  ].join(";");

  const filterComplex = [original, mosaic, text, compose].join(";");
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel", "warning",
    "-framerate", "1",
    "-loop", "1",
    "-t", "1",
    "-i", input.originalImage,
    "-framerate", "1",
    "-loop", "1",
    "-t", "1",
    "-i", input.mosaicImage,
    "-framerate", String(FPS),
    "-loop", "1",
    "-t", String(MOSAIC_SECONDS),
    "-i", input.textOverlay,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-an",
    "-c:v", "libx264",
    "-profile:v", "high",
    "-level", "4.1",
    "-pix_fmt", "yuv420p",
    "-r", String(FPS),
    "-t", String(TOTAL_SECONDS),
    "-movflags", "+faststart",
    "-preset", "medium",
    "-crf", "20",
    input.outputVideo
  ];

  return { command: "ffmpeg", args, filterComplex };
}

async function writeRevealFrame(inputPath: string, outputPath: string): Promise<void> {
  await sharp(inputPath)
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover", position: "center" })
    .png()
    .toFile(outputPath);
}

async function writeTextOverlay(outputPath: string, stats?: RevealVideoStats): Promise<void> {
  const handle = revealHandle(stats);
  const svg = `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000" stop-opacity="0.42"/>
          <stop offset="0.36" stop-color="#000" stop-opacity="0.24"/>
          <stop offset="1" stop-color="#000" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fade)"/>
      <text x="${WIDTH - 58}" y="116"
          text-anchor="end"
          font-family="Arial, Helvetica, sans-serif"
          font-size="44"
          font-weight="800"
          fill="#ffffff"
          paint-order="stroke"
          stroke="#000000"
          stroke-opacity="0.35"
          stroke-width="5">${escapeXml(handle)}</text>
      <text x="${WIDTH - 58}" y="170"
          text-anchor="end"
          font-family="Arial, Helvetica, sans-serif"
          font-size="34"
          font-weight="700"
          fill="#ffffff"
          paint-order="stroke"
          stroke="#000000"
          stroke-opacity="0.35"
          stroke-width="4">instamosaic.net</text>
    </svg>
  `;

  await sharp(Buffer.from(svg)).png().toFile(outputPath);
}

function revealHandle(stats?: RevealVideoStats): string {
  const username = stats?.username?.trim().replace(/^@+/, "");
  return username ? `@${username}` : "@instamosaic";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function runFfmpeg(command: RevealVideoCommand): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.command, command.args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`ffmpeg exited with code ${code}${message ? `: ${message}` : ""}`));
    });
  });
}
