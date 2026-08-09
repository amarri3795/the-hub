import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { join, relative, resolve, sep } from "path";
import type {
  ActionResult,
  SaveFileEntry,
  SaveJsonField,
  SaveReplaceResult,
  SaveScanResult,
  SaveValueHit,
  SaveValueKind,
} from "../shared/types";
import { createBackup, getLinkedSavePath } from "./saves";

const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LIST_FILES = 400;
const MAX_DEPTH = 6;
const MAX_HITS = 80;
const MAX_JSON_FIELDS = 200;

const DEFAULT_KINDS: SaveValueKind[] = [
  "i32le",
  "u32le",
  "i64le",
  "f32le",
  "text",
];

function linkedRoot(gameId: string): ActionResult & { root?: string } {
  const savePath = getLinkedSavePath(gameId);
  if (!savePath) {
    return {
      ok: false,
      error: "Link a save folder first (Pick folder or use a guess).",
    };
  }
  if (!existsSync(savePath)) {
    return { ok: false, error: "Linked save folder is missing." };
  }
  try {
    if (!statSync(savePath).isDirectory()) {
      return { ok: false, error: "Linked save path is not a folder." };
    }
  } catch {
    return { ok: false, error: "Could not read linked save folder." };
  }
  return { ok: true, root: resolve(savePath) };
}

function isInsideRoot(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  const rootLower = r.toLowerCase();
  const candLower = c.toLowerCase();
  return (
    candLower === rootLower ||
    candLower.startsWith(rootLower + sep.toLowerCase()) ||
    candLower.startsWith(rootLower + "\\") ||
    candLower.startsWith(rootLower + "/")
  );
}

function resolveSaveFile(
  root: string,
  relativePath: string,
): ActionResult & { absolute?: string } {
  if (!relativePath || relativePath.includes("\0")) {
    return { ok: false, error: "Invalid file path." };
  }
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    normalized.split("/").some((part) => part === ".." || part === "")
  ) {
    return { ok: false, error: "Invalid file path." };
  }
  const absolute = resolve(root, ...normalized.split("/"));
  if (!isInsideRoot(root, absolute)) {
    return { ok: false, error: "File is outside the linked save folder." };
  }
  if (!existsSync(absolute)) {
    return { ok: false, error: "File not found." };
  }
  try {
    if (!statSync(absolute).isFile()) {
      return { ok: false, error: "That path is not a file." };
    }
  } catch {
    return { ok: false, error: "Could not read that file." };
  }
  return { ok: true, absolute };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function walkFiles(
  root: string,
  dir: string,
  depth: number,
  out: SaveFileEntry[],
): void {
  if (out.length >= MAX_LIST_FILES || depth > MAX_DEPTH) return;
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  names.sort((a, b) => a.localeCompare(b));
  for (const name of names) {
    if (out.length >= MAX_LIST_FILES) return;
    if (name === "." || name === "..") continue;
    const absolute = join(dir, name);
    let st;
    try {
      st = statSync(absolute);
    } catch {
      continue;
    }
    const rel = relative(root, absolute).replace(/\\/g, "/");
    if (st.isDirectory()) {
      walkFiles(root, absolute, depth + 1, out);
      continue;
    }
    if (!st.isFile()) continue;
    out.push({
      relativePath: rel,
      size: st.size,
      sizeLabel: formatBytes(st.size),
      modifiedAt: st.mtimeMs,
    });
  }
}

