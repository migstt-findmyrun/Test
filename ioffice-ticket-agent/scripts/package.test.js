// Checks that the agent package files agree with each other. Run with: npm test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const pkg = path.join(__dirname, "..", "appPackage");
const read = (f) => fs.readFileSync(path.join(pkg, f), "utf8");
const json = (f) => JSON.parse(read(f));
const openapi = read("apiSpecificationFile/openapi.yaml");
const envText = fs.readFileSync(path.join(__dirname, "..", "env", ".env.dev"), "utf8");

test("all JSON files parse", () => {
  for (const f of ["manifest.json", "declarativeAgent.json", "ai-plugin.json"]) json(f);
});

test("manifest points at the declarative agent, which points at the plugin", () => {
  const manifest = json("manifest.json");
  const agentFile = manifest.copilotAgents.declarativeAgents[0].file;
  const agent = json(agentFile);
  for (const action of agent.actions) assert.ok(fs.existsSync(path.join(pkg, action.file)), action.file);
  for (const icon of Object.values(manifest.icons)) assert.ok(fs.existsSync(path.join(pkg, icon)), icon);
});

test("every plugin function has a matching OpenAPI operationId", () => {
  const plugin = json("ai-plugin.json");
  const operationIds = [...openapi.matchAll(/operationId:\s*(\S+)/g)].map((m) => m[1]);
  const functions = plugin.functions.map((f) => f.name);
  assert.deepStrictEqual([...functions].sort(), [...operationIds].sort());
  for (const runtime of plugin.runtimes) {
    assert.ok(fs.existsSync(path.join(pkg, runtime.spec.url)), runtime.spec.url);
    for (const fn of runtime.run_for_functions) assert.ok(functions.includes(fn), fn);
  }
});

test("plugin uses the API key vault, so no secret is in the package", () => {
  const plugin = json("ai-plugin.json");
  assert.strictEqual(plugin.runtimes[0].auth.type, "ApiKeyPluginVault");
  assert.match(openapi, /securitySchemes:[\s\S]*type: apiKey/);
});

test("every ${{VAR}} placeholder is defined in env/.env.dev", () => {
  const defined = new Set([...envText.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  for (const f of ["manifest.json", "declarativeAgent.json", "ai-plugin.json", "apiSpecificationFile/openapi.yaml"]) {
    for (const [, name] of read(f).matchAll(/\$\{\{([A-Z0-9_]+)\}\}/g)) {
      assert.ok(defined.has(name), `${f} uses \${{${name}}} but env/.env.dev doesn't define it`);
    }
  }
});

test("instructions are under the 8,000 character limit", () => {
  assert.ok(read("instruction.txt").length < 8000);
});
