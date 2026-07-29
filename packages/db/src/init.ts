import { initDb } from "./index.ts";

await initDb();
console.log("Prisma Postgres connection initialized.");
