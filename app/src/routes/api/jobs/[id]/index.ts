type APIEvent = { request: Request; params: Record<string, string | undefined> };
import { getJob, toPublicJob } from "@instamosaic/db";
import { errorJson, json } from "../../../../lib/server.ts";

export async function GET({ params }: APIEvent): Promise<Response> {
  const id = params.id;
  const job = id ? await getJob(id) : null;
  if (!job) return errorJson("Job not found.", 404);
  return json({ job: await toPublicJob(job, true) });
}
