const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const cliPath = path.join(__dirname, "..", "bin", "claude-provider.js");
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-provider-test-"));

function run(args) {
  return spawnSync("node", [cliPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_PROVIDER_HOME: tmpHome
    }
  });
}

let result = run(["list"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /default/);
assert.match(result.stdout, /kimi/);
assert.match(result.stdout, /glm/);

result = run(["use", "glm"]);
assert.equal(result.status, 0);

result = run(["current"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /^glm/m);

result = run(["status"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /^glm/m);

result = run([
  "add",
  "test-provider",
  "--base-url",
  "https://example.com/anthropic",
  "--model",
  "test-model",
  "--display-name",
  "Test Provider"
]);
assert.equal(result.status, 0);

result = run(["list"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /test-provider/);

result = run(["remove", "test-provider"]);
assert.equal(result.status, 0);

result = run(["env", "default"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /unset ANTHROPIC_BASE_URL/);

result = run(["shell", "default"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /unset ANTHROPIC_BASE_URL/);

console.log("smoke tests passed");
