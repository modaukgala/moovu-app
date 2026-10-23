import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const input = process.argv[2];
if (!input) throw new Error("Provide the original transparent sedan render path.");
const output = path.resolve("public/loading/moovu-premium-sedan.webp");
await mkdir(path.dirname(output), { recursive: true });
const source = await sharp(input).metadata();
if (!source.hasAlpha) throw new Error("The render must have a real alpha channel.");
await sharp(input)
  .trim()
  .resize(1200, 520, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .extend({ top: 30, bottom: 30, left: 60, right: 60, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .webp({ quality: 88, alphaQuality: 100, effort: 6 })
  .toFile(output);
const metadata = await sharp(output).metadata();
const statistics = await sharp(output).stats();
if (statistics.isOpaque) throw new Error("The optimized asset lost transparency.");
console.log(JSON.stringify({ output, width: metadata.width, height: metadata.height, bytes: (await stat(output)).size,
  hasAlpha: metadata.hasAlpha, isOpaque: statistics.isOpaque }));
