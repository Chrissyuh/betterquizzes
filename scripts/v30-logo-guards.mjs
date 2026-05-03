#!/usr/bin/env node
import fs from "node:fs";

const failures = [];

function assert(value, message) {
  if (!value) failures.push(message);
}

function isPng(file) {
  const bytes = fs.readFileSync(file);
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function size(file) {
  const bytes = fs.readFileSync(file);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

for (const file of [
  "public/brand/betterquizzes-logo-light.png",
  "public/brand/betterquizzes-logo-dark.png",
  "public/logo-light.png",
  "public/logo-dark.png",
  "public/favicon.png"
]) {
  assert(fs.existsSync(file), file + " is missing");
  assert(isPng(file), file + " is not a PNG");
  const dimensions = size(file);
  assert(dimensions.width === 512 && dimensions.height === 512, file + " must be 512x512");
}

console.log("V30 logo guards passed.");
