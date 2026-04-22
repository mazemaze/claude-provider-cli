#!/usr/bin/env node

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const BUILTIN_PROVIDERS = {
  default: {
    kind: "default",
    displayName: "Claude Default",
    description: "Use Claude Code with its normal login and default provider settings."
  },
  kimi: {
    kind: "compatible",
    displayName: "Kimi for Coding",
    description: "Moonshot Kimi Coding Plan via Anthropic-compatible endpoint.",
    baseUrl: "https://api.kimi.com/coding",
    providerModel: "kimi-for-coding",
    anthropicModel: "sonnet",
    smallFastModel: "haiku"
  },
  glm: {
    kind: "compatible",
    displayName: "GLM 5.1",
    description: "Zhipu AI via Anthropic-compatible endpoint.",
    baseUrl: "https://open.bigmodel.cn/api/anthropic",
    providerModel: "glm-5.1",
    anthropicModel: "sonnet",
    smallFastModel: "haiku"
  }
};

const KEYCHAIN_SERVICE_PREFIX = "claude-provider";
const CURRENT_CONFIG_VERSION = 1;
const COMMON_ENV_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION"
];

const CCP_ENV_KEYS = [
  "CCP_WRAPPED",
  "CCP_PROVIDER",
  "CCP_PROVIDER_KIND",
  "CCP_PROVIDER_NAME",
  "CCP_PROVIDER_BASE_URL",
  "CCP_PROVIDER_MODEL",
  "CCP_TEAM_MODE",
  "CCP_TEAM_ROLE",
  "CCP_TEAM_RUN_DIR"
];

const DEFAULT_TEAM_CONFIG = {
  orchestrator: {
    description: "Coordinates the overall workflow, decides delegation, and synthesizes the final result.",
    prompt:
      "You are the orchestrator. Break the task into clear subtasks, decide what should be delegated, collect worker outputs, resolve conflicts, and produce the final answer."
  },
  planner: {
    description: "Turns a user request into a practical execution plan with bounded tasks.",
    prompt:
      "You are the planner. Create a concise execution plan, identify dependencies, and propose work packets that can be done independently."
  },
  worker: {
    description: "Executes one concrete task from the plan and reports its result clearly.",
    prompt:
      "You are a worker. Complete the assigned subtask only, keep scope tight, and return concrete results, findings, or code changes without redesigning the whole plan."
  },
  reviewer: {
    description: "Checks outputs for bugs, regressions, and gaps before finalizing.",
    prompt:
      "You are the reviewer. Validate the proposed result, call out risks or regressions, and suggest focused fixes or follow-ups."
  }
};

const PLANNER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    subtasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          instructions: { type: "string" }
        },
        required: ["id", "title", "instructions"]
      }
    }
  },
  required: ["summary", "subtasks"]
};

const WORKER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    result: { type: "string" }
  },
  required: ["summary", "result"]
};

const REVIEWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    issues: {
      type: "array",
      items: { type: "string" }
    },
    recommendations: { type: "string" }
  },
  required: ["summary", "issues", "recommendations"]
};

const ORCHESTRATOR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    final_response: { type: "string" }
  },
  required: ["summary", "final_response"]
};

function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "help";
  const config = loadConfig();
  const provider = getProviderIfExists(command, config);

  try {
    if (isCcpInvocation() && isImplicitRunOption(command)) {
      cmdRun(args, config);
      return;
    }

    if (provider) {
      cmdRun([command, ...args.slice(1)], config);
      return;
    }

    switch (command) {
      case "help":
      case "-h":
      case "--help":
        printUsage();
        return;
      case "list":
      case "ls":
        cmdList();
        return;
      case "current":
      case "status":
        cmdCurrent();
        return;
      case "use":
      case "set":
      case "switch":
        cmdUse(args.slice(1));
        return;
      case "env":
      case "shell":
        cmdEnv(args.slice(1));
        return;
      case "run":
        cmdRun(args.slice(1), config);
        return;
      case "key":
        cmdKey(args.slice(1));
        return;
      case "add":
        cmdAdd(args.slice(1));
        return;
      case "remove":
        cmdRemove(args.slice(1));
        return;
      case "team":
        cmdTeam(args.slice(1));
        return;
      default:
        fail(`unknown command "${command}"`);
    }
  } catch (error) {
    if (error && error.message) {
      console.error(`claude-provider: ${error.message}`);
    } else {
      console.error("claude-provider: unexpected error");
    }
    process.exit(1);
  }
}

