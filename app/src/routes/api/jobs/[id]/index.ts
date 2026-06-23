import type { APIEvent } from "@solidjs/start/server";
import { getJob, toPublicJob } from "@instamosaic/db";
import { errorJson, json } from "../../../../lib/server.ts";

export async function GET({ params }: APIEvent): Promise<Response> {
  const id = params.id;
  const job = id ? getJob(id) : null;
  if (!job) return errorJson("Job not found.", 404);
  return json({ job: toPublicJob(job, job.status === "completed") });
}
