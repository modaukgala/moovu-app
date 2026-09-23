import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Node's strip-types runner requires an explicit TypeScript extension.
import { preparePhase6Image } from "./phase6Image.ts";

test("image validation rejects disguised text, corrupt content and excessive input", async () => {
  await assert.rejects(preparePhase6Image(new TextEncoder().encode("not a jpeg")));
  await assert.rejects(preparePhase6Image(new Uint8Array(8388609)));
  const valid = await sharp({ create: { width: 640, height: 480, channels: 3, background: "white" } }).jpeg().toBuffer();
  await assert.rejects(preparePhase6Image(valid.subarray(0, 40)));
});
test("image pipeline decodes content, bounds output and removes embedded metadata", async () => {
  const input = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "white" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const prepared = await preparePhase6Image(input);
  const metadata = await sharp(prepared.buffer).metadata();
  assert.equal(prepared.mime, "image/jpeg");
  assert.equal(prepared.bytes, prepared.buffer.byteLength);
  assert.ok(prepared.width <= 2400 && prepared.height <= 2400);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.match(prepared.digest, /^[a-f0-9]{64}$/);
});
test("thumbnail-sized content cannot satisfy evidence requirements", async () => {
  const tiny = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(preparePhase6Image(tiny));
});
