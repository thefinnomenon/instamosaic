import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appDirectory = path.dirname(fileURLToPath(import.meta.url));
const cloudTasksRuntimeFiles = [
  "../node_modules/@google-cloud/tasks/build/protos/**/*",
  "../node_modules/@google-cloud/tasks/build/esm/src/**/*.json",
  "../node_modules/@google-cloud/tasks/build/cjs/src/**/*.json",
  "../node_modules/google-gax/build/protos/**/*"
];

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.resolve(appDirectory, ".."),
  outputFileTracingIncludes: {
    "/api/jobs": cloudTasksRuntimeFiles,
    "/api/admin/marketing/batch": cloudTasksRuntimeFiles
  },
  serverExternalPackages: ["@google-cloud/tasks"],
  transpilePackages: ["@instamosaic/db", "@instamosaic/mosaic", "@instamosaic/storage", "@instamosaic/worker"]
};

export default nextConfig;