function printUsage() {
  console.log(`Claude Provider CLI

Usage:
  claude-provider list
  claude-provider current
  claude-provider use <provider>
  claude-provider env [provider]
  claude-provider run [provider] [--team-agents <file>] [-- <claude args...>]
  claude-provider key set <provider> [--value <secret>]
  claude-provider key delete <provider>
  claude-provider key test <provider>
  claude-provider add <name> --base-url <url> --model <model> [--display-name <name>] [--description <text>]
  claude-provider remove <name>
  claude-provider team show-default
  claude-provider team init [path] [--force]
  claude-provider team run [provider] [--config <file>] --task <text> [--workers <n>] [--no-review] [-- <claude args...>]
  ccp list
  ccp status
  ccp set <provider>
  ccp <provider> [--team-agents <file>] [-- <claude args...>]
  ccp team init [path] [--force]
  ccp team run [provider] [--config <file>] --task <text> [--workers <n>] [--no-review] [-- <claude args...>]

Built-in providers:
  default  Claude Code default behavior
  kimi     Moonshot Kimi Coding Plan (api.kimi.com/coding)
  glm      Zhipu AI compatible endpoint using glm-5.1

Examples:
  claude-provider list
  claude-provider key set kimi
  claude-provider use kimi
  claude-provider run -- -p "review this file"
  claude-provider run glm --team-agents ./agents/team.json -- -p "review this file"
  claude-provider team init ./agents/team.json
  claude-provider team run glm --task "review this repo" --workers 3
  eval "$(claude-provider env)"
  claude-provider add openrouter --base-url https://example.invalid/anthropic --model my-model
  ccp kimi -- -p "review this file"
  ccp glm --team-agents ./agents/team.json -- -p "review this file"
  ccp team show-default
  ccp team run --task "implement login flow"
`);
}

function cmdList() {
  const config = loadConfig();
  const current = config.currentProvider;
  const providers = getProviders(config);
  const names = Object.keys(providers).sort();

  for (const name of names) {
    const provider = providers[name];
    const marker = name === current ? "*" : " ";
    const builtInLabel = provider.builtIn ? "built-in" : "custom";
    console.log(`${marker} ${name}`);
    console.log(`  type: ${builtInLabel}`);
    if (provider.kind !== "default") {
      console.log(`  endpoint: ${provider.baseUrl}`);
      console.log(`  model: ${provider.providerModel}`);
    }
    console.log(`  name: ${provider.displayName}`);
    console.log(`  description: ${provider.description}`);
  }
}

function cmdCurrent() {
  const config = loadConfig();
  const provider = getProviderOrFail(config.currentProvider, config);
  console.log(config.currentProvider);
  console.log(`display: ${provider.displayName}`);
  if (provider.kind !== "default") {
    console.log(`endpoint: ${provider.baseUrl}`);
    console.log(`model: ${provider.providerModel}`);
  }
}

function cmdUse(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider use <provider>");
  }

  const config = loadConfig();
  getProviderOrFail(providerName, config);
  config.currentProvider = providerName;
  saveConfig(config);

  console.log(`active provider set to ${providerName}`);
  console.log(`run: claude-provider run -- <claude args>`);
  console.log(`or:  eval "$(claude-provider env)"`);
}

function cmdEnv(args) {
  const config = loadConfig();
  const providerName = args[0] || config.currentProvider;
  const provider = getProviderOrFail(providerName, config);
  const envMap = buildRuntimeEnv(providerName, provider, {
    wrappedByCcp: isCcpInvocation()
  });

  for (const key of COMMON_ENV_KEYS) {
    if (!envMap.has(key)) {
      console.log(`unset ${key}`);
    }
  }

  for (const key of CCP_ENV_KEYS) {
    if (!envMap.has(key)) {
      console.log(`unset ${key}`);
    }
  }

  for (const [key, value] of envMap.entries()) {
    console.log(`export ${key}=${shellQuote(value)}`);
  }
}

function cmdRun(args, existingConfig) {
  const startedAt = new Date();
  let providerName = null;
  let claudeArgs = [];
  let wrapperArgs = [];

  if (args.length === 0) {
    providerName = (existingConfig || loadConfig()).currentProvider;
  } else if (args[0] === "--") {
    providerName = (existingConfig || loadConfig()).currentProvider;
    claudeArgs = args.slice(1);
  } else {
    providerName = args[0];
    wrapperArgs = args[1] === "--" ? [] : args.slice(1);
    claudeArgs = args[1] === "--" ? args.slice(2) : [];
  }

  if (providerName && providerName.startsWith("--")) {
    wrapperArgs = args[0] === "--" ? [] : args;
    providerName = (existingConfig || loadConfig()).currentProvider;
  }

  const parsedRunOptions = parseRunOptions(wrapperArgs);
  claudeArgs = [...parsedRunOptions.claudeArgs, ...claudeArgs];

  const config = existingConfig || loadConfig();
  const provider = getProviderOrFail(providerName, config);
  const ccpInvocation = isCcpInvocation();
  if (parsedRunOptions.teamAgentsFile) {
    const agentsJson = readAgentsFile(parsedRunOptions.teamAgentsFile);
    claudeArgs = ["--agents", agentsJson, ...claudeArgs];
  }
  const envEntries = Object.fromEntries(buildRuntimeEnv(providerName, provider, {
    wrappedByCcp: ccpInvocation
  }).entries());
  const childEnv = { ...process.env, ...envEntries };

  for (const key of COMMON_ENV_KEYS) {
    if (!(key in envEntries)) {
      delete childEnv[key];
    }
  }

  for (const key of CCP_ENV_KEYS) {
    if (!(key in envEntries)) {
      delete childEnv[key];
    }
  }

  const result = spawnSync("claude", claudeArgs, {
    stdio: "inherit",
    env: childEnv
  });

  if (ccpInvocation) {
    traceCcpRun({
      providerName,
      provider,
      claudeArgs,
      startedAt,
      endedAt: new Date(),
      exitCode: result.status === null ? 1 : result.status,
      cwd: process.cwd()
    });
  }

  if (result.error) {
    fail(`failed to run claude: ${result.error.message}`);
  }

  process.exit(result.status === null ? 1 : result.status);
}

