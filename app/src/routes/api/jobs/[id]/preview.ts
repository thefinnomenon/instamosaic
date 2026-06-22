import path from "node:path";
import type { APIEvent } from "@solidjs/start/server";
import { getJob } from "@instamosaic/db";
import { downloadOutputTypes } from "@instamosaic/mosaic";
import { errorJson, imageResponse } from "../../../../lib/server.ts";

export async function GET({ request, params }: APIEvent): Promise<Response> {
  const job = params.id ? getJob(params.id) : null;
  if (!job) return errorJson("Job not found.", 404);

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "hero") return imageResponse(job.hero_path);
  if (kind === "master") {
    if (job.status !== "completed") return errorJson("Mosaic is not ready yet.", 404);
    return imageResponse(path.join(job.output_dir, downloadOutputTypes.master.filename));
  }

  const filePath = kind === "square" ? job.square_preview_path : job.preview_path;
  if (!filePath || job.status !== "completed") {
    return errorJson("Preview is not ready yet.", 404);
  }

  return imageResponse(filePath);
}
