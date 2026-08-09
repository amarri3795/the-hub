#!/usr/bin/env node
/**
 * Mint offline Premium license keys for The Hub.
 *
 * Usage:
 *   node scripts/generate-license-key.mjs
 *   node scripts/generate-license-key.mjs --owner
 *   node scripts/generate-license-key.mjs --count 5
 *
 * Keep this secret in sync with src/main/license.ts (LICENSE_SECRET).
 * Do not publish minted keys or the secret in public docs.
 */
import { createHmac, randomBytes } from "crypto";

// Must match src/main/license.ts LICENSE_SECRET
const LICENSE_SECRET =
  "hub-v1-hmac-7f3c9a2e1b84d6q0-amarri-local-mint-only";
const OWNER_MASTER_PAYLOAD = "AAAAAAAAAAAAAA01";

function hmacHex(payload) {
  return createHmac("sha256", LICENSE_SECRET)
    .update(payload.toUpperCase())
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function mint(payloadHex) {
  const payload = (payloadHex ?? randomBytes(8).toString("hex")).toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(payload)) {
    throw new Error("Payload must be 16 hex characters.");
  }
  return `HUB-${payload}-${hmacHex(payload)}`;
}

const args = process.argv.slice(2);
const owner = args.includes("--owner");
const countIdx = args.indexOf("--count");
const count = countIdx >= 0 ? Math.max(1, Number(args[countIdx + 1]) || 1) : 1;

if (owner) {
  const key = mint(OWNER_MASTER_PAYLOAD);
  console.log("Owner master key (also unlocked via Windows user Amarri52 / HUB_OWNER=1):");
  console.log(key);
  process.exit(0);
}

for (let i = 0; i < count; i++) {
  console.log(mint());
}
