import path from "node:path";
type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { getGeneratedAsset, getJob } from "@instamosaic/db";
import { downloadOutputTypes } from "@instamosaic/mosaic/outputs";
import { readObjectBuffer } from "@instamosaic/storage";
import { errorJson, imageResponse, responseBody } from "../../../../lib/server.ts";

export async function GET({ request, params }: APIEvent): Promise<Response> {
  const job = params.id ? await getJob(params.id) : null;
  if (!job) return errorJson("Job not found.", 404);

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "hero") {
    const metadata = parseMetadata(job.metadata);
    const heroObjectKey = typeof metadata.heroObjectKey === "string" ? metadata.heroObjectKey : null;
    if (heroObjectKey) {
      const contentType = typeof metadata.uploadMime === "string" && metadata.uploadMime.startsWith("image/")
        ? metadata.uploadMime
        : "image/jpeg";
      try {
        return await objectResponse(heroObjectKey, contentType);
      } catch {
        // Local development jobs may only have a filesystem-backed hero.
      }
    }
    return imageResponse(job.hero_path);
  }
  if (kind === "master") {
    if (job.status !== "completed") return errorJson("Mosaic is not ready yet.", 404);
    const asset = await getGeneratedAsset(job.id, "master");
    if (asset) return objectResponse(asset.object_key, asset.content_type);
    return imageResponse(path.join(job.output_dir, downloadOutputTypes.master.filename));
  }

  const assetType = kind === "square" ? "squarePreview" : "socialPreview";
  const asset = await getGeneratedAsset(job.id, assetType);
  if (asset && job.status === "completed") return objectResponse(asset.object_key, asset.content_type);
  const filePath = kind === "square" ? job.square_preview_path : job.preview_path;
  if (!filePath || job.status !== "completed") {
    return errorJson("Preview is not ready yet.", 404);
  }

  return imageResponse(filePath);
}

async function objectResponse(key: string, contentType: string): Promise<Response> {
  const body = await readObjectBuffer(key);
  return new Response(responseBody(body), {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=60"
    }
  });
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
