import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, extname, join, relative } from "path";
import { randomUUID } from "crypto";
import { app, dialog, shell } from "electron";
import AdmZip from "adm-zip";
import type { ActionResult, FiveMConvertResult } from "../shared/types";

export type { FiveMConvertResult };

type MetaKind =
  | "vehicles"
  | "handling"
  | "carcols"
  | "carvariations"
  | "vehiclelayouts"
  | "dlctext";

type MetaSpec = {
  kind: MetaKind;
  fileName: string;
  fileType: string;
  destInDlc: string;
};

const META_SPECS: MetaSpec[] = [
  {
    kind: "vehicles",
    fileName: "vehicles.meta",
    fileType: "VEHICLE_METADATA_FILE",
    destInDlc: "common\\data\\levels\\gta5\\vehicles.meta",
  },
  {
    kind: "handling",
    fileName: "handling.meta",
    fileType: "HANDLING_FILE",
    destInDlc: "common\\data\\handling.meta",
  },
  {
    kind: "carcols",
    fileName: "carcols.meta",
    fileType: "CARCOLS_FILE",
    destInDlc: "common\\data\\carcols.meta",
  },
  {
    kind: "carvariations",
    fileName: "carvariations.meta",
    fileType: "VEHICLE_VARIATION_FILE",
    destInDlc: "common\\data\\carvariations.meta",
  },
  {
    kind: "vehiclelayouts",
    fileName: "vehiclelayouts.meta",
    fileType: "VEHICLE_LAYOUTS_FILE",
    destInDlc: "common\\data\\vehiclelayouts.meta",
  },
  {
    kind: "dlctext",
    fileName: "dlctext.meta",
    fileType: "TEXTFILE_METAFILE",
    destInDlc: "common\\data\\dlctext.meta",
  },
];

const STREAM_EXTS = new Set([
  ".yft",
  ".ytd",
  ".ycd",
  ".ydr",
  ".ypt",
  ".ymt",
  ".xml",
]);

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function listFilesRecursive(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "." || name === "..") continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else if (st.isFile()) out.push(full);
    }
  };
  walk(root);
  return out;
}

function findDirNamed(root: string, wanted: string): string | null {
  const target = wanted.toLowerCase();
  if (basename(root).toLowerCase() === target) return root;
  const queue = [root];
  while (queue.length) {
    const dir = queue.shift()!;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = join(dir, name);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
      if (name.toLowerCase() === target) return full;
      // Keep search shallow-ish for nested fxmanifest layouts.
      const depth =
        relative(root, full).split(/[/\\]/).filter(Boolean).length;
      if (depth < 4) queue.push(full);
    }
  }
  return null;
}