export function listSaveFiles(
  gameId: string,
): ActionResult & { files?: SaveFileEntry[]; truncated?: boolean } {
  const linked = linkedRoot(gameId);
  if (!linked.ok || !linked.root) return linked;
  const files: SaveFileEntry[] = [];
  walkFiles(linked.root, linked.root, 0, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return {
    ok: true,
    files,
    truncated: files.length >= MAX_LIST_FILES,
  };
}

function nearlyEqual(a: number, b: number): boolean {
  if (Object.is(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-6;
}

function encodeValue(kind: SaveValueKind, value: number): Buffer | null {
  if (!Number.isFinite(value)) return null;
  try {
    switch (kind) {
      case "i32le": {
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)
          return null;
        const buf = Buffer.alloc(4);
        buf.writeInt32LE(value, 0);
        return buf;
      }
      case "u32le": {
        if (!Number.isInteger(value) || value < 0 || value > 4294967295)
          return null;
        const buf = Buffer.alloc(4);
        buf.writeUInt32LE(value, 0);
        return buf;
      }
      case "i64le": {
        if (!Number.isInteger(value) || !Number.isSafeInteger(value)) return null;
        const buf = Buffer.alloc(8);
        buf.writeBigInt64LE(BigInt(value), 0);
        return buf;
      }
      case "f32le": {
        const buf = Buffer.alloc(4);
        buf.writeFloatLE(value, 0);
        // Reject values that can't round-trip through f32.
        if (!nearlyEqual(buf.readFloatLE(0), value)) return null;
        return buf;
      }
      case "text":
        return Buffer.from(String(value), "utf8");
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function decodeValue(
  kind: SaveValueKind,
  buf: Buffer,
  offset: number,
  matchedLength?: number,
): number | null {
  try {
    switch (kind) {
      case "i32le":
        return buf.readInt32LE(offset);
      case "u32le":
        return buf.readUInt32LE(offset);
      case "i64le": {
        const v = buf.readBigInt64LE(offset);
        if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
          return null;
        }
        return Number(v);
      }
      case "f32le":
        return buf.readFloatLE(offset);
      case "text": {
        const len = matchedLength ?? 0;
        if (len <= 0 || offset + len > buf.length) return null;
        const raw = buf.subarray(offset, offset + len).toString("utf8");
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function isDigitByte(byte: number): boolean {
  return byte >= 48 && byte <= 57;
}

/** Avoid matching 1250 inside 11250 / 12500. */
function isStandaloneTextNumber(
  buf: Buffer,
  offset: number,
  length: number,
): boolean {
  const before = offset > 0 ? buf[offset - 1]! : null;
  const after =
    offset + length < buf.length ? buf[offset + length]! : null;
  if (before != null && (isDigitByte(before) || before === 46 /* . */)) {
    return false;
  }
  if (after != null && (isDigitByte(after) || after === 46 /* . */)) {
    return false;
  }
  return true;
}

function findPattern(haystack: Buffer, needle: Buffer): number[] {
  const hits: number[] = [];
  if (needle.length === 0 || haystack.length < needle.length) return hits;
  let start = 0;
  while (start <= haystack.length - needle.length && hits.length < MAX_HITS) {
    const idx = haystack.indexOf(needle, start);
    if (idx < 0) break;
    hits.push(idx);
    start = idx + 1;
  }
  return hits;
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  if (sample.length === 0) return false;
  let weird = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) weird += 1;
  }
  return weird / sample.length < 0.05;
}

function collectJsonNumbers(
  value: unknown,
  path: string,
  out: SaveJsonField[],
): void {
  if (out.length >= MAX_JSON_FIELDS) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    out.push({ path: path || "(root)", value });
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      collectJsonNumbers(value[i], `${path}[${i}]`, out);
      if (out.length >= MAX_JSON_FIELDS) return;
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = path ? `${path}.${key}` : key;
      collectJsonNumbers(child, next, out);
      if (out.length >= MAX_JSON_FIELDS) return;
    }
  }
}

function setJsonPath(
  root: unknown,
  path: string,
  nextValue: number,
): ActionResult & { root?: unknown } {
  if (path === "(root)") {
    return { ok: true, root: nextValue };
  }
  const tokens: Array<string | number> = [];
  const re = /([^[.\]]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(path))) {
    if (match[1] != null) tokens.push(match[1]);
    else if (match[2] != null) tokens.push(Number(match[2]));
  }
  if (tokens.length === 0) {
    return { ok: false, error: "Invalid JSON field path." };
  }

  let cursor: any = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i]!;
    if (cursor == null || (typeof cursor !== "object" && !Array.isArray(cursor))) {
      return { ok: false, error: "JSON path no longer exists." };
    }
    cursor = cursor[token as any];
  }
  const last = tokens[tokens.length - 1]!;
  if (cursor == null || (typeof cursor !== "object" && !Array.isArray(cursor))) {
    return { ok: false, error: "JSON path no longer exists." };
  }
  if (!(last in cursor) && !(Array.isArray(cursor) && typeof last === "number")) {
    return { ok: false, error: "JSON field not found." };
  }
  cursor[last as any] = nextValue;
  return { ok: true, root };
}

function readSaveBuffer(
  gameId: string,
  relativePath: string,
): ActionResult & { buffer?: Buffer; absolute?: string; root?: string } {
  const linked = linkedRoot(gameId);
  if (!linked.ok || !linked.root) return linked;
  const file = resolveSaveFile(linked.root, relativePath);
  if (!file.ok || !file.absolute) return file;
  let st;
  try {
    st = statSync(file.absolute);
  } catch {
    return { ok: false, error: "Could not read that file." };
  }
  if (st.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `File is too large to edit in Hub (max ${formatBytes(MAX_FILE_BYTES)}).`,
    };
  }
  try {
    return {
      ok: true,
      buffer: readFileSync(file.absolute),
      absolute: file.absolute,
      root: linked.root,
    };
  } catch (err) {
    return { ok: false, error: `Read failed: ${String(err)}` };
  }
}