function parseRunOptions(args) {
  const claudeArgs = [];
  let teamAgentsFile = null;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--team-agents" || token === "--agents-file") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        fail(`missing value for ${token}`);
      }
      teamAgentsFile = value;
      index += 1;
      continue;
    }

    if (token === "--") {
      claudeArgs.push(...args.slice(index + 1));
      break;
    }

    claudeArgs.push(token);
  }

  return {
    teamAgentsFile,
    claudeArgs
  };
}

function readAgentsFile(filePath) {
  return JSON.stringify(readAgentsObject(filePath, "team agents file"));
}

function cmdTeam(args) {
  const action = args[0];

  switch (action) {
    case "show-default":
    case "default":
      cmdTeamShowDefault();
      return;
    case "init":
      cmdTeamInit(args.slice(1));
      return;
    case "run":
      cmdTeamRun(args.slice(1));
      return;
    default:
      fail("usage: claude-provider team <show-default|init|run>");
  }
}

function cmdTeamShowDefault() {
  console.log(`${JSON.stringify(DEFAULT_TEAM_CONFIG, null, 2)}\n`);
}

function cmdTeamInit(args) {
  const outputPath = args[0] && !args[0].startsWith("--")
    ? args[0]
    : path.join(process.cwd(), "agents", "team.json");
  const force = args.includes("--force");
  const resolvedPath = path.resolve(outputPath);

  if (fs.existsSync(resolvedPath) && !force) {
    fail(`team config already exists: ${resolvedPath}. Use --force to overwrite.`);
  }

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.writeFileSync(resolvedPath, `${JSON.stringify(DEFAULT_TEAM_CONFIG, null, 2)}\n`, "utf8");

  console.log(`wrote default team config to ${resolvedPath}`);
  console.log(`use it with: ccp --team-agents ${shellQuote(resolvedPath)} -- -p "review this repo"`);
}

function cmdTeamRun(args) {
  const config = loadConfig();
  let providerName = config.currentProvider;
  let teamArgs = args;

  if (args[0] && !args[0].startsWith("--") && getProviderIfExists(args[0], config)) {
    providerName = args[0];
    teamArgs = args.slice(1);
  }

  const options = parseTeamRunOptions(teamArgs);
  const provider = getProviderOrFail(providerName, config);
  const teamConfig = options.configFile
    ? readAgentsObject(options.configFile, "team config")
    : DEFAULT_TEAM_CONFIG;

  validateTeamConfig(teamConfig, {
    needsReviewer: !options.noReview
  });

  const teamRunDir = createTeamRunDir(options.task);
  writeJsonFile(path.join(teamRunDir, "team-config.json"), teamConfig);
  writeJsonFile(path.join(teamRunDir, "meta.json"), {
    mode: "team-run",
    provider: providerName,
    task: options.task,
    workers: options.workers,
    reviewEnabled: !options.noReview,
    createdAt: new Date().toISOString(),
    cwd: process.cwd()
  });
  logTeamProgress(`run started: provider=${providerName}, workers=${options.workers}, review=${options.noReview ? "off" : "on"}`);
  logTeamProgress(`task: ${options.task}`);
  logTeamProgress(`artifacts: ${teamRunDir}`);

  const agentsJson = JSON.stringify(teamConfig);
  const planner = runTeamRole({
    role: "planner",
    providerName,
    provider,
    agentsJson,
    schema: PLANNER_SCHEMA,
    prompt: buildPlannerPrompt(options.task, options.workers),
    passthroughArgs: options.claudeArgs,
    teamRunDir,
    displayLabel: "planner"
  });
  writeJsonFile(path.join(teamRunDir, "planner.json"), planner.output);
  logTeamProgress(`planner summary: ${formatInline(planner.output.summary)}`);

  const subtasks = normalizeSubtasks(planner.output.subtasks, options.task, options.workers);
  logTeamProgress(`planned ${subtasks.length} worker task${subtasks.length === 1 ? "" : "s"}`);
  const workerOutputs = [];
  for (let index = 0; index < subtasks.length; index += 1) {
    const subtask = subtasks[index];
    const worker = runTeamRole({
      role: "worker",
      providerName,
      provider,
      agentsJson,
      schema: WORKER_SCHEMA,
      prompt: buildWorkerPrompt({
        task: options.task,
        planSummary: planner.output.summary,
        subtask,
        index,
        total: subtasks.length
      }),
      passthroughArgs: options.claudeArgs,
      teamRunDir,
      displayLabel: `worker ${index + 1}/${subtasks.length}`,
      detail: subtask.title
    });
    workerOutputs.push({
      subtask,
      output: worker.output
    });
    writeJsonFile(path.join(teamRunDir, `worker-${index + 1}.json`), {
      subtask,
      output: worker.output
    });
    logTeamProgress(`worker ${index + 1}/${subtasks.length} summary: ${formatInline(worker.output.summary)}`);
  }

  let reviewerOutput = null;
  if (!options.noReview) {
    const reviewer = runTeamRole({
      role: "reviewer",
      providerName,
      provider,
      agentsJson,
      schema: REVIEWER_SCHEMA,
      prompt: buildReviewerPrompt({
        task: options.task,
        planSummary: planner.output.summary,
        workerOutputs
      }),
      passthroughArgs: options.claudeArgs,
      teamRunDir,
      displayLabel: "reviewer"
    });
    reviewerOutput = reviewer.output;
    writeJsonFile(path.join(teamRunDir, "reviewer.json"), reviewerOutput);
    logTeamProgress(`reviewer summary: ${formatInline(reviewerOutput.summary)}`);
  }

  const orchestrator = runTeamRole({
    role: "orchestrator",
    providerName,
    provider,
    agentsJson,
    schema: ORCHESTRATOR_SCHEMA,
    prompt: buildOrchestratorPrompt({
      task: options.task,
      planSummary: planner.output.summary,
      workerOutputs,
      reviewerOutput
    }),
    passthroughArgs: options.claudeArgs,
    teamRunDir,
    displayLabel: "orchestrator"
  });
  writeJsonFile(path.join(teamRunDir, "orchestrator.json"), orchestrator.output);
  logTeamProgress(`orchestrator summary: ${formatInline(orchestrator.output.summary)}`);
  logTeamProgress("run completed");

  console.log(orchestrator.output.final_response);
  console.error(`team run artifacts: ${teamRunDir}`);
}

