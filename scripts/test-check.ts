import "dotenv/config";
import { checkInstagramProfile, sanitizeInstagramUsername } from "@instamosaic/worker";

const username = process.argv[2];
if (!username) {
  console.error("Usage: npm run test:check -- username");
  process.exit(1);
}

const checked = await checkInstagramProfile(sanitizeInstagramUsername(username));

console.log(`username: ${checked.username}`);
console.log(`exists: ${checked.exists}`);
console.log(`public: ${checked.is_public}`);
console.log(`estimated_photo_count: ${checked.estimated_photo_count}`);
if (checked.warnings.length) console.log(`warnings: ${checked.warnings.join("; ")}`);
if (checked.errors.length) console.log(`errors: ${checked.errors.join("; ")}`);