export function inspectSaveFile(
  gameId: string,
  relativePath: string,
): ActionResult & {
  kind?: "json" | "text" | "binary";
  jsonFields?: SaveJsonField[];
  textPreview?: string;
  fileSize?: number;
  truncatedJson?: boolean;
} {
  const read = readSaveBuffer(gameId, relativePath);
  if (!read.ok || !read.buffer) return read;
  const buf = read.buffer;

  if (looksLikeText(buf)) {
    const text = buf.toString("utf8");
    const trimmed = text.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(text) as unknown;
        const jsonFields: SaveJsonField[] = [];
        collectJsonNumbers(parsed, "", jsonFields);
        return {
          ok: true,
          kind: "json",
          jsonFields,
          fileSize: buf.length,
          truncatedJson: jsonFields.length >= MAX_JSON_FIELDS,
        };
      } catch {
        // fall through to plain text
      }
    }
    return {
      ok: true,
      kind: "text",
      textPreview: text.slice(0, 4000),
      fileSize: buf.length,
    };
  }

  return {
    ok: true,
    kind: "binary",
    fileSize: buf.length,
  };
}

export function scanSaveValues(
  gameId: string,
  relativePath: string,
  value: number,
  kinds: SaveValueKind[] = DEFAULT_KINDS,
): SaveScanResult {
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Enter a valid number to search for." };
  }
  const read = readSaveBuffer(gameId, relativePath);
  if (!read.ok || !read.buffer) return read;

  const buf = read.buffer;
  const hits: SaveValueHit[] = [];
  const usedKinds = kinds.length > 0 ? kinds : DEFAULT_KINDS;

  for (const kind of usedKinds) {
    const needle = encodeValue(kind, value);
    if (!needle) continue;
    for (const offset of findPattern(buf, needle)) {
      if (kind === "text" && !isStandaloneTextNumber(buf, offset, needle.length)) {
        continue;
      }
      const decoded = decodeValue(kind, buf, offset, needle.length);
      if (decoded == null) continue;
      hits.push({
        offset,
        kind,
        value: decoded,
        label: `0x${offset.toString(16).toUpperCase()} · ${kind}`,
      });
      if (hits.length >= MAX_HITS) break;
    }
    if (hits.length >= MAX_HITS) break;
  }

  hits.sort((a, b) => a.offset - b.offset || a.kind.localeCompare(b.kind));

  return {
    ok: true,
    hits,
    fileSize: buf.length,
    truncated: hits.length >= MAX_HITS,
    message:
      hits.length === 0
        ? "No matching values found. Try the amount shown in-game, or another encoding."
        : `Found ${hits.length} match${hits.length === 1 ? "" : "es"}.`,
  };
}