function parseTeamRunOptions(args) {
  let configFile = null;
  let task = "";
  let workers = 3;
  let noReview = false;
  const claudeArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--config") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        fail("missing value for --config");
      }
      configFile = value;
      index += 1;
      continue;
    }

    if (token === "--task") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        fail("missing value for --task");
      }
      task = value;
      index += 1;
      continue;
    }

    if (token === "--workers") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        fail("missing value for --workers");
      }
      workers = Number.parseInt(value, 10);
      index += 1;
      continue;
    }

    if (token === "--no-review") {
      noReview = true;
      continue;
    }

    if (token === "--") {
      claudeArgs.push(...args.slice(index + 1));
      break;
    }

    fail(`unknown team run option "${token}"`);
  }

  if (!task) {
    fail("usage: claude-provider team run [provider] [--config <file>] --task <text> [--workers <n>] [--no-review] [-- <claude args...>]");
  }

  if (!Number.isInteger(workers) || workers < 1 || workers > 12) {
    fail("--workers must be an integer between 1 and 12");
  }

  validateTeamPassThroughArgs(claudeArgs);

  return {
    configFile,
    task,
    workers,
    noReview,
    claudeArgs
  };
}

function validateTeamConfig(teamConfig, options = {}) {
  const requiredRoles = ["orchestrator", "planner", "worker"];
  if (options.needsReviewer) {
    requiredRoles.push("reviewer");
  }

  for (const role of requiredRoles) {
    const definition = teamConfig[role];
    if (!definition || typeof definition !== "object") {
      fail(`team config is missing role "${role}"`);
    }
    if (typeof definition.description !== "string" || typeof definition.prompt !== "string") {
      fail(`team config role "${role}" must include string description and prompt`);
    }
  }
}

function normalizeSubtasks(subtasks, task, workers) {
  if (!Array.isArray(subtasks) || subtasks.length === 0) {
    return [{
      id: "task-1",
      title: "Primary task",
      instructions: task
    }];
  }

  return subtasks.slice(0, workers).map((subtask, index) => ({
    id: subtask.id || `task-${index + 1}`,
    title: subtask.title || `Task ${index + 1}`,
    instructions: subtask.instructions || task
  }));
}

function buildPlannerPrompt(task, workers) {
  return [
    "Create a practical execution plan for the following task.",
    `Task: ${task}`,
    `Return at most ${workers} subtasks.`,
    "Each subtask should be independently executable by a worker.",
    "Return JSON only."
  ].join("\n\n");
}

function buildWorkerPrompt({ task, planSummary, subtask, index, total }) {
  return [
    "Complete the assigned subtask as one worker in a team hierarchy.",
    `Original task: ${task}`,
    `Plan summary: ${planSummary}`,
    `Assigned subtask ${index + 1} of ${total}: ${subtask.title}`,
    `Instructions: ${subtask.instructions}`,
    "Return JSON only."
  ].join("\n\n");
}

function buildReviewerPrompt({ task, planSummary, workerOutputs }) {
  return [
    "Review the worker outputs for correctness, gaps, and risks.",
    `Original task: ${task}`,
    `Plan summary: ${planSummary}`,
    `Worker outputs:\n${formatWorkerOutputs(workerOutputs)}`,
    "Return JSON only."
  ].join("\n\n");
}

