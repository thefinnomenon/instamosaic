import path from "node:path";
type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { getGeneratedAsset, getJobByDownloadToken } from "@instamosaic/db";
import { downloadOutputTypes } from "@instamosaic/mosaic/outputs";
import { readObjectBuffer } from "@instamosaic/storage";
import { errorJson, imageResponse, responseBody } from "../../../../lib/server.ts";

export async function GET({ params, request }: APIEvent): Promise<Response> {
  const job = params.token ? await getJobByDownloadToken(params.token) : null;
  if (!job || job.status !== "completed") return errorJson("Artwork is not ready.", 404);
  const size = new URL(request.url).searchParams.get("size") || "24x36";
  const assetType = artworkAssetTypeForSize(size);
  const asset = await getGeneratedAsset(job.id, assetType);
  if (asset) {
    const body = await readObjectBuffer(asset.object_key);
    return new Response(responseBody(body), { headers: { "Content-Type": asset.content_type, "Cache-Control": "private, max-age=60" } });
  }
  return imageResponse(path.join(job.output_dir, artworkFilenameForSize(size)));
}

function artworkAssetTypeForSize(size: string): string {
  if (size === "12x18") return "print12x18";
  if (size === "20x30") return "print20x30";
  return "master";
}

function artworkFilenameForSize(size: string): string {
  if (size === "12x18") return downloadOutputTypes.print12x18.filename;
  if (size === "20x30") return downloadOutputTypes.print20x30.filename;
  return downloadOutputTypes.master.filename;
}
