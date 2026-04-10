const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  extractTraceTurnsFromSessionFile,
  getTraceFilePath
} = require("../bin/claude-provider.js");

const cliPath = path.join(__dirname, "..", "bin", "claude-provider.js");
const ccpPath = path.join(__dirname, "..", "bin", "ccp.js");
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "claude-provider-test-"));
process.env.CLAUDE_PROVIDER_HOME = tmpHome;

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

result = run(["team", "show-default"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /orchestrator/);
assert.match(result.stdout, /planner/);
assert.match(result.stdout, /worker/);
assert.match(result.stdout, /reviewer/);

const generatedTeamConfig = path.join(tmpHome, "agents", "team.json");
result = run(["team", "init", generatedTeamConfig]);
assert.equal(result.status, 0);
assert.ok(fs.existsSync(generatedTeamConfig));

const generatedTeamJson = JSON.parse(fs.readFileSync(generatedTeamConfig, "utf8"));
assert.equal(typeof generatedTeamJson.orchestrator.prompt, "string");
assert.equal(typeof generatedTeamJson.worker.prompt, "string");

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
assert.match(result.stdout, /unset CCP_WRAPPED/);
assert.doesNotMatch(result.stdout, /export CCP_WRAPPED='1'/);

result = run(["shell", "default"]);
assert.equal(result.status, 0);
assert.match(result.stdout, /unset ANTHROPIC_BASE_URL/);
assert.match(result.stdout, /unset CCP_WRAPPED/);

result = spawnSync("node", [ccpPath, "shell", "default"], {
  encoding: "utf8",
  env: {
    ...process.env,
    CLAUDE_PROVIDER_HOME: tmpHome
  }
});
assert.equal(result.status, 0);
assert.match(result.stdout, /export CCP_WRAPPED='1'/);
assert.match(result.stdout, /export CCP_PROVIDER='default'/);

const teamAgentsFile = path.join(tmpHome, "team-agents.json");
fs.writeFileSync(
  teamAgentsFile,
  JSON.stringify({
    reviewer: {
      description: "Reviews code changes",
      prompt: "You are a careful code reviewer."
    }
  }),
  "utf8"
);

const fakeClaudeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-fake-claude-"));
const fakeClaudePath = path.join(fakeClaudeDir, "claude");
const argvCapturePath = path.join(fakeClaudeDir, "argv.json");
fs.writeFileSync(
  fakeClaudePath,
  `#!/usr/bin/env node
require("node:fs").writeFileSync(${JSON.stringify(argvCapturePath)}, JSON.stringify(process.argv.slice(2)));
`,
  "utf8"
);
fs.chmodSync(fakeClaudePath, 0o755);

result = spawnSync("node", [ccpPath, "default", "--team-agents", teamAgentsFile, "--", "-p", "hello"], {
  encoding: "utf8",
  env: {
    ...process.env,
    CLAUDE_PROVIDER_HOME: tmpHome,
    PATH: `${fakeClaudeDir}:${process.env.PATH || ""}`
  }
});
assert.equal(result.status, 0);

const forwardedArgs = JSON.parse(fs.readFileSync(argvCapturePath, "utf8"));
assert.equal(forwardedArgs[0], "--agents");
assert.equal(
  forwardedArgs[1],
  JSON.stringify({
    reviewer: {
      description: "Reviews code changes",
      prompt: "You are a careful code reviewer."
    }
  })
);
assert.deepEqual(forwardedArgs.slice(2), ["-p", "hello"]);

const fakeTeamClaudeDir = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-fake-team-claude-"));
const fakeTeamClaudePath = path.join(fakeTeamClaudeDir, "claude");
fs.writeFileSync(
  fakeTeamClaudePath,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
const roleIndex = args.indexOf("--agent");
const role = roleIndex >= 0 ? args[roleIndex + 1] : "";
let output;
if (role === "planner") {
  output = {
    summary: "Planner summary",
    subtasks: [
      { id: "task-1", title: "Analyze", instructions: "Analyze the request" },
      { id: "task-2", title: "Implement", instructions: "Implement the solution" }
    ]
  };
} else if (role === "worker") {
  output = {
    summary: "Worker summary",
    result: "Worker result"
  };
} else if (role === "reviewer") {
  output = {
    summary: "Reviewer summary",
    issues: [],
    recommendations: "Proceed"
  };
} else if (role === "orchestrator") {
  output = {
    summary: "Orchestrator summary",
    final_response: "TEAM_RUN_OK"
  };
} else {
  output = { summary: "Unknown", final_response: "UNKNOWN" };
}
process.stdout.write(JSON.stringify(output));
`,
  "utf8"
);
fs.chmodSync(fakeTeamClaudePath, 0o755);

result = spawnSync("node", [ccpPath, "team", "run", "default", "--task", "Ship feature"], {
  encoding: "utf8",
  env: {
    ...process.env,
    CLAUDE_PROVIDER_HOME: tmpHome,
    PATH: `${fakeTeamClaudeDir}:${process.env.PATH || ""}`
  }
});
assert.equal(result.status, 0);
assert.match(result.stdout, /TEAM_RUN_OK/);
assert.match(result.stderr, /\[team\] run started/);
assert.match(result.stderr, /\[team\] planner: starting/);
assert.match(result.stderr, /\[team\] worker 1\/2: starting/);
assert.match(result.stderr, /\[team\] reviewer: completed in /);
assert.match(result.stderr, /\[team\] orchestrator: completed in /);

const teamRunsDir = path.join(tmpHome, "team-runs");
const teamRunDirs = fs.readdirSync(teamRunsDir);
assert.ok(teamRunDirs.length >= 1);
const latestTeamRunDir = path.join(teamRunsDir, teamRunDirs[0]);
assert.ok(fs.existsSync(path.join(latestTeamRunDir, "planner.json")));
assert.ok(fs.existsSync(path.join(latestTeamRunDir, "orchestrator.json")));

const sessionFixture = path.join(tmpHome, "fixture-session.jsonl");
fs.writeFileSync(
  sessionFixture,
  [
    JSON.stringify({
      type: "user",
      isSidechain: false,
      promptId: "prompt-1",
      message: { role: "user", content: "Explain this project" },
      timestamp: "2026-04-10T01:00:00.000Z",
      cwd: "/tmp/project",
      sessionId: "session-1"
    }),
    JSON.stringify({
      type: "assistant",
      isSidechain: false,
      message: {
        role: "assistant",
        model: "claude-opus-4-6",
        content: [{ type: "text", text: "This project is a CLI wrapper." }]
      },
      timestamp: "2026-04-10T01:00:02.000Z",
      cwd: "/tmp/project",
      sessionId: "session-1"
    }),
    ""
  ].join("\n"),
  "utf8"
);

const turns = extractTraceTurnsFromSessionFile(sessionFixture, {
  cwd: "/tmp/project",
  sessionId: "session-1",
  startedAt: new Date("2026-04-10T00:59:00.000Z")
});
assert.equal(turns.length, 1);
assert.equal(turns[0].prompt, "Explain this project");
assert.equal(turns[0].response, "This project is a CLI wrapper.");

assert.equal(
  getTraceFilePath(),
  path.join(tmpHome, "traces.jsonl")
);

console.log("smoke tests passed");