function sanitizePackName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]+/g, "");
  if (cleaned) return cleaned.slice(0, 48);
  return `veh${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseSpawnName(vehiclesMetaXml: string): string | null {
  const model =
    /<modelName>\s*([^<\s]+)\s*<\/modelName>/i.exec(vehiclesMetaXml)?.[1] ??
    null;
  if (model) return model.trim();
  const txd =
    /<txdName>\s*([^<\s]+)\s*<\/txdName>/i.exec(vehiclesMetaXml)?.[1] ?? null;
  return txd ? txd.trim() : null;
}

function findVehiclesMeta(root: string): string | null {
  const files = listFilesRecursive(root);
  const hit = files.find(
    (f) => basename(f).toLowerCase() === "vehicles.meta",
  );
  return hit ?? null;
}

function resolveVehicleRoot(extractedOrFolder: string): {
  root: string;
  dataDir: string;
  streamDir: string;
} | null {
  const dataDir = findDirNamed(extractedOrFolder, "data");
  const streamDir = findDirNamed(extractedOrFolder, "stream");
  if (dataDir && streamDir) {
    return {
      root: dirname(dataDir),
      dataDir,
      streamDir,
    };
  }
  // Packs with stream/ but metas beside it (no data/ folder).
  if (streamDir) {
    const packRoot = dirname(streamDir);
    const siblingData = join(packRoot, "data");
    if (existsSync(siblingData)) {
      return { root: packRoot, dataDir: siblingData, streamDir };
    }
    const vehiclesMeta = findVehiclesMeta(packRoot);
    if (vehiclesMeta) {
      const metaParent = dirname(vehiclesMeta);
      if (metaParent.toLowerCase() !== streamDir.toLowerCase()) {
        return { root: packRoot, dataDir: metaParent, streamDir };
      }
    }
  }
  return null;
}

/** Detect webpage-saved-as-.zip and other non-zip files before AdmZip throws. */
function inspectZipCandidate(zipPath: string): string | null {
  let fd: number | null = null;
  try {
    const st = statSync(zipPath);
    if (!st.isFile() || st.size < 22) {
      return "That file is empty or too small to be a FiveM vehicle zip.";
    }
    fd = openSync(zipPath, "r");
    const buf = Buffer.alloc(Math.min(64, st.size));
    readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString("utf8");
    const lower = head.toLowerCase();
    if (
      lower.includes("<!doctype html") ||
      lower.includes("<html") ||
      lower.startsWith("<!doctype")
    ) {
      return "That .zip is actually a webpage (HTML), not the car files. Re-download the FiveM resource, or use Convert from folder on the unpacked pack (needs data/ + stream/).";
    }
    const sig = buf.readUInt32LE(0);
    const isZip =
      sig === 0x04034b50 || // PK\x03\x04
      sig === 0x06054b50 || // empty
      sig === 0x08074b50;
    if (!isZip) {
      if (head.startsWith("Rar!") || (buf[0] === 0x52 && buf[1] === 0x61)) {
        return "That file looks like a .rar, not a .zip. Extract it first, then use Convert from folder on the folder that has data/ + stream/.";
      }
      if (buf[0] === 0x37 && buf[1] === 0x7a) {
        return "That file looks like a .7z archive. Extract it first, then use Convert from folder on the folder that has data/ + stream/.";
      }
      return "That file is not a valid .zip. Use the real FiveM vehicle pack zip, or Convert from folder (data/ + stream/).";
    }
    return null;
  } catch {
    return "Could not read that zip file.";
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function explainZipExtractError(err: unknown): string {
  const msg = String(err);
  if (/invalid or unsupported zip|no end header|invalid signature/i.test(msg)) {
    return "That .zip is corrupt or not a real zip (browsers sometimes save a download page as .zip). Use the actual FiveM vehicle files, or Convert from folder.";
  }
  return msg.replace(/^Error:\s*/, "");
}

function collectMetas(dataDir: string): Array<MetaSpec & { absPath: string }> {
  const found: Array<MetaSpec & { absPath: string }> = [];
  const files = listFilesRecursive(dataDir);
  for (const spec of META_SPECS) {
    const match = files.find(
      (f) => basename(f).toLowerCase() === spec.fileName.toLowerCase(),
    );
    if (match) found.push({ ...spec, absPath: match });
  }
  return found;
}

function collectStreamFiles(streamDir: string): string[] {
  return listFilesRecursive(streamDir).filter((f) =>
    STREAM_EXTS.has(extname(f).toLowerCase()),
  );
}

function buildSetup2Xml(packName: string): string {
  const stamp = new Date().toLocaleString("en-US", { hour12: false });
  return `<?xml version="1.0" encoding="UTF-8"?>
<SSetupData>
  <deviceName>dlc_${escapeXml(packName)}</deviceName>
  <datFile>content.xml</datFile>
  <timeStamp>${escapeXml(stamp)}</timeStamp>
  <nameHash>${escapeXml(packName)}</nameHash>
  <contentChangeSetGroups>
    <Item>
      <NameHash>GROUP_STARTUP</NameHash>
      <ContentChangeSets>
        <Item>${escapeXml(packName)}_AUTOGEN</Item>
      </ContentChangeSets>
    </Item>
  </contentChangeSetGroups>
  <startupScript />
  <scriptCallstackSize value="0" />
  <type>EXTRACONTENT_COMPAT_PACK</type>
  <order value="25" />
  <minorOrder value="0" />
  <isLevelPack value="false" />
  <dependencyPackHash />
  <requiredVersion />
  <subPackCount value="0" />
</SSetupData>
`;
}

function buildContentXml(
  packName: string,
  metas: MetaSpec[],
  vehiclesRpfRel: string,
): string {
  const device = `dlc_${packName}`;
  const dataItems = metas
    .map(
      (m) => `    <Item>
      <filename>${device}:/${m.destInDlc.replace(/\\/g, "/")}</filename>
      <fileType>${m.fileType}</fileType>
      <overlay value="false" />
      <disabled value="true" />
      <persistent value="false" />
    </Item>`,
    )
    .join("\n");

  const rpfItem = `    <Item>
      <filename>${device}:/%PLATFORM%/${vehiclesRpfRel.replace(/\\/g, "/")}</filename>
      <fileType>RPF_FILE</fileType>
      <overlay value="false" />
      <disabled value="true" />
      <persistent value="true" />
    </Item>`;

  const enableMetas = metas
    .map(
      (m) =>
        `        <Item>${device}:/${m.destInDlc.replace(/\\/g, "/")}</Item>`,
    )
    .join("\n");
  const enableRpf = `        <Item>${device}:/%PLATFORM%/${vehiclesRpfRel.replace(/\\/g, "/")}</Item>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<CDataFileMgr__ContentsOfDataFileXml>
  <disabledFiles />
  <includedXmlFiles />
  <includedDataFiles />
  <dataFiles>