export function replaceSaveValues(
  gameId: string,
  relativePath: string,
  replacements: Array<{
    offset: number;
    kind: SaveValueKind;
    oldValue: number;
    newValue: number;
  }>,
): SaveReplaceResult {
  if (!replacements.length) {
    return { ok: false, error: "Select at least one value to replace." };
  }
  for (const item of replacements) {
    if (!Number.isFinite(item.newValue) || !Number.isFinite(item.oldValue)) {
      return { ok: false, error: "Enter a valid replacement number." };
    }
    if (!Number.isInteger(item.offset) || item.offset < 0) {
      return { ok: false, error: "Invalid offset." };
    }
  }

  const read = readSaveBuffer(gameId, relativePath);
  if (!read.ok || !read.buffer || !read.absolute) return read;

  // Apply from the end so text splice length changes don't shift earlier offsets.
  const ordered = [...replacements].sort((a, b) => b.offset - a.offset);
  let buf = Buffer.from(read.buffer);
  let replaced = 0;

  for (const item of ordered) {
    const encoded = encodeValue(item.kind, item.newValue);
    const oldEncoded = encodeValue(item.kind, item.oldValue);
    if (!encoded || !oldEncoded) {
      return {
        ok: false,
        error: `Value ${item.newValue} does not fit encoding ${item.kind}.`,
      };
    }
    if (item.offset + oldEncoded.length > buf.length) {
      return { ok: false, error: "Replacement is outside the file." };
    }
    if (!buf.subarray(item.offset, item.offset + oldEncoded.length).equals(oldEncoded)) {
      return {
        ok: false,
        error:
          "File changed since the search (or match no longer present). Search again.",
      };
    }
    if (item.kind === "text") {
      buf = Buffer.concat([
        buf.subarray(0, item.offset),
        encoded,
        buf.subarray(item.offset + oldEncoded.length),
      ]);
      replaced += 1;
      continue;
    }
    encoded.copy(buf, item.offset);
    replaced += 1;
  }

  const backup = createBackup(gameId);
  if (!backup.ok) {
    return {
      ok: false,
      error: `Could not create a safety backup before editing: ${backup.error}`,
    };
  }

  try {
    writeFileSync(read.absolute, buf);
  } catch (err) {
    return { ok: false, error: `Write failed: ${String(err)}` };
  }

  return {
    ok: true,
    replaced,
    message: `Updated ${replaced} value${replaced === 1 ? "" : "s"} (backup created first).`,
  };
}

export function replaceSaveJsonField(
  gameId: string,
  relativePath: string,
  fieldPath: string,
  newValue: number,
): SaveReplaceResult {
  if (!Number.isFinite(newValue)) {
    return { ok: false, error: "Enter a valid replacement number." };
  }
  const read = readSaveBuffer(gameId, relativePath);
  if (!read.ok || !read.buffer || !read.absolute) return read;
  if (!looksLikeText(read.buffer)) {
    return { ok: false, error: "This file is not editable as JSON text." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.buffer.toString("utf8"));
  } catch {
    return { ok: false, error: "Could not parse JSON." };
  }

  const updated = setJsonPath(parsed, fieldPath, newValue);
  if (!updated.ok) return updated;

  const backup = createBackup(gameId);
  if (!backup.ok) {
    return {
      ok: false,
      error: `Could not create a safety backup before editing: ${backup.error}`,
    };
  }

  const originalText = read.buffer.toString("utf8");
  const compact = !/\r?\n/.test(originalText.trim());
  const serialized = compact
    ? JSON.stringify(updated.root)
    : `${JSON.stringify(updated.root, null, 2)}${
        originalText.endsWith("\n") ? "\n" : ""
      }`;

  try {
    writeFileSync(read.absolute, serialized, "utf8");
  } catch (err) {
    return { ok: false, error: `Write failed: ${String(err)}` };
  }

  return {
    ok: true,
    replaced: 1,
    message: `Updated ${fieldPath} (backup created first).`,
  };
}
