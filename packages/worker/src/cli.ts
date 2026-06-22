import "dotenv/config";
import { runWorkerLoop } from "./index.ts";

const once = process.argv.includes("--once");
const pollIndex = process.argv.indexOf("--poll-ms");
const pollMs = pollIndex >= 0 ? Number.parseInt(process.argv[pollIndex + 1] || "", 10) : undefined;

runWorkerLoop({ once, pollMs: Number.isFinite(pollMs) ? pollMs : undefined }).catch((error) => {
  console.error(error);
  process.exit(1);
});
