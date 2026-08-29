/* Smoke: HTML fake-zip fails clearly; ZL1 Hycade folder+zip convert to .oiv */
const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { tmpdir } = os;
const ts = require("typescript");
const AdmZip = require("adm-zip");

const root = path.join(__dirname, "..");

const electronMock = {
  app: { getPath: () => tmpdir() },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => ({ canceled: true }),
  },
  shell: { showItemInFolder: () => {} },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronMock;
  return origLoad.apply(this, arguments);
};

const srcPath = path.join(root, "src/main/fivemToSp.ts");
const src = fs
  .readFileSync(srcPath, "utf8")
  .replace(/import type \{[^}]+\} from "\.\.\/shared\/types";/, "");
const out = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
    skipLibCheck: true,
  },
  fileName: "fivemToSp.ts",
}).outputText;

const compiled = path.join(root, "scripts", `.hub-fivemToSp-compiled.cjs`);
fs.writeFileSync(compiled, out);
const { convertFiveMSourceToOiv } = require(compiled);

const htmlZip =
  "/home/ubuntu/.cursor/projects/workspace/uploads/camaro_hycade_ee56.zip";
const folder = "/tmp/hub-fivem-smoke-1788033752138/ZL1 Hycade";
const outOiv = path.join(tmpdir(), "zl1hycade_install_smoke.oiv");
const zipOut = path.join(tmpdir(), "zl1hycade_pack_smoke.zip");

const bad = convertFiveMSourceToOiv(htmlZip, "zip", path.join(tmpdir(), "no.oiv"));
console.log("HTML_ZIP ok=", bad.ok, "error=", bad.error);

const goodFolder = convertFiveMSourceToOiv(folder, "folder", outOiv);
console.log(
  "FOLDER ok=",
  goodFolder.ok,
  "spawn=",
  goodFolder.spawnName,
  "pack=",
  goodFolder.packName,
  "err=",
  goodFolder.error,
);

const z = new AdmZip();
z.addLocalFolder(folder, "ZL1 Hycade");
z.writeZip(zipOut);
const fromZip = outOiv.replace(/\.oiv$/, "_fromzip.oiv");
const goodZip = convertFiveMSourceToOiv(zipOut, "zip", fromZip);
console.log(
  "ZIP ok=",
  goodZip.ok,
  "spawn=",
  goodZip.spawnName,
  "pack=",
  goodZip.packName,
  "err=",
  goodZip.error,
);

if (!bad.ok && /webpage|HTML|not a valid/i.test(bad.error || "") && goodFolder.ok && goodZip.ok) {
  console.log("SMOKE_PASS");
  process.exit(0);
}
console.log("SMOKE_FAIL");
process.exit(1);
