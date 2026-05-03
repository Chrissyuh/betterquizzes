#!/usr/bin/env node
import fs from "node:fs";
import zlib from "node:zlib";

const failures = [];

function assert(value, message) {
  if (!value) failures.push(message);
}

function decode(file) {
  const bytes = fs.readFileSync(file);
  assert(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47, file + " is not PNG");

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  let offset = 8;
  const idat = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") idat.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }

  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const rgba = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    const sourceRow = y * (width * 4 + 1);
    const filter = inflated[sourceRow];
    assert(filter === 0, file + " uses unexpected PNG filter " + filter);
    inflated.copy(rgba, y * width * 4, sourceRow + 1, sourceRow + 1 + width * 4);
  }

  return { width, height, rgba };
}

function alphaAt(image, x, y) {
  return image.rgba[(y * image.width + x) * 4 + 3];
}

for (const file of [
  "public/app-icon.png",
  "public/app-icon-dark.png",
  "public/brand/betterquizzes-logo-light.png",
  "public/brand/betterquizzes-logo-dark.png",
  "public/logo-light.png",
  "public/logo-dark.png",
  "public/favicon.png"
]) {
  assert(fs.existsSync(file), file + " is missing");
  const image = decode(file);
  assert(image.width === 512 && image.height === 512, file + " must be 512x512");
  assert(alphaAt(image, 0, 0) === 255, file + " top-left corner is transparent");
  assert(alphaAt(image, 511, 0) === 255, file + " top-right corner is transparent");
  assert(alphaAt(image, 0, 511) === 255, file + " bottom-left corner is transparent");
  assert(alphaAt(image, 511, 511) === 255, file + " bottom-right corner is transparent");
}

if (failures.length) {
  console.error("V33 logo color guards failed:");
  for (const failure of failures) console.error(" - " + failure);
  process.exit(1);
}

console.log("V33 logo color guards passed.");
