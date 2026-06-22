import path from "node:path";
import type { APIEvent } from "@solidjs/start/server";
import { downloadOutputTypes } from "@instamosaic/mosaic";
import {
  assertRateLimit,
  getJobByDownloadToken,
  recordDownloadCompleted,
  recordDownloadStarted
} from "@instamosaic/db";
import { errorJson, getClientIp, imageResponse, rateLimitResponse, shouldBypassRateLimit } from "../../../../../lib/server.ts";

export async function GET({ params, request }: APIEvent): Promise<Response> {
  const token = params.token;
  const outputType = String(params.type || "");
  const ip = getClientIp(request);

  if (!shouldBypassRateLimit()) {
    const limit = assertRateLimit({ scope: "download_ip", identity: ip, limit: 20, windowMs: 60 * 60_000 });
    if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  }

  const job = token ? getJobByDownloadToken(token) : null;
  if (!job || !job.paid_at) return errorJson("Download is locked.", 403);

  const output = outputType in downloadOutputTypes ? downloadOutputTypes[outputType as keyof typeof downloadOutputTypes] : undefined;
  if (!output) return errorJson("Unknown download type.", 404);

  const filePath = path.join(job.output_dir, output.filename);
  const downloadId = recordDownloadStarted({ jobId: job.id, token: job.download_token, outputType, ip });
  const response = await imageResponse(filePath, `instamosaic-${job.username}-${output.filename}`);
  recordDownloadCompleted(downloadId, job.id, outputType, ip);
  return response;
}
