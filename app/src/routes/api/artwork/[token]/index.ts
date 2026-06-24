import path from "node:path";
import type { APIEvent } from "@solidjs/start/server";
import { getJobByDownloadToken } from "@instamosaic/db";
import { downloadOutputTypes } from "@instamosaic/mosaic";
import { errorJson, imageResponse } from "../../../../lib/server.ts";

export async function GET({ params, request }: APIEvent): Promise<Response> {
  const job = params.token ? getJobByDownloadToken(params.token) : null;
  if (!job || job.status !== "completed") return errorJson("Artwork is not ready.", 404);
  const size = new URL(request.url).searchParams.get("size") || "24x36";
  return imageResponse(path.join(job.output_dir, artworkFilenameForSize(size)));
}

function artworkFilenameForSize(size: string): string {
  if (size === "12x18") return downloadOutputTypes.print12x18.filename;
  if (size === "20x30") return downloadOutputTypes.print20x30.filename;
  return downloadOutputTypes.master.filename;
}