function buildOrchestratorPrompt({ task, planSummary, workerOutputs, reviewerOutput }) {
  return [
    "Synthesize the final response as the orchestrator.",
    `Original task: ${task}`,
    `Plan summary: ${planSummary}`,
    `Worker outputs:\n${formatWorkerOutputs(workerOutputs)}`,
    reviewerOutput
      ? `Reviewer summary: ${reviewerOutput.summary}\nReviewer issues: ${(reviewerOutput.issues || []).join("; ")}\nReviewer recommendations: ${reviewerOutput.recommendations}`
      : "No reviewer stage was used.",
    "Produce the final response for the user.",
    "Return JSON only."
  ].join("\n\n");
}

function formatWorkerOutputs(workerOutputs) {
  return workerOutputs.map((entry, index) => {
    return [
      `Worker ${index + 1}: ${entry.subtask.title}`,
      `Instructions: ${entry.subtask.instructions}`,
      `Summary: ${entry.output.summary}`,
      `Result: ${entry.output.result}`
    ].join("\n");
  }).join("\n\n");
}

function validateTeamPassThroughArgs(args) {
  const reserved = new Set([
    "-p",
    "--print",
    "--output-format",
    "--json-schema",
    "--agent",
    "--agents"
  ]);

  for (const arg of args) {
    if (reserved.has(arg)) {
      fail(`team run does not allow passing ${arg}; the wrapper manages that internally`);
    }
  }
}

function runTeamRole({ role, providerName, provider, agentsJson, schema, prompt, passthroughArgs, teamRunDir, displayLabel, detail }) {
  logTeamProgress(`${displayLabel || role}: starting${detail ? ` (${detail})` : ""}`);
  const startedAt = Date.now();
  const envEntries = Object.fromEntries(buildRuntimeEnv(providerName, provider, {
    wrappedByCcp: isCcpInvocation(),
    teamContext: {
      role,
      runDir: teamRunDir
    }
  }).entries());
  const childEnv = { ...process.env, ...envEntries };

  for (const key of COMMON_ENV_KEYS) {
    if (!(key in envEntries)) {
      delete childEnv[key];
    }
  }

  for (const key of CCP_ENV_KEYS) {
    if (!(key in envEntries)) {
      delete childEnv[key];
    }
  }

  const args = [
    ...passthroughArgs,
    "--agents",
    agentsJson,
    "--agent",
    role,
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "-p",
    prompt
  ];

  const result = spawnSync("claude", args, {
    env: childEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 10
  });

  if (result.error) {
    fail(`failed to run ${role}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    fail(`${role} failed with exit code ${result.status}${detail ? `: ${detail}` : ""}`);
  }

  let parsedOutput;
  try {
    parsedOutput = JSON.parse(result.stdout.trim());
  } catch (error) {
    fail(`${role} returned invalid JSON`);
  }

  const output = unwrapStructuredOutput(parsedOutput, role);
  const elapsedMs = Date.now() - startedAt;
  logTeamProgress(`${displayLabel || role}: completed in ${formatDuration(elapsedMs)}`);

  return {
    output,
    rawOutput: parsedOutput
  };
}

function logTeamProgress(message) {
  process.stderr.write(`[team] ${message}\n`);
}

function formatInline(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function unwrapStructuredOutput(parsedOutput, role) {
  if (parsedOutput && typeof parsedOutput === "object" && parsedOutput.structured_output && typeof parsedOutput.structured_output === "object") {
    return parsedOutput.structured_output;
  }

  if (parsedOutput && typeof parsedOutput === "object") {
    return parsedOutput;
  }

  fail(`${role} returned an unexpected JSON shape`);
}

function formatDuration(elapsedMs) {
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`;
  }

  const seconds = elapsedMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function cmdKey(args) {
  const action = args[0];

  switch (action) {
    case "set":
      cmdKeySet(args.slice(1));
      return;
    case "delete":
      cmdKeyDelete(args.slice(1));
      return;
    case "test":
      cmdKeyTest(args.slice(1));
      return;
    default:
      fail("usage: claude-provider key <set|delete|test> <provider>");
  }
}

async function readSecretPrompt(promptText) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stderr = process.stderr;

    if (!stdin.isTTY) {
      reject(new Error("secret prompt requires an interactive terminal or --value"));
      return;
    }

    let value = "";

    const cleanup = () => {
      stdin.removeListener("data", onData);
      if (stdin.isTTY && typeof stdin.setRawMode === "function") {
        stdin.setRawMode(false);
      }
      stdin.pause();
    };

    const onData = (chunk) => {
      const char = String(chunk);

      if (char === "\u0003") {
        cleanup();
        stderr.write("\n");
        reject(new Error("aborted"));
        return;
      }

      if (char === "\r" || char === "\n") {
        cleanup();
        stderr.write("\n");
        resolve(value);
        return;
      }

      if (char === "\u007f") {
        value = value.slice(0, -1);
        return;
      }

      if (char >= " ") {
        value += char;
      }
    };

    stderr.write(promptText);
    stdin.setEncoding("utf8");
    stdin.resume();
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.on("data", onData);
  });
}

