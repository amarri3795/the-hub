import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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

/** Stable kit id in 20000–60000 so we never collide with vanilla kit 0. */
function modkitIdForPack(packName: string): number {
  let h = 2166136261;
  for (let i = 0; i < packName.length; i++) {
    h ^= packName.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 20000 + (h >>> 0) % 40001;
}

/** Strip non-ASCII (OpenIV/package UI mangled arrows as ``). */
function asciiSafe(text: string): string {
  return text.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function escapeXml(text: string): string {
  return asciiSafe(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Rewrite carcols + carvariations so kit id 0 / 0_default_modkit become a
 * unique high id + kit name for this pack.
 */
function remapModkits(
  carcolsXml: string | null,
  carvariationsXml: string | null,
  packName: string,
): { carcols: string | null; carvariations: string | null; kitId: number; kitName: string } {
  const kitId = modkitIdForPack(packName);
  const kitName = `${kitId}_${packName}_modkit`;
  const renamed = new Map<string, string>();

  const needsRemap = (name: string, id: number): boolean =>
    id === 0 ||
    !name ||
    /^0(_|$)/i.test(name) ||
    /default_modkit/i.test(name);

  const remapCols = (xml: string): string =>
    xml.replace(/<Kits>([\s\S]*?)<\/Kits>/gi, (_m, body: string) => {
      const items = body.replace(/<Item>([\s\S]*?)<\/Item>/gi, (_im, item: string) => {
        const nameMatch = /<kitName>\s*([^<]*?)\s*<\/kitName>/i.exec(item);
        const idMatch = /<id\s+value="(\d+)"\s*\/>/i.exec(item);
        const name = nameMatch?.[1]?.trim() ?? "";
        const id = idMatch ? Number(idMatch[1]) : -1;
        if (!needsRemap(name, id)) return `<Item>${item}</Item>`;
        if (name) renamed.set(name, kitName);
        renamed.set("0_default_modkit", kitName);
        let fixed = item;
        if (nameMatch) {
          fixed = fixed.replace(
            /<kitName>\s*[^<]*?\s*<\/kitName>/i,
            `<kitName>${kitName}</kitName>`,
          );
        } else {
          fixed = `<kitName>${kitName}</kitName>\n${fixed}`;
        }
        if (idMatch) {
          fixed = fixed.replace(
            /<id\s+value="\d+"\s*\/>/i,
            `<id value="${kitId}" />`,
          );
        } else {
          fixed = `${fixed}\n<id value="${kitId}" />`;
        }
        return `<Item>${fixed}</Item>`;
      });
      return `<Kits>${items}</Kits>`;
    });

  const remapVars = (xml: string): string => {
    let out = xml.replace(/<kitName>\s*([^<]*?)\s*<\/kitName>/gi, (_m, raw: string) => {
      const n = raw.trim();
      if (renamed.has(n)) return `<kitName>${renamed.get(n)}</kitName>`;
      if (needsRemap(n, n === "0" ? 0 : -1)) {
        return `<kitName>${kitName}</kitName>`;
      }
      return `<kitName>${n}</kitName>`;
    });
    // Common FiveM form: <kits><Item>0_default_modkit</Item></kits>
    out = out.replace(
      /(<kits>\s*)([\s\S]*?)(<\/kits>)/gi,
      (_m, open: string, body: string, close: string) => {
        const fixed = body.replace(
          /<Item>\s*([^<]*?)\s*<\/Item>/gi,
          (_im, raw: string) => {
            const n = raw.trim();
            if (renamed.has(n)) return `<Item>${renamed.get(n)}</Item>`;
            if (needsRemap(n, n === "0" ? 0 : -1)) {
              return `<Item>${kitName}</Item>`;
            }
            return `<Item>${n}</Item>`;
          },
        );
        return `${open}${fixed}${close}`;
      },
    );
    return out;
  };

  return {
    carcols: carcolsXml ? remapCols(carcolsXml) : null,
    carvariations: carvariationsXml ? remapVars(carvariationsXml) : null,
    kitId,
    kitName,
  };
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
  // Some packs put metas next to stream without a data/ folder.
  if (streamDir) {
    const siblingData = join(dirname(streamDir), "data");
    if (existsSync(siblingData)) {
      return { root: dirname(streamDir), dataDir: siblingData, streamDir };
    }
  }
  return null;
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
  <order value="71" />
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
  /** Path AFTER %PLATFORM% (no leading x64/) — %PLATFORM% already expands to x64. */
  vehiclesRpfUnderPlatform: string,
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

  const rpfLogical = vehiclesRpfUnderPlatform.replace(/\\/g, "/");
  const rpfItem = `    <Item>
      <filename>${device}:/%PLATFORM%/${rpfLogical}</filename>
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
  const enableRpf = `        <Item>${device}:/%PLATFORM%/${rpfLogical}</Item>`;

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

  const description = asciiSafe(`Converted from FiveM for GTA V Story Mode by The Hub.

Spawn name: ${opts.spawnName}
Pack: ${opts.packName}

Install with OpenIV -> Tools -> Package Installer
Install into your GTA V "mods" folder.

Then spawn with: ${opts.spawnName}`);

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
  const dest = mkdtempSync(join(tmpdir(), "hub-fivem-"));
  const zip = new AdmZip(zipPath);
  zip.extractAllTo(dest, true);
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
  // Physical path inside dlc.rpf (has x64/). content.xml uses %PLATFORM%/ without x64/.
  const vehiclesRpfPhysical = `x64\\levels\\gta5\\vehicles\\${packName}_vehicles.rpf`;
  const vehiclesRpfUnderPlatform = `levels\\gta5\\vehicles\\${packName}_vehicles.rpf`;
  const displayName = asciiSafe(`${spawnName} (FiveM -> Story Mode)`);

  const stage = mkdtempSync(join(tmpdir(), "hub-oiv-"));
  const contentDir = join(stage, "content");
  const dataOut = join(contentDir, "data");
  const streamOut = join(contentDir, "stream");
  ensureDir(dataOut);
  ensureDir(streamOut);

  try {
    const carcolsMeta = metas.find((m) => m.kind === "carcols");
    const carvarsMeta = metas.find((m) => m.kind === "carvariations");
    const remapped = remapModkits(
      carcolsMeta ? readFileSync(carcolsMeta.absPath, "utf8") : null,
      carvarsMeta ? readFileSync(carvarsMeta.absPath, "utf8") : null,
      packName,
    );

    const metaAdds: Array<{ source: string; dest: string }> = [];
    for (const meta of metas) {
      const relSource = `data\\${meta.fileName}`;
      const destFile = join(dataOut, meta.fileName);
      if (meta.kind === "carcols" && remapped.carcols !== null) {
        writeFileSync(destFile, remapped.carcols, "utf8");
      } else if (meta.kind === "carvariations" && remapped.carvariations !== null) {
        writeFileSync(destFile, remapped.carvariations, "utf8");
      } else {
        copyFileSync(meta.absPath, destFile);
      }
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
        vehiclesRpfUnderPlatform,
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
        vehiclesRpfRel: vehiclesRpfPhysical,
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
      message: asciiSafe(
        `Created ${basename(outputPath)}. Spawn name: ${spawnName}. Install with OpenIV -> Tools -> Package Installer (mods folder).`,
      ),
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

/** Convert without Electron dialogs (tests / automation). */
export function convertFiveMSourceToOiv(
  sourcePath: string,
  kind: "zip" | "folder",
  outputPath: string,
): FiveMConvertResult {
  let workRoot = sourcePath;
  let tempExtract: string | null = null;
  try {
    if (kind === "zip") {
      const dest = mkdtempSync(join(tmpdir(), "hub-fivem-"));
      tempExtract = dest;
      const zip = new AdmZip(sourcePath);
      zip.extractAllTo(dest, true);
      workRoot = dest;
    } else if (!statSync(sourcePath).isDirectory()) {
      return { ok: false, error: "Folder path is not a directory." };
    }

    const vehicle = resolveVehicleRoot(workRoot);
    if (!vehicle) {
      return {
        ok: false,
        error:
          "Couldn't find data/ and stream/ in that pack. Expected a FiveM vehicle resource layout.",
      };
    }
    const out = outputPath.toLowerCase().endsWith(".oiv")
      ? outputPath
      : `${outputPath}.oiv`;
    return stageAndBuildOiv(vehicle, out);
  } catch (err) {
    return {
      ok: false,
      error: `Convert failed: ${String(err instanceof Error ? err.message : err)}`,
    };
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
      tempExtract = extractZipToTemp(path);
      workRoot = tempExtract;
    }

    const vehicle = resolveVehicleRoot(workRoot);
    if (!vehicle) {
      return {
        ok: false,
        error:
          "Couldn't find data/ and stream/ in that pack. Expected a FiveM vehicle resource layout.",
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
    return { ok: false, error: `Convert failed: ${String(err)}` };
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