${dataItems}
${rpfItem}
  </dataFiles>
  <contentChangeSets>
    <Item>
      <changeSetName>${escapeXml(packName)}_AUTOGEN</changeSetName>
      <filesToDisable />
      <filesToEnable>
${enableMetas}
${enableRpf}
      </filesToEnable>
      <txdToLoad />
      <txdToUnload />
      <residentResources />
      <unregisterResources />
    </Item>
  </contentChangeSets>
  <patchFiles />
</CDataFileMgr__ContentsOfDataFileXml>
`;
}

function buildAssemblyXml(opts: {
  packName: string;
  spawnName: string;
  displayName: string;
  metaAdds: Array<{ source: string; dest: string }>;
  streamAdds: Array<{ source: string; dest: string }>;
  vehiclesRpfRel: string;
}): string {
  const guid = `{${randomUUID().toUpperCase()}}`;
  const metaLines = opts.metaAdds
    .map(
      (m) =>
        `      <add source="${escapeXml(m.source)}">${escapeXml(m.dest)}</add>`,
    )
    .join("\n");
  const streamLines = opts.streamAdds
    .map(
      (s) =>
        `        <add source="${escapeXml(s.source)}">${escapeXml(s.dest)}</add>`,
    )
    .join("\n");

  const description = `Converted from FiveM for GTA V Story Mode by The Hub.

Spawn name: ${opts.spawnName}
Pack: ${opts.packName}

Install with OpenIV → Tools → Package Installer
Install into your GTA V "mods" folder.

Then spawn with: ${opts.spawnName}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="2.2" id="${guid}" target="Five">
  <metadata>
    <name>${escapeXml(opts.displayName)}</name>
    <version>
      <major>1</major>
      <minor>0</minor>
    </version>
    <author>
      <displayName>The Hub</displayName>
    </author>
    <description>
      <![CDATA[${description}]]>
    </description>
  </metadata>
  <colors>
    <headerBackground useBlackTextColor="False">$FF1B2430</headerBackground>
    <iconBackground>$FF3D8BFD</iconBackground>
  </colors>
  <content>
    <archive path="update\\x64\\dlcpacks\\${escapeXml(opts.packName)}\\dlc.rpf" createIfNotExist="True" type="RPF7">
      <add source="setup2.xml">setup2.xml</add>
      <add source="content.xml">content.xml</add>
${metaLines}
      <archive path="${escapeXml(opts.vehiclesRpfRel)}" createIfNotExist="True" type="RPF7">
${streamLines}
      </archive>
    </archive>
    <archive path="update\\update.rpf" createIfNotExist="False" type="RPF7">
      <xml path="common\\data\\dlclist.xml">
        <add xpath="/SMandatoryPacksData/Paths" append="Last">
          <Item>dlcpacks:/${escapeXml(opts.packName)}/</Item>
        </add>
      </xml>
    </archive>
  </content>