async function cmdKeySetAsync(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider key set <provider> [--value <secret>]");
  }

  const config = loadConfig();
  const provider = getProviderOrFail(providerName, config);
  if (provider.kind === "default") {
    fail('the "default" provider does not use a stored API key');
  }

  const options = parseFlags(args.slice(1));
  let secret = options.value;
  if (!secret) {
    secret = await readSecretPrompt(`API key for ${providerName}: `);
  }

  if (!secret) {
    fail("secret cannot be empty");
  }

  setKeychainSecret(providerName, secret);
  console.log(`stored API key for ${providerName} in macOS Keychain`);
}

function cmdKeySet(args) {
  cmdKeySetAsync(args).catch((error) => {
    console.error(`claude-provider: ${error.message}`);
    process.exit(1);
  });
}

function cmdKeyDelete(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider key delete <provider>");
  }

  const config = loadConfig();
  const provider = getProviderOrFail(providerName, config);
  if (provider.kind === "default") {
    fail('the "default" provider does not use a stored API key');
  }

  deleteKeychainSecret(providerName);
  console.log(`deleted API key for ${providerName} from macOS Keychain`);
}

function cmdKeyTest(args) {
  const providerName = args[0];
  if (!providerName) {
    fail("usage: claude-provider key test <provider>");
  }

  const config = loadConfig();
  const provider = getProviderOrFail(providerName, config);
  if (provider.kind === "default") {
    console.log("default provider does not require a stored API key");
    return;
  }

  const secret = getKeychainSecret(providerName);
  if (!secret) {
    fail(`no API key found in macOS Keychain for ${providerName}`);
  }

  console.log(`API key found for ${providerName}`);
}

function cmdAdd(args) {
  const name = args[0];
  if (!name) {
    fail("usage: claude-provider add <name> --base-url <url> --model <model>");
  }

  validateProviderName(name);
  if (BUILTIN_PROVIDERS[name]) {
    fail(`"${name}" is a built-in provider and cannot be overwritten`);
  }

  const flags = parseFlags(args.slice(1));
  const baseUrl = flags["base-url"];
  const model = flags.model;
  const displayName = flags["display-name"] || name;
  const description = flags.description || "Custom Anthropic-compatible provider.";

  if (!baseUrl || !model) {
    fail("usage: claude-provider add <name> --base-url <url> --model <model> [--display-name <name>] [--description <text>]");
  }

  const config = loadConfig();
  config.customProviders[name] = {
    kind: "compatible",
    displayName,
    description,
    baseUrl,
    providerModel: model,
    anthropicModel: flags["anthropic-model"] || "sonnet",
    smallFastModel: flags["small-fast-model"] || "haiku"
  };
  saveConfig(config);

  console.log(`added custom provider ${name}`);
}

function cmdRemove(args) {
  const name = args[0];
  if (!name) {
    fail("usage: claude-provider remove <name>");
  }

  if (BUILTIN_PROVIDERS[name]) {
    fail(`cannot remove built-in provider "${name}"`);
  }

  const config = loadConfig();
  if (!config.customProviders[name]) {
    fail(`provider "${name}" does not exist`);
  }

  delete config.customProviders[name];
  if (config.currentProvider === name) {
    config.currentProvider = "default";
  }
  saveConfig(config);

  try {
    deleteKeychainSecret(name);
  } catch (error) {
    if (!String(error.message).includes("could not be found")) {
      throw error;
    }
  }

  console.log(`removed provider ${name}`);
}

function getConfigHome() {
  return process.env.CLAUDE_PROVIDER_HOME || path.join(os.homedir(), ".config", "claude-provider");
}

function getConfigPath() {
  return path.join(getConfigHome(), "config.json");
}

function getTeamRunsHome() {
  return path.join(getConfigHome(), "team-runs");
}

function ensureConfigDir() {
  fs.mkdirSync(getConfigHome(), { recursive: true });
}

function defaultConfig() {
  return {
    version: CURRENT_CONFIG_VERSION,
    currentProvider: "default",
    customProviders: {}
  };
}

function loadConfig() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return defaultConfig();
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    version: parsed.version || CURRENT_CONFIG_VERSION,
    currentProvider: parsed.currentProvider || "default",
    customProviders: parsed.customProviders || {}
  };
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getProviders(config) {
  const providers = {};

  for (const [name, provider] of Object.entries(BUILTIN_PROVIDERS)) {
    providers[name] = {
      ...provider,
      builtIn: true
    };
  }

  for (const [name, provider] of Object.entries(config.customProviders || {})) {
    providers[name] = {
      ...provider,
      builtIn: false
    };
  }

  return providers;
}

function getProviderOrFail(name, config) {
  const providers = getProviders(config);
  const provider = providers[name];
  if (!provider) {
    fail(`unknown provider "${name}"`);
  }
  return provider;
}

function getProviderIfExists(name, config) {
  if (!name) {
    return null;
  }

  const providers = getProviders(config);
  return providers[name] || null;
}

