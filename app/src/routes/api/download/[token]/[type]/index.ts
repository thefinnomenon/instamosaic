import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { ZipArchive } from "archiver";
import { downloadOutputTypes } from "@instamosaic/mosaic/outputs";
import {
  assertRateLimit,
  getGeneratedAsset,
  getJobByDownloadToken,
  listGeneratedAssets,
  recordDownloadCompleted,
  recordDownloadStarted
} from "@instamosaic/db";
import { readObjectBuffer } from "@instamosaic/storage";
import { errorJson, getClientIp, imageResponse, rateLimitResponse, responseBody, shouldBypassRateLimit } from "../../../../../lib/server.ts";

const REVEAL_VIDEO_FILENAME = "reveal.mp4";

export async function GET({ params, request }: APIEvent): Promise<Response> {
  const token = params.token;
  const outputType = String(params.type || "");
  const ip = getClientIp(request);

  if (!shouldBypassRateLimit()) {
    const limit = await assertRateLimit({ scope: "download_ip", identity: ip, limit: 20, windowMs: 60 * 60_000 });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  }

  const job = token ? await getJobByDownloadToken(token) : null;
  if (!job || job.status !== "completed") return errorJson("Download is not ready.", 403);

  // Reveal video is always free. All other downloads require payment.
  if (outputType !== "reveal" && !job.paid_at) return errorJson("Download is locked.", 403);

  if (outputType === "bundle") {
    const downloadId = await recordDownloadStarted({ jobId: job.id, token: job.download_token, outputType, ip });
    const response = await zipResponse(job.id, job.output_dir, `instamosaic-${job.username}-digital-files.zip`);
    await recordDownloadCompleted(downloadId, job.id, outputType, ip);
    return response;
  }

  if (outputType === "reveal") {
    const filePath = path.join(job.output_dir, REVEAL_VIDEO_FILENAME);
    const asset = await getGeneratedAsset(job.id, "reveal");
    if (!asset && !existsSync(filePath)) return errorJson("Reveal video is not ready.", 404);
    const isPreload = new URL(request.url).searchParams.get("preload") === "1";
    const downloadId = isPreload ? null : await recordDownloadStarted({ jobId: job.id, token: job.download_token, outputType, ip });
    const response = asset
      ? await objectFileResponse(asset.object_key, `instamosaic-${job.username}-${REVEAL_VIDEO_FILENAME}`, "video/mp4", { disposition: "inline", cacheControl: "public, max-age=86400, immutable" })
      : await fileResponse(filePath, `instamosaic-${job.username}-${REVEAL_VIDEO_FILENAME}`, "video/mp4", {
          disposition: "inline",
          cacheControl: "public, max-age=86400, immutable"
        });
    if (downloadId) await recordDownloadCompleted(downloadId, job.id, outputType, ip);
    return response;
  }

  const output = outputType in downloadOutputTypes ? downloadOutputTypes[outputType as keyof typeof downloadOutputTypes] : undefined;
  if (!output) return errorJson("Unknown download type.", 404);

  const filePath = path.join(job.output_dir, output.filename);
  const asset = await getGeneratedAsset(job.id, outputType);
  const downloadId = await recordDownloadStarted({ jobId: job.id, token: job.download_token, outputType, ip });
  const response = asset
    ? await objectFileResponse(asset.object_key, `instamosaic-${job.username}-${output.filename}`, asset.content_type)
    : await imageResponse(filePath, `instamosaic-${job.username}-${output.filename}`);
  await recordDownloadCompleted(downloadId, job.id, outputType, ip);
  return response;
}

async function zipResponse(jobId: string, outputDir: string, filename: string): Promise<Response> {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const stream = new PassThrough();

  archive.on("error", (error) => {
    stream.destroy(error);
  });

  const assets = await listGeneratedAssets(jobId);
  const assetsByType = new Map(assets.map((asset) => [asset.type, asset]));

  for (const [type, output] of Object.entries(downloadOutputTypes)) {
    const asset = assetsByType.get(type);
    if (asset) {
      archive.append(await readObjectBuffer(asset.object_key), { name: output.filename });
    } else {
      archive.file(path.join(outputDir, output.filename), { name: output.filename });
    }
  }
  const revealPath = path.join(outputDir, REVEAL_VIDEO_FILENAME);
  const revealAsset = assetsByType.get("reveal");
  if (revealAsset) archive.append(await readObjectBuffer(revealAsset.object_key), { name: REVEAL_VIDEO_FILENAME });
  else if (existsSync(revealPath)) archive.file(revealPath, { name: REVEAL_VIDEO_FILENAME });

  archive.pipe(stream);
  void archive.finalize();

  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store"
    }
  });
}

async function objectFileResponse(
  key: string,
  filename: string,
  contentType: string,
  options: { disposition?: "attachment" | "inline"; cacheControl?: string } = {}
): Promise<Response> {
  const body = await readObjectBuffer(key);
  const disposition = options.disposition ?? "attachment";
  return new Response(responseBody(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename.replaceAll('"', "")}"`,
      "Cache-Control": options.cacheControl ?? "private, no-store"
    }
  });
}

async function fileResponse(
  filePath: string,
  filename: string,
  contentType: string,
  options: { disposition?: "attachment" | "inline"; cacheControl?: string } = {}
): Promise<Response> {
  const body = await readFile(filePath);
  const disposition = options.disposition ?? "attachment";
  return new Response(responseBody(body), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `${disposition}; filename="${filename.replaceAll('"', "")}"`,
      "Cache-Control": options.cacheControl ?? "private, no-store"
    }
  });
}
