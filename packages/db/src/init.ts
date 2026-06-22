import { dbPath, initDb } from "./index.ts";

initDb();
console.log(`SQLite database initialized at ${dbPath()}`);