</package>
`;
}

function extractZipToTemp(zipPath: string): string {
  const bad = inspectZipCandidate(zipPath);
  if (bad) throw new Error(bad);
  const dest = mkdtempSync(join(tmpdir(), "hub-fivem-"));
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(dest, true);
  } catch (err) {
    rmSync(dest, { recursive: true, force: true });
    throw new Error(explainZipExtractError(err));
  }
  return dest;
}

function stageAndBuildOiv(
  vehicleRoot: { root: string; dataDir: string; streamDir: string },
  outputPath: string,
): FiveMConvertResult {
  const metas = collectMetas(vehicleRoot.dataDir);
  if (!metas.some((m) => m.kind === "vehicles")) {
    return {
      ok: false,
      error: "No vehicles.meta found in data/. This doesn't look like a FiveM vehicle pack.",
    };
  }
  const vehiclesMeta = readFileSync(
    metas.find((m) => m.kind === "vehicles")!.absPath,
    "utf8",
  );
  const spawnName = parseSpawnName(vehiclesMeta);
  if (!spawnName) {
    return {
      ok: false,
      error: "Could not read <modelName> from vehicles.meta.",
    };
  }

  const streamFiles = collectStreamFiles(vehicleRoot.streamDir);
  if (streamFiles.length === 0) {
    return {
      ok: false,
      error: "No stream models found (.yft/.ytd/…).",
    };
  }

  const packName = sanitizePackName(spawnName);
  const vehiclesRpfRel = `x64\\levels\\gta5\\vehicles\\${packName}_vehicles.rpf`;
  const displayName = `${spawnName} (FiveM → Story Mode)`;

  const stage = mkdtempSync(join(tmpdir(), "hub-oiv-"));
  const contentDir = join(stage, "content");
  const dataOut = join(contentDir, "data");
  const streamOut = join(contentDir, "stream");
  ensureDir(dataOut);
  ensureDir(streamOut);

  try {
    const metaAdds: Array<{ source: string; dest: string }> = [];
    for (const meta of metas) {
      const relSource = `data\\${meta.fileName}`;
      copyFileSync(meta.absPath, join(dataOut, meta.fileName));
      metaAdds.push({ source: relSource, dest: meta.destInDlc });
    }

    const streamAdds: Array<{ source: string; dest: string }> = [];
    for (const file of streamFiles) {
      const name = basename(file);
      copyFileSync(file, join(streamOut, name));
      streamAdds.push({ source: `stream\\${name}`, dest: name });
    }

    writeFileSync(join(contentDir, "setup2.xml"), buildSetup2Xml(packName), "utf8");
    writeFileSync(
      join(contentDir, "content.xml"),
      buildContentXml(
        packName,
        metas.map(({ kind, fileName, fileType, destInDlc }) => ({
          kind,
          fileName,
          fileType,
          destInDlc,
        })),
        vehiclesRpfRel,
      ),
      "utf8",
    );
    writeFileSync(
      join(stage, "assembly.xml"),
      buildAssemblyXml({
        packName,
        spawnName,
        displayName,
        metaAdds,
        streamAdds,
        vehiclesRpfRel,
      }),
      "utf8",
    );

    ensureDir(dirname(outputPath));
    if (existsSync(outputPath)) rmSync(outputPath, { force: true });

    const zip = new AdmZip();
    zip.addLocalFile(join(stage, "assembly.xml"), "", "assembly.xml");
    // Add entire content/ tree with paths relative to archive root.
    const contentFiles = listFilesRecursive(contentDir);
    for (const file of contentFiles) {
      const rel = relative(contentDir, file).replace(/\\/g, "/");
      const entryPath = `content/${rel}`;
      const parts = entryPath.split("/");
      const fileName = parts.pop()!;
      const entryDir = parts.join("/");
      zip.addLocalFile(file, entryDir, fileName);
    }
    zip.writeZip(outputPath);

    return {
      ok: true,
      spawnName,
      packName,
      outputPath,
      metaFiles: metas.map((m) => m.fileName),
      streamFiles: streamFiles.map((f) => basename(f)),
      message: `Created ${basename(outputPath)}. Spawn name: ${spawnName}. Install with OpenIV → Tools → Package Installer (mods folder).`,
    };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export async function pickFiveMVehicleSource(
  kind: "zip" | "folder" = "zip",
): Promise<ActionResult & { path?: string; kind?: "zip" | "folder" }> {
  // Windows cannot combine openFile + openDirectory in one dialog.
  if (kind === "folder") {
    const result = await dialog.showOpenDialog({
      title: "Select a FiveM vehicle folder (contains data/ and stream/)",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, error: "Cancelled." };
    }
    return { ok: true, path: result.filePaths[0], kind: "folder" };
  }

  const result = await dialog.showOpenDialog({
    title: "Select a FiveM vehicle .zip",
    properties: ["openFile"],
    filters: [
      { name: "FiveM vehicle zip", extensions: ["zip"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: false, error: "Cancelled." };
  }
  const path = result.filePaths[0];
  if (extname(path).toLowerCase() !== ".zip") {
    return { ok: false, error: "Please pick a .zip file (or use Pick folder)." };
  }
  return { ok: true, path, kind: "zip" };
}

export function convertFiveMSourceToOiv(
  sourcePath: string,
  kind: "zip" | "folder",
  outputPath: string,
): FiveMConvertResult {
  let workRoot = sourcePath;
  let tempExtract: string | null = null;
  try {
    if (kind === "zip") {
      tempExtract = extractZipToTemp(sourcePath);
      workRoot = tempExtract;
    } else {
      try {
        if (!statSync(sourcePath).isDirectory()) {
          return { ok: false, error: "Folder path is not a directory." };
        }
      } catch {
        return { ok: false, error: "Could not read that folder." };
      }
    }

    const vehicle = resolveVehicleRoot(workRoot);
    if (!vehicle) {
      return {
        ok: false,
        error:
          "Couldn't find data/ and stream/ in that pack. Expected a FiveM vehicle resource layout (like your server resources: data/ + stream/).",
      };
    }

    const out = outputPath.toLowerCase().endsWith(".oiv")
      ? outputPath
      : `${outputPath}.oiv`;
    return stageAndBuildOiv(vehicle, out);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err).replace(
      /^Error:\s*/,
      "",
    );
    if (
      /webpage \(HTML\)|not a valid \.zip|corrupt or not a real zip|looks like a \.(rar|7z)|empty or too small|Could not read that zip/i.test(
        msg,
      )
    ) {
      return { ok: false, error: msg };
    }
    return { ok: false, error: `Convert failed: ${msg}` };
  } finally {
    if (tempExtract) rmSync(tempExtract, { recursive: true, force: true });
  }
}

export async function convertFiveMVehicleToOiv(
  sourcePath?: string,
  sourceKind?: "zip" | "folder",
): Promise<FiveMConvertResult> {
  let path = sourcePath;
  let kind: "zip" | "folder" | undefined = sourceKind;

  if (!path) {
    const picked = await pickFiveMVehicleSource(sourceKind ?? "zip");
    if (!picked.ok || !picked.path || !picked.kind) return picked;
    path = picked.path;
    kind = picked.kind;
  } else if (!kind) {
    try {
      const st = statSync(path);
      kind = st.isDirectory()
        ? "folder"
        : extname(path).toLowerCase() === ".zip"
          ? "zip"
          : undefined;
    } catch {
      return { ok: false, error: "Could not read that path." };
    }
    if (!kind) {
      return {
        ok: false,
        error: "Source must be a .zip or a folder with data/ + stream/.",
      };
    }
  }

  let workRoot = path;
  let tempExtract: string | null = null;
  try {
    if (kind === "zip") {
      const bad = inspectZipCandidate(path);
      if (bad) return { ok: false, error: bad };
      tempExtract = extractZipToTemp(path);
      workRoot = tempExtract;
    }

    const vehicle = resolveVehicleRoot(workRoot);
    if (!vehicle) {
      return {
        ok: false,
        error:
          "Couldn't find data/ and stream/ in that pack. Expected a FiveM vehicle resource layout (like your server resources: data/ + stream/).",
      };
    }

    const spawnGuess = (() => {
      try {
        const metas = collectMetas(vehicle.dataDir);
        const v = metas.find((m) => m.kind === "vehicles");
        if (!v) return sanitizePackName(basename(vehicle.root));
        return (
          parseSpawnName(readFileSync(v.absPath, "utf8")) ??
          basename(vehicle.root)
        );
      } catch {
        return basename(vehicle.root);
      }
    })();

    const defaultName = `${sanitizePackName(spawnGuess)}_install.oiv`;
    const downloads = app.getPath("downloads");
    const save = await dialog.showSaveDialog({
      title: "Save the OpenIV .oiv package (output)",
      defaultPath: join(downloads, defaultName),
      filters: [{ name: "OpenIV package", extensions: ["oiv"] }],
    });
    if (save.canceled || !save.filePath) {
      return { ok: false, error: "Cancelled." };
    }
    const outputPath = save.filePath.toLowerCase().endsWith(".oiv")
      ? save.filePath
      : `${save.filePath}.oiv`;

    return stageAndBuildOiv(vehicle, outputPath);
  } catch (err) {
    const msg = String(err instanceof Error ? err.message : err);
    if (
      /webpage \(HTML\)|not a valid \.zip|corrupt or not a real zip|looks like a \.(rar|7z)|empty or too small|Could not read that zip/i.test(
        msg,
      )
    ) {
      return { ok: false, error: msg.replace(/^Error:\s*/, "") };
    }
    return { ok: false, error: `Convert failed: ${msg.replace(/^Error:\s*/, "")}` };
  } finally {
    if (tempExtract) rmSync(tempExtract, { recursive: true, force: true });
  }
}

export async function openPathInFolder(targetPath: string): Promise<ActionResult> {
  if (!targetPath || !existsSync(targetPath)) {
    return { ok: false, error: "File not found." };
  }
  shell.showItemInFolder(targetPath);
  return { ok: true, message: "Opened in folder." };
}
