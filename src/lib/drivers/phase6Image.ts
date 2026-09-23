import sharp from "sharp";
import { createHash } from "node:crypto";

export async function preparePhase6Image(input: Uint8Array) {
  if (!input.byteLength || input.byteLength > 8 * 1024 * 1024) throw new Error("Choose an image under 8 MB.");
  const decoder = sharp(input, { limitInputPixels: 24000000, failOn: "warning", animated: false });
  const metadata = await decoder.metadata();
  if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height || metadata.width < 320 || metadata.height < 240) throw new Error("Choose a clear JPEG, PNG or WebP image.");
  // Decode the complete capture, apply orientation, and omit EXIF/GPS metadata.
  const result = await decoder.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
  return { buffer: result.data, mime: "image/jpeg", bytes: result.data.byteLength, width: result.info.width, height: result.info.height, digest: createHash("sha256").update(result.data).digest("hex") };
}
