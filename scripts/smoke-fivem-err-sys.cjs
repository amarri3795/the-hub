/* Verify ERR_SYS_FILELOAD fix + modkit/order/ascii for hycgt500-like pack */
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

const src = fs
  .readFileSync(path.join(root, "src/main/fivemToSp.ts"), "utf8")
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
const compiled = path.join(root, "scripts", ".hub-fivemToSp-compiled.cjs");
fs.writeFileSync(compiled, out);
const { convertFiveMSourceToOiv } = require(compiled);

const packRoot = path.join(tmpdir(), `hycgt500-src-${Date.now()}`, "hycgt500");
fs.mkdirSync(path.join(packRoot, "data"), { recursive: true });
fs.mkdirSync(path.join(packRoot, "stream"), { recursive: true });
fs.writeFileSync(
  path.join(packRoot, "data", "vehicles.meta"),
  `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfo__InitDataList>
  <InitDatas>
    <Item>
      <modelName>hycgt500</modelName>
      <txdName>hycgt500</txdName>
      <handlingId>hycgt500</handlingId>
      <gameName>hycgt500</gameName>
      <vehicleMakeName>FORD</vehicleMakeName>
    </Item>
  </InitDatas>
</CVehicleModelInfo__InitDataList>
`,
);
fs.writeFileSync(
  path.join(packRoot, "data", "handling.meta"),
  `<?xml version="1.0"?><CHandlingDataMgr><HandlingData><Item type="CHandlingData"><handlingName>hycgt500</handlingName></Item></HandlingData></CHandlingDataMgr>`,
);
fs.writeFileSync(
  path.join(packRoot, "data", "carcols.meta"),
  `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfoVarGlobal>
  <Kits>
    <Item>
      <kitName>0_default_modkit</kitName>
      <id value="0" />
      <kitType>MKT_SPECIAL</kitType>
      <visibleMods />
      <linkMods />
      <statMods />
      <slotNames />
      <liveryNames />
    </Item>
  </Kits>
</CVehicleModelInfoVarGlobal>
`,
);
fs.writeFileSync(
  path.join(packRoot, "data", "carvariations.meta"),
  `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfoVariation>
  <variationData>
    <Item>
      <modelName>hycgt500</modelName>
      <colors />
      <kits>
        <Item>0_default_modkit</Item>
      </kits>
      <windowsWithExposedEdges />
      <plateProbabilities><Probabilities /></plateProbabilities>
      <lightSettings value="0" />
      <sirenSettings value="0" />
    </Item>
  </variationData>
</CVehicleModelInfoVariation>
`,
);
// carvariations often uses <kitName> not <kits><Item> — also cover kitName form
fs.writeFileSync(
  path.join(packRoot, "data", "carvariations.meta"),
  `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfoVariation>
  <variationData>
    <Item>
      <modelName>hycgt500</modelName>
      <colors />
      <kits>
        <Item>0_default_modkit</Item>
      </kits>
      <kitName>0_default_modkit</kitName>
      <windowsWithExposedEdges />
      <plateProbabilities><Probabilities /></plateProbabilities>
      <lightSettings value="0" />
      <sirenSettings value="0" />
    </Item>
  </variationData>
</CVehicleModelInfoVariation>
`,
);
fs.writeFileSync(path.join(packRoot, "stream", "hycgt500.yft"), "fake-yft");
fs.writeFileSync(path.join(packRoot, "stream", "hycgt500.ytd"), "fake-ytd");

const oivPath = path.join(tmpdir(), "hycgt500_install.oiv");
const res = convertFiveMSourceToOiv(packRoot, "folder", oivPath);
console.log("CONVERT", JSON.stringify({ ok: res.ok, spawn: res.spawnName, pack: res.packName, err: res.error }));
if (!res.ok) process.exit(1);

const z = new AdmZip(oivPath);
const contentXml = z.readAsText("content/content.xml");
const setup2 = z.readAsText("content/setup2.xml");
const assembly = z.readAsText("assembly.xml");
const carcols = z.readAsText("content/data/carcols.meta");
const carvars = z.readAsText("content/data/carvariations.meta");

const checks = [];
const pass = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(ok ? "PASS" : "FAIL", name, detail || "");
};

pass(
  "content_rpf_no_double_x64",
  /dlc_hycgt500:\/%PLATFORM%\/levels\/gta5\/vehicles\/hycgt500_vehicles\.rpf/.test(
    contentXml,
  ) && !/%PLATFORM%\/x64\//.test(contentXml),
  contentXml.match(/dlc_hycgt500:\/%PLATFORM%\/[^\s<]+/)?.[0],
);
pass(
  "content_enable_rpf",
  contentXml.includes(
    "dlc_hycgt500:/%PLATFORM%/levels/gta5/vehicles/hycgt500_vehicles.rpf",
  ),
);
pass(
  "assembly_physical_x64",
  /x64\\levels\\gta5\\vehicles\\hycgt500_vehicles\.rpf/.test(assembly),
);
pass("setup2_order_71", /<order value="71"\s*\/>/.test(setup2));
pass(
  "no_unicode_arrows",
  !/[→←]/.test(assembly) && !/[→←]/.test(contentXml),
  assembly.match(/FiveM.{0,20}Story/)?.[0],
);
pass(
  "modkit_id_not_zero",
  /<id value="([2-6]\d{4}|[2-9]\d{3})" \/>/.test(carcols) &&
    !/<Kits>[\s\S]*?<id value="0" \/>/.test(carcols),
  carcols.match(/<id value="\d+" \/>/)?.[0],
);
pass(
  "modkit_name_remapped",
  !/0_default_modkit/.test(carcols) && !/0_default_modkit/.test(carvars),
  carcols.match(/<kitName>[^<]+<\/kitName>/)?.[0],
);

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.log("SMOKE_FAIL", failed.map((f) => f.name).join(","));
  process.exit(1);
}
console.log("SMOKE_PASS", oivPath);
process.exit(0);
