import "dotenv/config";
import http from "node:http";
import { logError, trackEvent } from "@instamosaic/db";
import { processJob } from "./index.ts";

const port = Number(process.env.PORT || 8080);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method !== "POST" || request.url !== "/internal/jobs/process") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    if (!isAuthorized(request)) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const body = await readJson(request);
    const jobId = typeof body.jobId === "string" ? body.jobId : "";
    if (!jobId) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "jobId is required" }));
      return;
    }

    await trackEvent({ event: "worker_http_invoked", jobId });
    await processJob(jobId);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logError({
      event: "worker_http_failed",
      message,
      stack: error instanceof Error ? error.stack : undefined
    }).catch(() => {});
    response.writeHead(isRetryableError(error) ? 503 : 500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Worker failed", message }));
  }
});

server.listen(port, () => {
  console.log(JSON.stringify({ event: "worker_http_listening", port }));
});

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});

function isAuthorized(request: http.IncomingMessage): boolean {
  if (process.env.WORKER_ALLOW_UNAUTHENTICATED === "true" && process.env.NODE_ENV !== "production") return true;
  const expected = process.env.WORKER_SHARED_SECRET;
  if (expected && request.headers["x-internal-worker-secret"] === expected) return true;
  // In production, Cloud Run IAM validates the OIDC token before the request
  // reaches the container. Do not enable public unauthenticated invocation.
  return Boolean(process.env.K_SERVICE && request.headers.authorization?.startsWith("Bearer "));
}

async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|temporar|ECONN|ETIMEDOUT|rate|R2|Prisma/i.test(message);
}
