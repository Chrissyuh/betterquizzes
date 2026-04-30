#!/usr/bin/env node
process.env.TRIAL_BASE_URL = process.env.PUBLIC_BASE_URL || process.env.PUBLIC_ORIGIN || "";
if (!process.env.TRIAL_BASE_URL) {
  const strict = process.argv.includes("--strict") || process.env.STAGE9_REQUIRE_PUBLIC === "1";
  const message = "PUBLIC_BASE_URL/PUBLIC_ORIGIN not set; skipping public HTTPS host smoke test. Set PUBLIC_BASE_URL=https://your-domain.example and run npm run host:public:strict to test a real host.";
  if (strict) {
    console.error(message);
    process.exit(1);
  }
  console.log(message);
  process.exit(0);
}
const args = process.argv.includes("--strict") ? ["--strict-https"] : [];
await import("./trial-probe.mjs");
