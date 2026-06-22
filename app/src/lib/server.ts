import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { storageDir } from "@instamosaic/db";
import sharp from "sharp";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const allowedMimes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

export function errorJson(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, { status });
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "local";
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return json(
    { error: "Too many requests. Try again in a moment.", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}

export function shouldBypassRateLimit(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function saveHeroImage(file: File, jobId: string): Promise<{ heroPath: string; outputDir: string; bytes: number; mime: string; width: number | null; height: number | null }> {
  if (!file || file.size <= 0) {
    throw new Error("Upload a hero image.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Hero image must be 15MB or smaller.");
  }
  const mime = file.type;
  const extension = allowedMimes[mime];
  if (!extension) {
    throw new Error("Hero image must be a JPG, PNG, or WEBP file.");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!isValidImageMagic(bytes, mime)) {
    throw new Error("Hero image content does not match the uploaded file type.");
  }

  const outputDir = path.join(storageDir(), "jobs", jobId);
  await mkdir(outputDir, { recursive: true });
  const heroPath = path.join(outputDir, `hero-${randomUUID()}.${extension}`);
  await writeFile(heroPath, bytes);
  const metadata = await sharp(heroPath).rotate().toBuffer({ resolveWithObject: true });
  return { heroPath, outputDir, bytes: bytes.length, mime, width: metadata.info.width ?? null, height: metadata.info.height ?? null };
}

export async function imageResponse(filePath: string, filename?: string): Promise<Response> {
  const body = await readFile(filePath);
  return new Response(body, {
    headers: {
      "Content-Type": contentTypeForImage(filePath),
      "Cache-Control": "private, max-age=60",
      ...(filename ? { "Content-Disposition": `attachment; filename="${filename.replaceAll('"', "")}"` } : {})
    }
  });
}

function contentTypeForImage(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

function isValidImageMagic(bytes: Buffer, mime: string): boolean {
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mime === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}