function buildProviderEnv(providerName, provider) {
  const env = new Map();
  if (provider.kind === "default") {
    return env;
  }

  const secret = getKeychainSecret(providerName);
  if (!secret) {
    fail(`missing API key for ${providerName}. Run: claude-provider key set ${providerName}`);
  }

  env.set("ANTHROPIC_BASE_URL", provider.baseUrl);
  env.set("ANTHROPIC_AUTH_TOKEN", secret);
  env.set("ANTHROPIC_MODEL", provider.anthropicModel || "sonnet");
  env.set("ANTHROPIC_SMALL_FAST_MODEL", provider.smallFastModel || "haiku");
  env.set("ANTHROPIC_DEFAULT_OPUS_MODEL", provider.providerModel);
  env.set("ANTHROPIC_DEFAULT_SONNET_MODEL", provider.providerModel);
  env.set("ANTHROPIC_DEFAULT_HAIKU_MODEL", provider.providerModel);
  env.set("ANTHROPIC_DEFAULT_OPUS_MODEL_NAME", provider.displayName);
  env.set("ANTHROPIC_DEFAULT_SONNET_MODEL_NAME", provider.displayName);
  env.set("ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME", provider.displayName);
  env.set("ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION", provider.description);
  env.set("ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION", provider.description);
  env.set("ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION", provider.description);
  return env;
}

function buildWrapperEnv(providerName, provider, options = {}) {
  const env = new Map();
  env.set("CCP_WRAPPED", "1");
  env.set("CCP_PROVIDER", providerName);
  env.set("CCP_PROVIDER_KIND", provider.kind);
  env.set("CCP_PROVIDER_NAME", provider.displayName);

  if (provider.baseUrl) {
    env.set("CCP_PROVIDER_BASE_URL", provider.baseUrl);
  }

  if (provider.providerModel) {
    env.set("CCP_PROVIDER_MODEL", provider.providerModel);
  }

  if (options.teamContext) {
    env.set("CCP_TEAM_MODE", "1");
    env.set("CCP_TEAM_ROLE", options.teamContext.role);
    env.set("CCP_TEAM_RUN_DIR", options.teamContext.runDir);
  }

  return env;
}

function buildRuntimeEnv(providerName, provider, options = {}) {
  const env = buildProviderEnv(providerName, provider);
  if (options.wrappedByCcp) {
    for (const [key, value] of buildWrapperEnv(providerName, provider, options).entries()) {
      env.set(key, value);
    }
  }
  return env;
}

function isCcpInvocation() {
  return process.env.CCP_SHORT_ALIAS === "1";
}

function isImplicitRunOption(command) {
  return command === "--" || command === "--team-agents" || command === "--agents-file";
}

function getClaudeHome() {
  return process.env.CLAUDE_HOME || path.join(os.homedir(), ".claude");
}

function getTraceFilePath() {
  return path.join(getConfigHome(), "traces.jsonl");
}

function traceCcpRun(runInfo) {
  try {
    const sessionIds = findRecentSessionIds({
      claudeHome: getClaudeHome(),
      cwd: runInfo.cwd,
      startedAt: runInfo.startedAt
    });

    if (sessionIds.length === 0) {
      return;
    }

    const sessionFiles = findSessionFilesForIds({
      claudeHome: getClaudeHome(),
      sessionIds
    });

    const traceEntries = [];
    for (const sessionId of sessionIds) {
      const sessionFile = sessionFiles.get(sessionId);
      if (!sessionFile) {
        continue;
      }

      const turns = extractTraceTurnsFromSessionFile(sessionFile, {
        cwd: runInfo.cwd,
        sessionId,
        startedAt: runInfo.startedAt
      });

      for (const turn of turns) {
        traceEntries.push({
          traceVersion: 1,
          wrapper: "ccp",
          timestamp: turn.assistantTimestamp || turn.userTimestamp,
          sessionId,
          cwd: runInfo.cwd,
          provider: {
            id: runInfo.providerName,
            kind: runInfo.provider.kind,
            name: runInfo.provider.displayName,
            baseUrl: runInfo.provider.baseUrl || null,
            model: runInfo.provider.providerModel || null
          },
          claudeArgs: runInfo.claudeArgs,
          run: {
            startedAt: runInfo.startedAt.toISOString(),
            endedAt: runInfo.endedAt.toISOString(),
            exitCode: runInfo.exitCode
          },
          prompt: turn.prompt,
          response: turn.response,
          model: turn.model || null,
          promptId: turn.promptId || null,
          sessionFile
        });
      }
    }

    if (traceEntries.length > 0) {
      appendTraceEntries(traceEntries);
    }
  } catch (error) {
    console.error(`claude-provider: tracing failed: ${error.message}`);
  }
}

