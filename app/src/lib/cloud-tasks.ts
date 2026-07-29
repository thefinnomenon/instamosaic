import type { CloudTasksClient } from "@google-cloud/tasks";
import { createJobDispatch, markJobDispatchFailed, markJobDispatchSent, trackEvent } from "@instamosaic/db";
import { env } from "./env.ts";

let client: CloudTasksClient | null = null;

export async function dispatchGenerationJob(jobId: string): Promise<void> {
  await createJobDispatch(jobId);

  if (env("CLOUD_TASKS_DEV_MODE") === "local") {
    await dispatchLocal(jobId);
    await markJobDispatchSent({ jobId, taskName: `local-${jobId}` });
    await trackEvent({ event: "cloud_task_dispatched_local", jobId });
    return;
  }

  let taskName: string | null = null;

  try {
    const project = requiredEnv("GOOGLE_CLOUD_PROJECT");
    const location = requiredEnv("CLOUD_TASKS_LOCATION");
    const queue = requiredEnv("CLOUD_TASKS_QUEUE");
    const workerUrl = requiredEnv("WORKER_PROCESS_URL");
    const serviceAccountEmail = requiredEnv("CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL");
    const tasks = await tasksClient();
    const parent = tasks.queuePath(project, location, queue);
    const url = `${workerUrl.replace(/\/+$/, "")}/internal/jobs/process`;
    taskName = `${parent}/tasks/job-${jobId}`;

    const [task] = await tasks.createTask({
      parent,
      task: {
        name: taskName,
        httpRequest: {
          httpMethod: "POST",
          url,
          headers: {
            "Content-Type": "application/json"
          },
          body: Buffer.from(JSON.stringify({ jobId })).toString("base64"),
          oidcToken: {
            serviceAccountEmail,
            audience: workerUrl.replace(/\/+$/, "")
          }
        }
      }
    });
    await markJobDispatchSent({ jobId, taskName: task.name ?? taskName });
    await trackEvent({ event: "cloud_task_dispatched", jobId, metadata: { taskName: task.name ?? taskName } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ALREADY_EXISTS") && taskName) {
      await markJobDispatchSent({ jobId, taskName });
      await trackEvent({ event: "cloud_task_deduplicated", jobId, metadata: { taskName } });
      return;
    }
    await markJobDispatchFailed({ jobId, errorMessage: message });
    await trackEvent({ event: "cloud_task_dispatch_failed", jobId, metadata: { message } });
    throw error;
  }
}

async function tasksClient(): Promise<CloudTasksClient> {
  if (client) return client;
  const { CloudTasksClient } = await import("@google-cloud/tasks");
  const credentials = googleCredentials();
  client = credentials ? new CloudTasksClient({ credentials }) : new CloudTasksClient();
  return client;
}

function googleCredentials(): Record<string, unknown> | null {
  const raw = env("GOOGLE_CLOUD_CREDENTIALS_JSON");
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.private_key === "string") {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

async function dispatchLocal(jobId: string): Promise<void> {
  const workerUrl = env("LOCAL_WORKER_URL") || "http://127.0.0.1:8080";
  const response = await fetch(`${workerUrl.replace(/\/+$/, "")}/internal/jobs/process`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-worker-secret": env("WORKER_SHARED_SECRET") || "dev-worker-secret"
    },
    body: JSON.stringify({ jobId })
  });
  if (!response.ok) {
    throw new Error(`Local worker dispatch failed with HTTP ${response.status}: ${await response.text()}`);
  }
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is required to dispatch Cloud Tasks.`);
  return value;
}
