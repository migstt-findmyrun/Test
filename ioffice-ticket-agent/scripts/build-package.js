// Builds appPackage/build/appPackage.zip without the Agents Toolkit, for uploading
// the agent by hand (Teams > Apps > Manage your apps > Upload an app).
//
//   node scripts/build-package.js [envName]     (default envName: dev)
//
// Reads env/.env.<envName>, replaces ${{NAME}} placeholders in the package files,
// and creates a TEAMS_APP_ID (a GUID) in that file if it is empty.
// No dependencies; needs Node 22+ (for zlib.crc32).

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const envName = process.argv[2] || "dev";
const envFile = path.join(root, "env", `.env.${envName}`);
const pkgDir = path.join(root, "appPackage");
const outDir = path.join(pkgDir, "build");

function readEnv(file) {
  const vars = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

let env = readEnv(envFile);
if (!env.TEAMS_APP_ID) {
  env.TEAMS_APP_ID = crypto.randomUUID();
  const text = fs.readFileSync(envFile, "utf8").replace(/^TEAMS_APP_ID=.*$/m, `TEAMS_APP_ID=${env.TEAMS_APP_ID}`);
  fs.writeFileSync(envFile, text);
  console.log(`Created TEAMS_APP_ID=${env.TEAMS_APP_ID} in ${path.relative(root, envFile)}`);
}
if (!env.OPENAPI_SERVER_URL || env.OPENAPI_SERVER_URL.includes("REPLACE-ME")) {
  console.error(`Set OPENAPI_SERVER_URL in ${path.relative(root, envFile)} to the public HTTPS URL of the bridge API.`);
  process.exit(1);
}

function substitute(text, file) {
  return text.replace(/\$\{\{([A-Z0-9_]+)\}\}/g, (_, name) => {
    if (!(name in env)) throw new Error(`${file}: no value for \${{${name}}} in ${path.relative(root, envFile)}`);
    return env[name];
  });
}

// Files that go in the package, relative to appPackage/.
const files = [
  "manifest.json",
  "declarativeAgent.json",
  "instruction.txt",
  "ai-plugin.json",
  "apiSpecificationFile/openapi.yaml",
  "color.png",
  "outline.png",
];

const entries = files.map((name) => {
  let data = fs.readFileSync(path.join(pkgDir, name));
  if (!name.endsWith(".png")) data = Buffer.from(substitute(data.toString("utf8"), name), "utf8");
  return { name, data };
});

// Inline the instructions so the package also works with tools that don't support $[file(...)].
const agent = entries.find((e) => e.name === "declarativeAgent.json");
const instructions = entries.find((e) => e.name === "instruction.txt").data.toString("utf8");
if (instructions.length > 8000) throw new Error("instruction.txt is over the 8,000 character limit");
const agentJson = JSON.parse(agent.data.toString("utf8"));
agentJson.instructions = instructions;
agent.data = Buffer.from(JSON.stringify(agentJson, null, 2), "utf8");

// Minimal ZIP writer (deflate).
function zip(items) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of items) {
    const nameBuf = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(items.length, 8);
  end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `appPackage.${envName}.zip`);
fs.writeFileSync(outFile, zip(entries));
console.log(`Wrote ${path.relative(root, outFile)} (${entries.length} files)`);