function readAgentsObject(filePath, label) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    fail(`${label} not found: ${resolvedPath}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    fail(`${label} must be valid JSON: ${resolvedPath}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${label} must contain a JSON object: ${resolvedPath}`);
  }

  return parsed;
}

function createTeamRunDir(task) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = sanitizeSegment(task).slice(0, 48) || "team-run";
  const dir = path.join(getTeamRunsHome(), `${timestamp}-${slug}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeSegment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function appendTraceEntries(entries) {
  ensureConfigDir();
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n");
  fs.appendFileSync(getTraceFilePath(), `${lines}\n`, "utf8");
}

function findRecentSessionIds({ claudeHome, cwd, startedAt }) {
  const historyPath = path.join(claudeHome, "history.jsonl");
  if (!fs.existsSync(historyPath)) {
    return [];
  }

  const startedAtMs = startedAt.getTime() - 1000;
  const sessionIds = [];
  const seen = new Set();
  const lines = fs.readFileSync(historyPath, "utf8").split("\n");

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.project !== cwd) {
      continue;
    }

    if (typeof entry.timestamp !== "number" || entry.timestamp < startedAtMs) {
      continue;
    }

    if (typeof entry.sessionId !== "string" || seen.has(entry.sessionId)) {
      continue;
    }

    seen.add(entry.sessionId);
    sessionIds.push(entry.sessionId);
  }

  return sessionIds;
}

function findSessionFilesForIds({ claudeHome, sessionIds }) {
  const targetIds = new Set(sessionIds);
  const results = new Map();
  const projectsDir = path.join(claudeHome, "projects");
  if (!fs.existsSync(projectsDir)) {
    return results;
  }

  const walk = (currentDir) => {
    if (results.size === targetIds.size) {
      return;
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "subagents") {
          continue;
        }
        walk(fullPath);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      const sessionId = entry.name.replace(/\.jsonl$/, "");
      if (targetIds.has(sessionId) && !results.has(sessionId)) {
        results.set(sessionId, fullPath);
      }
    }
  };

  walk(projectsDir);
  return results;
}

function extractTraceTurnsFromSessionFile(sessionFile, options) {
  const lines = fs.readFileSync(sessionFile, "utf8").split("\n");
  const startedAtMs = options.startedAt.getTime() - 1000;
  const turns = [];
  let currentTurn = null;

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.isSidechain || entry.sessionId !== options.sessionId || entry.cwd !== options.cwd) {
      continue;
    }

    const timestampMs = parseTimestampMs(entry.timestamp);
    if (entry.type === "user") {
      const prompt = extractUserPrompt(entry);
      if (!prompt || timestampMs === null || timestampMs < startedAtMs) {
        continue;
      }

      if (currentTurn) {
        turns.push(currentTurn);
      }

      currentTurn = {
        prompt,
        response: null,
        model: null,
        promptId: entry.promptId || null,
        userTimestamp: entry.timestamp,
        assistantTimestamp: null
      };
      continue;
    }

    if (entry.type === "assistant" && currentTurn) {
      const text = extractAssistantText(entry);
      if (!text) {
        continue;
      }

      currentTurn.response = text;
      currentTurn.model = entry.message && entry.message.model ? entry.message.model : currentTurn.model;
      currentTurn.assistantTimestamp = entry.timestamp || currentTurn.assistantTimestamp;
    }
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  return turns.filter((turn) => turn.prompt);
}

function parseTimestampMs(timestamp) {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

function extractUserPrompt(entry) {
  if (!entry.message || entry.message.role !== "user") {
    return "";
  }

  return normalizeContentToText(entry.message.content, {
    includeToolResults: false
  });
}

function extractAssistantText(entry) {
  if (!entry.message || !entry.message.content) {
    return "";
  }

  return normalizeContentToText(entry.message.content, {
    includeToolResults: false,
    assistantOnly: true
  });
}

function normalizeContentToText(content, options = {}) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if (item.type === "text" && typeof item.text === "string") {
      const text = item.text.trim();
      if (text && text !== "[Request interrupted by user for tool use]") {
        parts.push(text);
      }
      continue;
    }

    if (!options.assistantOnly && options.includeToolResults && item.type === "tool_result" && typeof item.content === "string") {
      const text = item.content.trim();
      if (text) {
        parts.push(text);
      }
    }
  }

  return parts.join("\n\n").trim();
}

function getKeychainService(providerName) {
  return `${KEYCHAIN_SERVICE_PREFIX}:${providerName}`;
}

function setKeychainSecret(providerName, secret) {
  execFileSync("security", [
    "add-generic-password",
    "-U",
    "-a",
    providerName,
    "-s",
    getKeychainService(providerName),
    "-w",
    secret
  ], { stdio: "pipe" });
}

function getKeychainSecret(providerName) {
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-a",
      providerName,
      "-s",
      getKeychainService(providerName),
      "-w"
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return "";
  }
}

function deleteKeychainSecret(providerName) {
  execFileSync("security", [
    "delete-generic-password",
    "-a",
    providerName,
    "-s",
    getKeychainService(providerName)
  ], { stdio: "pipe" });
}

function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`missing value for --${key}`);
    }
    flags[key] = value;
    index += 1;
  }
  return flags;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function validateProviderName(name) {
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
    fail("provider names may only contain letters, numbers, dashes, and underscores");
  }
}

function fail(message) {
  throw new Error(message);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  extractTraceTurnsFromSessionFile,
  findRecentSessionIds,
  normalizeContentToText,
  getTraceFilePath
};
