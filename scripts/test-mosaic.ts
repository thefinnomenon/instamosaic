import "dotenv/config";
import path from "node:path";
import { generateMosaic, mosaicOptionsFromEnv } from "@instamosaic/mosaic";

const heroPath = process.argv[2];
const tilesDir = process.argv[3];
if (!heroPath || !tilesDir) {
  console.error("Usage: npm run test:mosaic -- hero.jpg tiles/");
  process.exit(1);
}

const outputDir = path.resolve("tmp", "test", "output");
const options = mosaicOptionsFromEnv();
const started = Date.now();

console.log("parameters:");
console.log(`master: ${options.masterWidth}x${options.masterHeight}`);
console.log(`grid: ${options.columns}x${options.rows}`);
console.log(`tile_size: ${options.tileSize}`);
console.log(`hero_blend_opacity: ${options.heroBlendOpacity}`);
console.log(`output: ${outputDir}`);

const result = await generateMosaic({
  heroPath: path.resolve(heroPath),
  tilesDir: path.resolve(tilesDir),
  outputDir,
  onProgress(stage, progress) {
    console.log(`${Math.round(progress * 100)}% ${stage}`);
  }
});

console.log(`processing_time_seconds: ${((Date.now() - started) / 1000).toFixed(2)}`);
console.log(`tile_count: ${result.tileCount}`);
console.log(`cells: ${result.cells}`);
for (const output of Object.values(result.outputs)) {
  console.log(`${output.type}: ${output.path}`);
}
if (result.warnings.length) console.log(`warnings: ${result.warnings.join("; ")}`);
