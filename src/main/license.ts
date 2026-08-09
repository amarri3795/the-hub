import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { userInfo } from "os";
import type { ActionResult, PremiumStatus } from "../shared/types";
import { readPrefs, writePremiumUnlock } from "./prefs";

/**
 * Offline HMAC licensing (honesty-based for a desktop app).
 * Secret must stay in main process / the local key generator — not the renderer.
 * Owner master payload is minted with: node scripts/generate-license-key.mjs --owner
 */
const LICENSE_SECRET =
  "hub-v1-hmac-7f3c9a2e1b84d6q0-amarri-local-mint-only";

/** Special 16-hex payload for the owner master key (still must carry a valid HMAC). */
const OWNER_MASTER_PAYLOAD = "AAAAAAAAAAAAAA01";

const DEFAULT_ACCENT = "#3d8bfd";

export { DEFAULT_ACCENT };

function hmacHex(payload: string): string {
  return createHmac("sha256", LICENSE_SECRET)
    .update(payload.toUpperCase())
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

export function normalizeLicenseKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Format: HUB-<16 hex payload>-<16 hex hmac> */
export function parseLicenseKey(
  raw: string,
): { payload: string; sig: string } | null {
  const key = normalizeLicenseKey(raw);
  const m = /^HUB-([0-9A-F]{16})-([0-9A-F]{16})$/.exec(key);
  if (!m) return null;
  return { payload: m[1], sig: m[2] };
}

export function verifyLicenseKey(raw: string): boolean {
  const parsed = parseLicenseKey(raw);
  if (!parsed) return false;
  const expected = hmacHex(parsed.payload);
  try {
    return timingSafeEqual(
      Buffer.from(parsed.sig, "utf8"),
      Buffer.from(expected, "utf8"),
    );
  } catch {
    return false;
  }
}

export function mintLicenseKey(payloadHex?: string): string {
  const payload = (payloadHex ?? randomBytes(8).toString("hex")).toUpperCase();
  if (!/^[0-9A-F]{16}$/.test(payload)) {
    throw new Error("Payload must be 16 hex characters.");
  }
  return `HUB-${payload}-${hmacHex(payload)}`;
}

export function mintOwnerMasterKey(): string {
  return mintLicenseKey(OWNER_MASTER_PAYLOAD);
}

export function isOwnerMachine(): boolean {
  if (process.env.HUB_OWNER === "1") return true;
  try {
    return userInfo().username.toLowerCase() === "amarri52";
  } catch {
    return false;
  }
}

export function getPremiumStatus(): PremiumStatus {
  if (isOwnerMachine()) {
    return {
      unlocked: true,
      source: "owner",
      message: "Premium unlocked (owner)",
    };
  }

  const prefs = readPrefs();
  if (prefs.premiumUnlocked && prefs.premiumKey) {
    if (verifyLicenseKey(prefs.premiumKey)) {
      const parsed = parseLicenseKey(prefs.premiumKey);
      return {
        unlocked: true,
        source: "license",
        keyPreview: parsed ? parsed.payload.slice(-4) : undefined,
        unlockedAt: prefs.premiumUnlockedAt,
        message: "Premium unlocked",
      };
    }
    // Stored key no longer valid — clear quietly.
    writePremiumUnlock(null);
  }

  return {
    unlocked: false,
    source: "none",
    message: "Free tier",
  };
}

export function isPremiumUnlocked(): boolean {
  return getPremiumStatus().unlocked;
}

export function activateLicense(rawKey: string): ActionResult & {
  status: PremiumStatus;
} {
  const key = normalizeLicenseKey(rawKey);
  if (!verifyLicenseKey(key)) {
    return {
      ok: false,
      error: "Invalid license key.",
      status: getPremiumStatus(),
    };
  }
  writePremiumUnlock({
    premiumKey: key,
    premiumUnlocked: true,
    premiumUnlockedAt: Date.now(),
  });
  return {
    ok: true,
    message: "Premium activated.",
    status: getPremiumStatus(),
  };
}

export function deactivateLicense(): ActionResult & { status: PremiumStatus } {
  writePremiumUnlock(null);
  return {
    ok: true,
    message: isOwnerMachine()
      ? "License cleared (owner Premium remains)."
      : "Premium deactivated.",
    status: getPremiumStatus(),
  };
}

export function premiumDenied(feature: string): ActionResult {
  return {
    ok: false,
    error: `${feature} is a Premium feature. Enter a license key in Settings.`,
  };
}

export function isDefaultAccent(color: string): boolean {
  return color.trim().toLowerCase() === DEFAULT_ACCENT;
}
